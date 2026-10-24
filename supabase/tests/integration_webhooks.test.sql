-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/integration_webhooks.test.sql
--
-- Covers 20261024130000_integration_webhooks.sql: the enqueue triggers (a
-- linked milestone's status change, and a recorded anchor, D-26), what they
-- leave alone (unlinked milestones, title edits, inactive webhooks,
-- notifications), the claim's per-milestone order (D-25), leasing, the
-- 8-attempt cap and dead-lettering, idempotent reports, and who may reach any
-- of it.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back, so now() is
-- one instant throughout and a retry is made due again by recording it with a
-- next_attempt_at in the past. occurred_at is not now() but the time of the
-- write (clock_timestamp()), which section 7 checks.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(62);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- u1 owns P1, u2 is a member (so a status change has someone to notify).
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'hooks-owner@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Owner","username":"hooks_owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'hooks-member@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Member","username":"hooks_member"}', now(), now());

insert into public.projects (id, owner_id, name, slug)
values ('b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Hooks', 'hooks-test');

insert into public.project_members (project_id, user_id, role)
values ('b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'member');

-- M1 and M3 are linked, M2 is not.
insert into public.milestones (id, project_id, title, status, order_index)
values
  ('c2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Escrow contract', 'proposed', 0),
  ('c2000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001', 'Unlinked', 'proposed', 1),
  ('c2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001', 'Payroll run', 'proposed', 2);

insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url, linked_by)
values ('b2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Payroll v1 plan',
        'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001');

insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label, created_by)
values
  ('c2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000001', 'h1', 'Escrow contract', 'a2000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000001', 'h2', 'Payroll run', 'a2000000-0000-4000-8000-000000000001');

insert into public.integration_webhooks (id, client_id, target_url, secret_ciphertext)
values ('e2000000-0000-4000-8000-000000000001', '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
        'https://www.doqtri.xyz/api/integrations/qdit/webhook',
        'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');


-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

create function pg_temp.events(p_milestone uuid) returns bigint
language sql as $$
  select count(*) from public.integration_events where milestone_id = p_milestone
$$;

create function pg_temp.anchor(p_milestone uuid, p_action public.anchor_action, p_tx text) returns void
language sql as $$
  insert into public.milestone_anchors (milestone_id, project_id, action, proof_hash, version, contract_id,
                                        tx_hash, signer_address, created_by)
  values (p_milestone, 'b2000000-0000-4000-8000-000000000001', p_action,
          case when p_action = 'submit' then repeat('a', 64) end, 1,
          'CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG', p_tx,
          'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', 'a2000000-0000-4000-8000-000000000001');
$$;

-- Claims as the cron route does, into a temp table the assertions read.
create temp table claimed (
  id uuid, webhook_id uuid, milestone_id uuid, project_id uuid, event text,
  status public.milestone_status, occurred_at timestamptz, attempts integer, claim_token uuid
) on commit drop;
grant all on claimed to service_role;

create function pg_temp.claim(p_limit integer default 20) returns integer
language plpgsql as $$
begin
  truncate claimed;
  perform set_config('role', 'service_role', true);
  insert into claimed (id, webhook_id, milestone_id, project_id, event, status, occurred_at, attempts, claim_token)
  select c.id, c.webhook_id, c.milestone_id, c.project_id, c.event, c.status, c.occurred_at, c.attempts,
         c.claim_token
    from public.claim_integration_events(p_limit, 120) c;
  perform set_config('role', 'postgres', true);
  return (select count(*) from claimed);
end;
$$;

-- The same claim, for asserting that nothing is due: `claimed` is left as it
-- was, so a report on the earlier claim can still be made.
create function pg_temp.claim_none() returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  perform set_config('role', 'service_role', true);
  select count(*) into v_count from public.claim_integration_events(20, 120);
  perform set_config('role', 'postgres', true);
  return v_count;
end;
$$;

-- Reports a failure for the claimed event of one milestone, due again at once
-- (or with no next attempt, which is dead).
create function pg_temp.fail(p_milestone uuid, p_retry boolean default true) returns text
language plpgsql as $$
declare
  v_outcome text;
begin
  perform set_config('role', 'service_role', true);
  select public.record_integration_delivery(c.id, c.claim_token, false, 'HTTP 503',
           case when p_retry then now() - interval '1 second' end)
    into v_outcome
    from claimed c
   where c.milestone_id = p_milestone;
  perform set_config('role', 'postgres', true);
  return v_outcome;
end;
$$;

create function pg_temp.deliver(p_milestone uuid) returns text
language plpgsql as $$
declare
  v_outcome text;
begin
  perform set_config('role', 'service_role', true);
  select public.record_integration_delivery(c.id, c.claim_token, true, null, null)
    into v_outcome
    from claimed c
   where c.milestone_id = p_milestone;
  perform set_config('role', 'postgres', true);
  return v_outcome;
end;
$$;


-- ----------------------------------------------------------------------------
-- 1. Enqueue on a status change
-- ----------------------------------------------------------------------------

update public.milestones set status = 'submitted' where id = 'c2000000-0000-4000-8000-000000000001';

select is(pg_temp.events('c2000000-0000-4000-8000-000000000001'), 1::bigint,
  'a linked milestone''s status change writes one event');
select results_eq(
  $$ select webhook_id, project_id, event, status::text, cause, attempts::int,
            delivered_at is null and dead_at is null, next_attempt_at <= now()
       from public.integration_events where milestone_id = 'c2000000-0000-4000-8000-000000000001' $$,
  $$ values ('e2000000-0000-4000-8000-000000000001'::uuid, 'b2000000-0000-4000-8000-000000000001'::uuid,
             'milestone.status_changed', 'submitted', 'status_changed', 0, true, true) $$,
  'the event carries the webhook, project, type and new status, and is due at once'
);
select ok(
  (select occurred_at = date_trunc('milliseconds', occurred_at)
     from public.integration_events where milestone_id = 'c2000000-0000-4000-8000-000000000001'),
  'occurred_at is whole milliseconds, so every retry sends the same body bytes'
);
select ok(
  (select count(*) > 0 from public.notifications where milestone_id = 'c2000000-0000-4000-8000-000000000001'),
  'notify_milestone_status still fires beside it'
);

update public.milestones set status = 'submitted' where id = 'c2000000-0000-4000-8000-000000000002';
select is(pg_temp.events('c2000000-0000-4000-8000-000000000002'), 0::bigint,
  'an unlinked milestone''s status change writes nothing');

update public.milestones set description = 'Edited' where id = 'c2000000-0000-4000-8000-000000000001';
select is(pg_temp.events('c2000000-0000-4000-8000-000000000001'), 1::bigint,
  'a change that is not a status change writes nothing');

update public.milestones set status = 'submitted' where id = 'c2000000-0000-4000-8000-000000000001';
select is(pg_temp.events('c2000000-0000-4000-8000-000000000001'), 1::bigint,
  'setting the same status again writes nothing');


-- ----------------------------------------------------------------------------
-- 2. Enqueue on a recorded anchor (D-26)
-- ----------------------------------------------------------------------------

select pg_temp.anchor('c2000000-0000-4000-8000-000000000001', 'approve', repeat('1', 64));

select is(pg_temp.events('c2000000-0000-4000-8000-000000000001'), 2::bigint,
  'recording an anchor for a linked milestone writes an event, though the status did not move');
select results_eq(
  $$ select status::text, cause from public.integration_events
      where milestone_id = 'c2000000-0000-4000-8000-000000000001' order by seq $$,
  $$ values ('submitted', 'status_changed'), ('approved', 'anchor_recorded') $$,
  'an anchor''s event carries the status its contract call produced'
);

select pg_temp.anchor('c2000000-0000-4000-8000-000000000003', 'submit', repeat('2', 64));
select pg_temp.anchor('c2000000-0000-4000-8000-000000000003', 'reject', repeat('3', 64));
select results_eq(
  $$ select status::text from public.integration_events
      where milestone_id = 'c2000000-0000-4000-8000-000000000003' order by seq $$,
  $$ values ('submitted'), ('rejected') $$,
  'submit -> submitted, reject -> rejected'
);

select pg_temp.anchor('c2000000-0000-4000-8000-000000000002', 'submit', repeat('4', 64));
select is(pg_temp.events('c2000000-0000-4000-8000-000000000002'), 0::bigint,
  'an anchor for an unlinked milestone writes nothing');


-- ----------------------------------------------------------------------------
-- 3. Claim: one head per milestone (D-25), leased
-- ----------------------------------------------------------------------------

select is(pg_temp.claim(), 2, 'a claim returns one event per milestone, not every due event');
select results_eq(
  $$ select milestone_id, status::text, attempts::int from claimed order by milestone_id $$,
  $$ values ('c2000000-0000-4000-8000-000000000001'::uuid, 'submitted', 1),
            ('c2000000-0000-4000-8000-000000000003'::uuid, 'submitted', 1) $$,
  'each is the earliest event of its milestone, and the claim counts the attempt'
);
select ok(
  (select bool_and(e.claim_token is not null and e.next_attempt_at > now())
     from public.integration_events e join claimed c on c.id = e.id),
  'claimed rows are leased'
);
select is(pg_temp.claim_none(), 0, 'a leased head is not claimed again, and nothing behind it is either');

select is(pg_temp.fail('c2000000-0000-4000-8000-000000000001'), 'retry', 'a failed attempt is scheduled again');
select results_eq(
  $$ select attempts::int, last_error, claim_token is null from public.integration_events
      where id = (select id from claimed where milestone_id = 'c2000000-0000-4000-8000-000000000001') $$,
  $$ values (1, 'HTTP 503', true) $$,
  'the failure is recorded and the lease released'
);
select is(pg_temp.fail('c2000000-0000-4000-8000-000000000001'), 'stale',
  'a second report of the same claim changes nothing');

select is(pg_temp.claim(), 1, 'the retried head is due again');
select results_eq(
  $$ select milestone_id, status::text, attempts::int from claimed $$,
  $$ values ('c2000000-0000-4000-8000-000000000001'::uuid, 'submitted', 2) $$,
  'the retry is the same event, on its second attempt, and the later event still waits'
);

-- A report carrying another claim's token is refused.
select is(
  (select public.record_integration_delivery(c.id, gen_random_uuid(), true, null, null) from claimed c),
  'stale',
  'a report with the wrong claim token changes nothing'
);

select is(pg_temp.deliver('c2000000-0000-4000-8000-000000000001'), 'delivered', 'a 2xx settles the event');
select ok(
  (select delivered_at is not null and dead_at is null and claim_token is null
     from public.integration_events where id = (select id from claimed)),
  'a delivered event is marked delivered'
);
select is(pg_temp.deliver('c2000000-0000-4000-8000-000000000001'), 'stale',
  'delivering it again is a no-op (idempotent by event id)');

select is(pg_temp.claim(), 1, 'delivering the head releases the next event of that milestone');
select results_eq(
  $$ select milestone_id, status::text, attempts::int from claimed $$,
  $$ values ('c2000000-0000-4000-8000-000000000001'::uuid, 'approved', 1) $$,
  'the released event starts its own attempts at 1: waiting used none of them'
);
select is(pg_temp.deliver('c2000000-0000-4000-8000-000000000001'), 'delivered', 'and it is delivered');


-- ----------------------------------------------------------------------------
-- 4. Dead-lettering
-- ----------------------------------------------------------------------------

-- M3's first event fails eight times. The lease of M3's first claim (section
-- 3) is still running, so it is let go first.
update public.integration_events set next_attempt_at = now() - interval '1 second', claim_token = null
 where milestone_id = 'c2000000-0000-4000-8000-000000000003' and status = 'submitted';

create function pg_temp.fail_until_dead(p_milestone uuid) returns text[]
language plpgsql as $$
declare
  v_outcomes text[] := '{}';
begin
  for i in 1..7 loop
    if pg_temp.claim() <> 1 then
      return v_outcomes || 'nothing claimed'::text;
    end if;
    v_outcomes := v_outcomes || pg_temp.fail(p_milestone);
  end loop;
  return v_outcomes;
end;
$$;

-- Its attempt from section 3 counted, so seven more failures reach the cap.
select is(
  pg_temp.fail_until_dead('c2000000-0000-4000-8000-000000000003'),
  array['retry', 'retry', 'retry', 'retry', 'retry', 'retry', 'dead'],
  'attempts 2 to 7 are retried and the 8th failed attempt is dead'
);
select results_eq(
  $$ select attempts::int, dead_at is not null, delivered_at is null from public.integration_events
      where milestone_id = 'c2000000-0000-4000-8000-000000000003' and status = 'submitted' $$,
  $$ values (8, true, true) $$,
  'a dead event keeps its 8 attempts for inspection'
);

select is(pg_temp.claim(), 1, 'the next claim finds one event for that milestone');
select results_eq(
  $$ select milestone_id, status::text, attempts::int from claimed $$,
  $$ values ('c2000000-0000-4000-8000-000000000003'::uuid, 'rejected', 1) $$,
  'it is the next event, not the dead one: a dead event releases its successor'
);

select is(pg_temp.fail('c2000000-0000-4000-8000-000000000003', false), 'dead',
  'a failure with no next attempt is dead at once');

-- The cap holds whatever the caller asks for: an 8th attempt cannot be retried.
update public.milestones set status = 'approved' where id = 'c2000000-0000-4000-8000-000000000003';
update public.integration_events set attempts = 7
 where milestone_id = 'c2000000-0000-4000-8000-000000000003' and status = 'approved';
select is(pg_temp.claim(), 1, 'an event on its last attempt is claimed');
select is(pg_temp.fail('c2000000-0000-4000-8000-000000000003', true), 'dead',
  'the 8th failure is dead even when a next attempt is asked for');

-- A run that claimed an 8th attempt and never reported back.
update public.milestones set status = 'rejected' where id = 'c2000000-0000-4000-8000-000000000003';
update public.integration_events set attempts = 7
 where milestone_id = 'c2000000-0000-4000-8000-000000000003' and status = 'rejected' and dead_at is null;
select is(pg_temp.claim(), 1, 'claimed, then the run dies');
update public.integration_events set next_attempt_at = now() - interval '1 second'
 where id = (select id from claimed);
select is(pg_temp.claim(), 0, 'once its lease is over it is not claimed a ninth time');
select ok(
  (select dead_at is not null and last_error like '%did not report back%'
     from public.integration_events
    where milestone_id = 'c2000000-0000-4000-8000-000000000003' and status = 'rejected' and attempts = 8),
  'it is marked dead instead, saying why'
);

-- A run that died on an earlier attempt: retried once the lease is over.
update public.milestones set status = 'submitted' where id = 'c2000000-0000-4000-8000-000000000003';
select is(pg_temp.claim(), 1, 'claimed, then the run dies');
update public.integration_events set next_attempt_at = now() - interval '1 second'
 where id = (select id from claimed);
select is(pg_temp.claim(), 1, 'a lease that ran out with attempts left is claimed again');
select is((select attempts::int from claimed), 2, 'the lost attempt still counted');
select is(pg_temp.deliver('c2000000-0000-4000-8000-000000000003'), 'delivered', 'and the retry is delivered');


-- ----------------------------------------------------------------------------
-- 5. Order by occurred_at first, then insertion order
-- ----------------------------------------------------------------------------

-- Written out of order: the later insert happened earlier.
insert into public.integration_events (id, webhook_id, milestone_id, project_id, status, cause, occurred_at)
values
  ('f2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
   'c2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
   'rejected', 'status_changed', now() + interval '2 seconds'),
  ('f2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001',
   'c2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
   'submitted', 'status_changed', now() + interval '1 second');

select is(pg_temp.claim(), 1, 'one head');
select is((select id from claimed), 'f2000000-0000-4000-8000-000000000002'::uuid,
  'the head is the earliest by occurred_at, whatever the insertion order');
select is(pg_temp.deliver('c2000000-0000-4000-8000-000000000001'), 'delivered', 'delivered');


-- ----------------------------------------------------------------------------
-- 6. Inactive webhooks
-- ----------------------------------------------------------------------------

update public.integration_webhooks set active = false;

select is(pg_temp.claim(), 0, 'events for an inactive webhook are not claimed');

update public.milestones set status = 'rejected' where id = 'c2000000-0000-4000-8000-000000000001';
select is(
  (select count(*) from public.integration_events
    where milestone_id = 'c2000000-0000-4000-8000-000000000001' and delivered_at is null and dead_at is null),
  1::bigint,
  'and an inactive webhook gets no new events (the one pending is the earlier test row)'
);

update public.integration_webhooks set active = true;
select is(pg_temp.claim(), 1, 'reactivated, its pending event is claimed again');


-- ----------------------------------------------------------------------------
-- 7. occurred_at is the time of the write, not of the transaction
-- ----------------------------------------------------------------------------

select pg_sleep(0.01);
update public.milestones set status = 'rejected' where id = 'c2000000-0000-4000-8000-000000000003';
select pg_sleep(0.01);
update public.milestones set status = 'approved' where id = 'c2000000-0000-4000-8000-000000000003';

select ok(
  (select bool_and(occurred_at > now()) from public.integration_events
    where milestone_id = 'c2000000-0000-4000-8000-000000000003' and delivered_at is null and dead_at is null),
  'occurred_at is clock time, later than the transaction''s start'
);
select ok(
  (select (array_agg(occurred_at order by seq))[1] < (array_agg(occurred_at order by seq))[2]
     from public.integration_events
    where milestone_id = 'c2000000-0000-4000-8000-000000000003' and delivered_at is null and dead_at is null),
  'two changes in one transaction get times in the order they were applied'
);
select is(pg_temp.claim(), 1, 'one head for that milestone');
select is((select status::text from claimed where milestone_id = 'c2000000-0000-4000-8000-000000000003'),
  'rejected', 'and it is the change applied first');


-- ----------------------------------------------------------------------------
-- 8. Pruning: delivered over 30 days ago goes, dead stays
-- ----------------------------------------------------------------------------

insert into public.integration_events (id, webhook_id, milestone_id, project_id, status, cause, occurred_at,
                                       attempts, delivered_at, dead_at)
values
  ('f3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
   'c2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001',
   'submitted', 'status_changed', now() - interval '40 days', 1, now() - interval '31 days', null),
  ('f3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001',
   'c2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001',
   'submitted', 'status_changed', now() - interval '40 days', 1, now() - interval '29 days', null),
  ('f3000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001',
   'c2000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000001',
   'submitted', 'status_changed', now() - interval '90 days', 8, null, now() - interval '89 days');

select pg_temp.claim_none();
select results_eq(
  $$ select id from public.integration_events
      where id::text like 'f3000000-%' order by id $$,
  $$ values ('f3000000-0000-4000-8000-000000000002'::uuid), ('f3000000-0000-4000-8000-000000000003'::uuid) $$,
  'a claim prunes events delivered over 30 days ago and keeps newer ones and dead ones'
);
select is(
  (select count(*) from public.integration_events
    where milestone_id = 'c2000000-0000-4000-8000-000000000003' and delivered_at is null and dead_at is null),
  2::bigint,
  'pending events are never pruned'
);


-- ----------------------------------------------------------------------------
-- 9. Shape and access
-- ----------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.integration_webhooks (client_id, link_source, target_url, secret_ciphertext)
     values ('other', 'other', 'https://x.test/hook', 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB') $$,
  '23514', null,
  'a webhook hears about doqtri links only (D-08)'
);
select throws_ok(
  $$ update public.integration_webhooks set target_url = 'http://www.doqtri.xyz/hook' $$,
  '23514', null,
  'a webhook URL is https (plain http only to the local machine)'
);
select throws_ok(
  $$ update public.integration_webhooks set secret_ciphertext = 'whsec_plain_text_secret' $$,
  '23514', null,
  'the secret column holds ciphertext, never a plain secret'
);

select ok(
  (select bool_and(c.relrowsecurity)
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('integration_webhooks', 'integration_events')),
  'RLS is enabled on both tables'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_policies p
     where p.schemaname = 'public'
       and p.tablename in ('integration_webhooks', 'integration_events')
       and p.permissive = 'PERMISSIVE'),
  'no permissive policy: no client role reads or writes either table'
);
select ok(
  not has_table_privilege('authenticated', 'public.integration_webhooks', 'select')
  and not has_table_privilege('authenticated', 'public.integration_events', 'select')
  and not has_table_privilege('anon', 'public.integration_webhooks', 'select')
  and not has_table_privilege('anon', 'public.integration_events', 'select')
  and not has_table_privilege('service_role', 'public.integration_webhooks', 'select')
  and not has_table_privilege('service_role', 'public.integration_events', 'insert,update,delete'),
  'no grants to anon or authenticated; service_role reads the outbox and nothing more'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_integration_events(integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.claim_integration_events(integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_integration_delivery(uuid, uuid, boolean, text, timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.claim_integration_events(integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.record_integration_delivery(uuid, uuid, boolean, text, timestamptz)', 'execute'),
  'the delivery functions are service_role only'
);
select ok(
  not has_function_privilege('authenticated', 'public.enqueue_integration_event(uuid, public.milestone_status, text)', 'execute')
  and not has_function_privilege('service_role', 'public.enqueue_integration_event(uuid, public.milestone_status, text)', 'execute'),
  'nobody but the triggers can enqueue'
);
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enqueue_integration_event', 'enqueue_milestone_status_event', 'enqueue_anchor_event',
                        'claim_integration_events', 'record_integration_delivery')),
  'every new function is SECURITY DEFINER with an empty search_path'
);


select * from finish();

rollback;
