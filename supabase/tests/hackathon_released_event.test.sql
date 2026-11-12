-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/hackathon_released_event.test.sql
--
-- Covers 20261112150000_hackathon_released_event.sql (QDIT-67, contract
-- v1.5.0 section 9): release_hackathon_grades() queues exactly one
-- hackathon.released event per hackathon, with the body columns the cron
-- route signs and sends; a second release, a refused release, a rolled-back
-- release and a later edit of released_at queue nothing; the event goes to
-- the doqtri webhook (queued while it is inactive, sent once active); it is
-- claimed, retried, dead-lettered and settled by the same functions as
-- milestone.status_changed, and it neither waits behind a milestone's queue
-- nor holds one up; the shape check keeps each type to its own columns; and
-- none of it is reachable by a client role.
--
-- Run with `supabase test db` against a local stack. One transaction, rolled
-- back, so now() is one instant throughout (see integration_webhooks.test.sql).
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(38);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- u1 is admin of every hackathon here; u2 is a plain user.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a6700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'rel-admin@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Admin","username":"rel_admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a6700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'rel-user@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"User","username":"rel_user"}', now(), now());

-- H1, H2 closed and releasable; H3 still open; H4 created already released
-- (operator SQL), H5 released with the trigger off (stands in for a
-- hackathon released before the migration, for the backfill's function).
insert into public.hackathons (id, slug, name, opens_at, closes_at)
values
  ('c6700000-0000-4000-8000-000000000001', 'rel-one',   'One',   now() - interval '3 hours', now() - interval '1 hour'),
  ('c6700000-0000-4000-8000-000000000002', 'rel-two',   'Two',   now() - interval '3 hours', now() - interval '1 hour'),
  ('c6700000-0000-4000-8000-000000000003', 'rel-open',  'Open',  now() - interval '1 hour',  now() + interval '1 hour');

insert into public.hackathon_staff (hackathon_id, user_id, role)
values
  ('c6700000-0000-4000-8000-000000000001', 'a6700000-0000-4000-8000-000000000001', 'admin'),
  ('c6700000-0000-4000-8000-000000000002', 'a6700000-0000-4000-8000-000000000001', 'admin'),
  ('c6700000-0000-4000-8000-000000000003', 'a6700000-0000-4000-8000-000000000001', 'admin');

-- doqtri's webhook (link_source defaults to 'doqtri').
insert into public.integration_webhooks (id, client_id, target_url, secret_ciphertext)
values ('e6700000-0000-4000-8000-000000000001', '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
        'https://www.doqtri.xyz/api/integrations/qdit/webhook',
        'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');

-- A linked milestone, for the queue tests in section 5.
insert into public.projects (id, owner_id, name, slug)
values ('b6700000-0000-4000-8000-000000000001', 'a6700000-0000-4000-8000-000000000002', 'Rel', 'rel-test');
insert into public.milestones (id, project_id, title, status, order_index)
values ('d6700000-0000-4000-8000-000000000001', 'b6700000-0000-4000-8000-000000000001', 'Escrow', 'proposed', 0);
insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url, linked_by)
values ('b6700000-0000-4000-8000-000000000001', 'f6700000-0000-4000-8000-000000000001', 'Plan',
        'https://www.doqtri.xyz/d/f6700000-0000-4000-8000-000000000001', 'a6700000-0000-4000-8000-000000000002');
insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label, created_by)
values ('d6700000-0000-4000-8000-000000000001', 'b6700000-0000-4000-8000-000000000001',
        'f6700000-0000-4000-8000-000000000001', 'h1', 'Escrow', 'a6700000-0000-4000-8000-000000000002');


-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

create function pg_temp.as_session(p_user uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'aud', 'authenticated'
  )::text, true);
$$;

create function pg_temp.as_postgres() returns void
language sql as $$
  select set_config('role', 'postgres', true);
  select set_config('request.jwt.claims', '', true);
$$;

create function pg_temp.released_events(p_hackathon uuid) returns bigint
language sql as $$
  select count(*) from public.integration_events
   where hackathon_id = p_hackathon and event = 'hackathon.released'
$$;

create temp table claimed (
  id uuid, milestone_id uuid, event text, status text, hackathon_slug text, released_at timestamptz,
  occurred_at timestamptz, attempts integer, claim_token uuid, target_url text
) on commit drop;
grant all on claimed to service_role;

create function pg_temp.claim() returns integer
language plpgsql as $$
begin
  truncate claimed;
  perform set_config('role', 'service_role', true);
  insert into claimed
  select c.id, c.milestone_id, c.event, c.status::text, c.hackathon_slug, c.released_at,
         c.occurred_at, c.attempts, c.claim_token, c.target_url
    from public.claim_integration_events(20, 120) c;
  perform set_config('role', 'postgres', true);
  return (select count(*) from claimed);
end;
$$;

-- Settles the claimed event of one hackathon slug (or of one milestone).
create function pg_temp.report(p_slug text, p_delivered boolean, p_retry boolean default true) returns text
language plpgsql as $$
declare
  v_outcome text;
begin
  perform set_config('role', 'service_role', true);
  select public.record_integration_delivery(c.id, c.claim_token, p_delivered,
           case when p_delivered then null else 'HTTP 503' end,
           case when not p_delivered and p_retry then now() - interval '1 second' end)
    into v_outcome
    from claimed c
   where c.hackathon_slug = p_slug;
  perform set_config('role', 'postgres', true);
  return v_outcome;
end;
$$;


-- ----------------------------------------------------------------------------
-- 1. Schema
-- ----------------------------------------------------------------------------

select has_column('public', 'integration_events', 'hackathon_id', 'integration_events.hackathon_id exists');
select has_column('public', 'integration_events', 'hackathon_slug', 'integration_events.hackathon_slug exists');
select has_column('public', 'integration_events', 'released_at', 'integration_events.released_at exists');
select has_trigger('public', 'hackathons', 'hackathons_enqueue_released_event', 'the release trigger is on hackathons');


-- ----------------------------------------------------------------------------
-- 2. Release queues exactly one event
-- ----------------------------------------------------------------------------

select is(pg_temp.released_events('c6700000-0000-4000-8000-000000000001'), 0::bigint,
  'nothing is queued before release');

-- Refused releases queue nothing: not an admin, not closed yet.
select pg_temp.as_session('a6700000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select public.release_hackathon_grades('c6700000-0000-4000-8000-000000000001') $$,
  '42501', null, 'release: refused for a non-admin'
);
select pg_temp.as_session('a6700000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.release_hackathon_grades('c6700000-0000-4000-8000-000000000003') $$,
  'QD409', 'hackathon_not_closed', 'release: refused before closes_at'
);
select pg_temp.as_postgres();
select is((select count(*) from public.integration_events where event = 'hackathon.released'), 0::bigint,
  'a refused release queues nothing');

-- A release that rolls back queues nothing either: the trigger writes in
-- the release's own transaction.
savepoint before_rollback;
select pg_temp.as_session('a6700000-0000-4000-8000-000000000001');
select public.release_hackathon_grades('c6700000-0000-4000-8000-000000000002');
rollback to savepoint before_rollback;
select pg_temp.as_postgres();
select is(pg_temp.released_events('c6700000-0000-4000-8000-000000000002'), 0::bigint,
  'a rolled-back release leaves no event');

select pg_temp.as_session('a6700000-0000-4000-8000-000000000001');
select is(public.release_hackathon_grades('c6700000-0000-4000-8000-000000000001'), 0,
  'release: H1 released (no entries, no finalists)');
select pg_temp.as_postgres();

select is(pg_temp.released_events('c6700000-0000-4000-8000-000000000001'), 1::bigint,
  'releasing grades queues one hackathon.released event');
select results_eq(
  $$ select e.webhook_id, e.event, e.cause, e.hackathon_slug, e.released_at = date_trunc('milliseconds', h.released_at),
            e.milestone_id is null and e.project_id is null and e.status is null,
            e.attempts::int, e.delivered_at is null and e.dead_at is null, e.next_attempt_at <= now()
       from public.integration_events e
       join public.hackathons h on h.id = e.hackathon_id
      where e.hackathon_id = 'c6700000-0000-4000-8000-000000000001' $$,
  $$ values ('e6700000-0000-4000-8000-000000000001'::uuid, 'hackathon.released', 'hackathon_released', 'rel-one',
             true, true, 0, true, true) $$,
  'the event goes to the doqtri webhook with the slug and released_at (in ms), nothing of a milestone, due at once'
);
select ok(
  (select occurred_at = date_trunc('milliseconds', occurred_at) and released_at = date_trunc('milliseconds', released_at)
     from public.integration_events where hackathon_id = 'c6700000-0000-4000-8000-000000000001'),
  'both timestamps are whole milliseconds, so every retry sends the same body bytes'
);

-- Exactly once.
select pg_temp.as_session('a6700000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.release_hackathon_grades('c6700000-0000-4000-8000-000000000001') $$,
  'QD409', 'already_released', 'a second release is refused'
);
select pg_temp.as_postgres();
select is(pg_temp.released_events('c6700000-0000-4000-8000-000000000001'), 1::bigint,
  'a second release attempt queues nothing');

update public.hackathons set released_at = released_at + interval '1 minute'
 where id = 'c6700000-0000-4000-8000-000000000001';
select is(pg_temp.released_events('c6700000-0000-4000-8000-000000000001'), 1::bigint,
  'an operator edit of an already set released_at queues nothing');

select public.enqueue_hackathon_released_event('c6700000-0000-4000-8000-000000000001');
select is(pg_temp.released_events('c6700000-0000-4000-8000-000000000001'), 1::bigint,
  'enqueueing again (the backfill run twice) adds nothing: one per hackathon and webhook');

select public.enqueue_hackathon_released_event('c6700000-0000-4000-8000-000000000003');
select is(pg_temp.released_events('c6700000-0000-4000-8000-000000000003'), 0::bigint,
  'the enqueue function writes nothing for a hackathon that is not released');


-- ----------------------------------------------------------------------------
-- 3. Hackathons released some other way
-- ----------------------------------------------------------------------------

insert into public.hackathons (id, slug, name, opens_at, closes_at, released_at)
values ('c6700000-0000-4000-8000-000000000004', 'rel-preset', 'Preset',
        now() - interval '3 days', now() - interval '2 days', now() - interval '1 day');
select is(pg_temp.released_events('c6700000-0000-4000-8000-000000000004'), 1::bigint,
  'a hackathon inserted already released gets its one event');

-- Released before the migration: what the backfill does for each.
alter table public.hackathons disable trigger hackathons_enqueue_released_event_on_insert;
insert into public.hackathons (id, slug, name, opens_at, closes_at, released_at)
values ('c6700000-0000-4000-8000-000000000005', 'rel-old', 'Old',
        now() - interval '30 days', now() - interval '29 days', '2026-10-01T09:30:00.123456Z');
alter table public.hackathons enable trigger hackathons_enqueue_released_event_on_insert;
select is(pg_temp.released_events('c6700000-0000-4000-8000-000000000005'), 0::bigint,
  'fixture: an older release has no event yet');
select public.enqueue_hackathon_released_event('c6700000-0000-4000-8000-000000000005');
select is(
  (select released_at from public.integration_events where hackathon_id = 'c6700000-0000-4000-8000-000000000005'),
  '2026-10-01T09:30:00.123Z'::timestamptz,
  'the backfill sends an older release with its original released_at, cut to milliseconds'
);


-- ----------------------------------------------------------------------------
-- 4. An inactive doqtri webhook still gets it, once active
-- ----------------------------------------------------------------------------

update public.integration_webhooks set active = false where id = 'e6700000-0000-4000-8000-000000000001';
select pg_temp.as_session('a6700000-0000-4000-8000-000000000001');
select public.release_hackathon_grades('c6700000-0000-4000-8000-000000000002');
select pg_temp.as_postgres();
select is(pg_temp.released_events('c6700000-0000-4000-8000-000000000002'), 1::bigint,
  'a release while doqtri''s webhook is inactive is still queued');
select is(pg_temp.claim(), 0, 'and not claimed while the webhook is inactive');
update public.integration_webhooks set active = true where id = 'e6700000-0000-4000-8000-000000000001';


-- ----------------------------------------------------------------------------
-- 5. Claimed, retried and settled like milestone.status_changed
-- ----------------------------------------------------------------------------

-- A milestone event whose queue is busy: a first event, then a second
-- behind it.
update public.milestones set status = 'submitted' where id = 'd6700000-0000-4000-8000-000000000001';
update public.milestones set status = 'approved'  where id = 'd6700000-0000-4000-8000-000000000001';

select is(pg_temp.claim(), 5,
  'one claim takes every release event (each its own queue) and the head of the milestone''s queue');
select results_eq(
  $$ select event, hackathon_slug, milestone_id is null, status, attempts, target_url
       from claimed where event = 'hackathon.released' order by hackathon_slug $$,
  $$ values ('hackathon.released', 'rel-old', true, null::text, 1, 'https://www.doqtri.xyz/api/integrations/qdit/webhook'),
            ('hackathon.released', 'rel-one', true, null::text, 1, 'https://www.doqtri.xyz/api/integrations/qdit/webhook'),
            ('hackathon.released', 'rel-preset', true, null::text, 1, 'https://www.doqtri.xyz/api/integrations/qdit/webhook'),
            ('hackathon.released', 'rel-two', true, null::text, 1, 'https://www.doqtri.xyz/api/integrations/qdit/webhook') $$,
  'the claim returns the release body columns (slug, released_at) and counts the attempt'
);
select results_eq(
  $$ select event, status from claimed where milestone_id is not null $$,
  $$ values ('milestone.status_changed', 'submitted') $$,
  'the milestone''s order is unchanged: only its earlier event is claimed (D-25)'
);
select ok(
  (select bool_and(c.released_at = e.released_at) from claimed c join public.integration_events e on e.id = c.id
    where c.event = 'hackathon.released'),
  'the claimed released_at is the stored one'
);

select is(pg_temp.report('rel-one', false), 'retry', 'a failed attempt is retried');
select is(pg_temp.report('rel-two', true), 'delivered', 'a 2xx settles it as delivered');
select is(pg_temp.report('rel-two', true), 'stale', 'a repeated report changes nothing');

-- The milestone's head stays unsettled; the release retry is claimed anyway.
select is(pg_temp.claim(), 1, 'the retry is due again, while the busy milestone queue is still leased');
select results_eq(
  $$ select hackathon_slug, attempts from claimed $$,
  $$ values ('rel-one', 2) $$,
  'the retry is the same event, its attempt counted'
);
select is(pg_temp.report('rel-one', false, false), 'dead', 'no next attempt: dead, kept for inspection');
select ok(
  (select dead_at is not null and last_error = 'HTTP 503'
     from public.integration_events where hackathon_id = 'c6700000-0000-4000-8000-000000000001'),
  'the dead event stays in the outbox with its error'
);


-- ----------------------------------------------------------------------------
-- 6. Shape and access
-- ----------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.integration_events (webhook_id, event, cause, hackathon_id, hackathon_slug, released_at, milestone_id)
     values ('e6700000-0000-4000-8000-000000000001', 'hackathon.released', 'hackathon_released',
             'c6700000-0000-4000-8000-000000000003', 'rel-open', now(), 'd6700000-0000-4000-8000-000000000001') $$,
  '23514', null, 'a release event cannot carry a milestone'
);
select throws_ok(
  $$ insert into public.integration_events (webhook_id, cause, status)
     values ('e6700000-0000-4000-8000-000000000001', 'status_changed', 'submitted') $$,
  '23514', null, 'a milestone event still needs its milestone and project'
);

select ok(
  not has_function_privilege('authenticated', 'public.enqueue_hackathon_released_event(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.enqueue_hackathon_released_event(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.enqueue_hackathon_released_event(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.enqueue_hackathon_release()', 'execute'),
  'the enqueue functions are for Postgres only'
);
select ok(
  has_function_privilege('service_role', 'public.claim_integration_events(integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_integration_events(integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.claim_integration_events(integer, integer)', 'execute'),
  'the recreated claim keeps its grants: service_role only'
);

select * from finish();
rollback;
