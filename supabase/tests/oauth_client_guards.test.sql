-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/oauth_client_guards.test.sql
--
-- Covers 20261024110000_oauth_client_guards.sql: a request whose JWT carries a
-- `client_id` claim (a token Supabase's OAuth server issued to doqtri) may read
-- projects, milestones, anchors (D-32), and its user's own profile and own
-- membership rows (their role, not the roster), may create proposed
-- milestones, and may see or change nothing else — while the same user's own
-- session keeps every right it had.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back, so it leaves
-- no rows behind and does not collide with supabase/seed.sql.
--
-- How the two kinds of caller are simulated: PostgREST runs each request as
-- the JWT's role with the claims in `request.jwt.claims`. The helpers below set
-- exactly those two things, which is all auth.uid() and auth.jwt() read.
--
-- A note on reading the assertions. RLS answers a refused INSERT with an error
-- (42501), but a refused SELECT, UPDATE or DELETE by filtering the row out of
-- the statement: it succeeds and touches nothing. So inserts are checked with
-- throws_ok, reads by counting rows, and updates and deletes by checking the
-- row afterwards — as postgres when the table is one the app cannot read, or
-- the check would see nothing either way.
--
-- A 42501 does not say which policy refused, and the permissive ones raise the
-- same code. So every insert an OAuth client is refused is also made, the same
-- statement for the same user, under that user's session in section 3, where
-- it must succeed: that is what shows the guard, and nothing else, said no.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(64);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres: RLS does not apply to the table owner)
-- ----------------------------------------------------------------------------

-- u1 owns the project, u2 is an admin in it, u3 is a stranger to be invited.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'oauth-owner@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Owner","username":"oauth_owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'oauth-admin@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Admin","username":"oauth_admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'oauth-guest@qdit.test', '{"provider":"email","providers":["email"],"wallet_address":"GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"}',
   '{"full_name":"Guest","username":"oauth_guest"}', now(), now());

-- on_project_created makes u1 the owner member.
insert into public.projects (id, owner_id, name, slug)
values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'OAuth guard', 'oauth-guard-test'),
  -- A project u1 is not in, for the "only where a member" case.
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Elsewhere', 'oauth-guard-elsewhere');

insert into public.project_members (project_id, user_id, role)
values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'admin');

insert into public.milestones (id, project_id, title, status)
values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Escrow contract', 'submitted');

insert into public.tasks (id, project_id, title)
values ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Write tests');

insert into public.notifications (id, recipient_id, project_id, milestone_id, kind, body)
values ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
        'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
        'milestone_submitted', 'Submitted for approval: Escrow contract (OAuth guard)');

-- One row in each of the other tables, so "an app sees none" is a real zero
-- and not an empty table.
insert into public.stellar_proofs (project_id, milestone_id, proof_url, created_by)
values ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
        'https://example.com/proof', 'a0000000-0000-4000-8000-000000000001');

insert into public.deployments (project_id, status, network, deployed_by)
values ('b0000000-0000-4000-8000-000000000001', 'testnet', 'testnet', 'a0000000-0000-4000-8000-000000000001');

insert into public.milestone_reviews (milestone_id, project_id, from_status, to_status, reason, reviewer_id)
values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
        'proposed', 'submitted', null, 'a0000000-0000-4000-8000-000000000001');

insert into public.milestone_anchors (milestone_id, project_id, action, proof_hash, version, contract_id, tx_hash, signer_address, created_by)
values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'submit',
        repeat('c', 64), 1, 'CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG', repeat('d', 64),
        'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', 'a0000000-0000-4000-8000-000000000001');


-- ----------------------------------------------------------------------------
-- Caller switches
-- ----------------------------------------------------------------------------

create function pg_temp.as_oauth_client(p_user uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_user,
    'role', 'authenticated',
    'aud', 'authenticated',
    'client_id', '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d'
  )::text, true);
$$;

create function pg_temp.as_session(p_user uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_user,
    'role', 'authenticated',
    'aud', 'authenticated'
  )::text, true);
$$;

create function pg_temp.as_postgres() returns void
language sql as $$
  select set_config('role', 'postgres', true);
  select set_config('request.jwt.claims', '', true);
$$;


-- ----------------------------------------------------------------------------
-- 1. Every public table is guarded
--
-- A tripwire for the rule in the migration header: a table added later without
-- its restrictive policies fails here rather than shipping writable, or
-- readable, by every connected app.
-- ----------------------------------------------------------------------------

select is_empty(
  $$
    select t.tablename, c.cmd
      from pg_catalog.pg_tables t
     cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as c (cmd)
     where t.schemaname = 'public'
       and not exists (
         select 1
           from pg_catalog.pg_policies p
          where p.schemaname = 'public'
            and p.tablename = t.tablename
            and p.cmd = c.cmd
            and p.permissive = 'RESTRICTIVE'
       )
  $$,
  'every public table has a restrictive policy for INSERT, UPDATE and DELETE'
);

-- Reads: the tables D-03 lets an app read are named here, deliberately, and
-- every other table must hide itself. Adding a name to this list is a decision
-- about what doqtri can see, and the consent screen's wording has to follow it
-- (web/src/lib/auth/oauth-consent.ts, APP_READ_SCOPE).
select is_empty(
  $$
    select t.tablename
      from pg_catalog.pg_tables t
     where t.schemaname = 'public'
       and t.tablename not in ('projects', 'milestones', 'milestone_anchors')
       and not exists (
         select 1
           from pg_catalog.pg_policies p
          where p.schemaname = 'public'
            and p.tablename = t.tablename
            and p.cmd = 'SELECT'
            and p.permissive = 'RESTRICTIVE'
       )
  $$,
  'every public table an app may not read has a restrictive SELECT policy'
);

-- And the other direction: the tables an app may read carry no SELECT guard
-- at all, so a later one cannot quietly take them away. milestone_anchors is
-- here by D-32 — the `anchor` object of GET /milestones/{id} is read from it.
select is_empty(
  $$
    select p.tablename, p.policyname
      from pg_catalog.pg_policies p
     where p.schemaname = 'public'
       and p.tablename in ('projects', 'milestones', 'milestone_anchors')
       and p.cmd = 'SELECT'
       and p.permissive = 'RESTRICTIVE'
  $$,
  'the tables an app may read (D-03, D-32) have no restrictive SELECT policy'
);

select ok(
  (select bool_and(c.relrowsecurity)
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'),
  'RLS is enabled on every public table'
);


-- ----------------------------------------------------------------------------
-- 2. OAuth client acting for the project owner
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a0000000-0000-4000-8000-000000000001');

-- What D-03 lets it read.
select is(
  (select count(*)::int from public.milestones where project_id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'oauth: can read milestones of a member project'
);
select is(
  (select count(*)::int from public.projects where id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'oauth: can read a member project'
);
-- Its own membership row, which is how /api/v1 learns the caller's role.
select is(
  (select array_agg(user_id::text || ':' || role::text)
     from public.project_members where project_id = 'b0000000-0000-4000-8000-000000000001'),
  array['a0000000-0000-4000-8000-000000000001:owner'],
  'oauth: can read only its own membership row of a member project'
);
select is(
  (select count(*)::int from public.milestone_anchors where milestone_id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'oauth: can read a milestone''s anchors'
);
-- Every field the contract's `anchor` object needs, not only the row (D-32).
select is(
  (select row(version, action::text, tx_hash, created_at is not null, proof_hash)::text
     from public.milestone_anchors
    where milestone_id = 'c0000000-0000-4000-8000-000000000001'),
  row(1, 'submit', repeat('d', 64), true, repeat('c', 64))::text,
  'oauth: can read the anchor fields GET /milestones/{id} serves'
);
select is(
  (select count(*)::int from public.profiles where id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'oauth: can read the user''s own profile'
);

-- And nothing else.
select is(
  (select count(*)::int from public.profiles where id = 'a0000000-0000-4000-8000-000000000002'),
  0,
  'oauth: cannot read a teammate''s profile'
);
select is(
  (select count(*)::int from public.project_members where user_id = 'a0000000-0000-4000-8000-000000000002'),
  0,
  'oauth: cannot read a teammate''s membership (the roster)'
);
select is(
  (select count(*)::int from public.tasks),
  0,
  'oauth: cannot read tasks'
);
select is(
  (select count(*)::int from public.stellar_proofs),
  0,
  'oauth: cannot read proofs of work'
);
select is(
  (select count(*)::int from public.deployments),
  0,
  'oauth: cannot read deployments'
);
select is(
  (select count(*)::int from public.milestone_reviews),
  0,
  'oauth: cannot read review decisions'
);
select is(
  (select count(*)::int from public.notifications),
  0,
  'oauth: cannot read notifications'
);

-- Creating a milestone is the one write it keeps.
select lives_ok(
  $$ insert into public.milestones (id, project_id, title)
     values ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'From doqtri') $$,
  'oauth: can insert a milestone in a project it is a member of'
);
select throws_ok(
  $$ insert into public.milestones (project_id, title, status)
     values ('b0000000-0000-4000-8000-000000000001', 'Pre-approved', 'approved') $$,
  '42501', null,
  'oauth: cannot insert a milestone that is already approved'
);
select throws_ok(
  $$ insert into public.milestones (project_id, title, status)
     values ('b0000000-0000-4000-8000-000000000001', 'Pre-submitted', 'submitted') $$,
  '42501', null,
  'oauth: cannot insert a milestone that is already submitted'
);
select throws_ok(
  $$ insert into public.milestones (project_id, title)
     values ('b0000000-0000-4000-8000-000000000002', 'Not my project') $$,
  '42501', null,
  'oauth: cannot insert a milestone in a project it is not a member of'
);

-- Approve / reject.
update public.milestones set status = 'approved'
 where id = 'c0000000-0000-4000-8000-000000000001';
select is(
  (select status::text from public.milestones where id = 'c0000000-0000-4000-8000-000000000001'),
  'submitted',
  'oauth: cannot approve a milestone'
);
update public.milestones set status = 'rejected'
 where id = 'c0000000-0000-4000-8000-000000000001';
select is(
  (select status::text from public.milestones where id = 'c0000000-0000-4000-8000-000000000001'),
  'submitted',
  'oauth: cannot reject a milestone'
);
select throws_ok(
  $$ insert into public.milestone_reviews (milestone_id, project_id, from_status, to_status, reason, reviewer_id)
     values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
             'submitted', 'rejected', 'No tests', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'oauth: cannot record a review decision'
);
-- Not even a title, until WP-2.4.
update public.milestones set title = 'Renamed'
 where id = 'c0000000-0000-4000-8000-000000000001';
select is(
  (select title from public.milestones where id = 'c0000000-0000-4000-8000-000000000001'),
  'Escrow contract',
  'oauth: cannot rename a milestone (WP-2.4 adds title-only for linked ones)'
);
delete from public.milestones where id = 'c0000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.milestones where id = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'oauth: cannot delete a milestone'
);

-- Projects.
delete from public.projects where id = 'b0000000-0000-4000-8000-000000000001';
select is(
  (select count(*)::int from public.projects where id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'oauth: cannot delete a project'
);
update public.projects set name = 'Hijacked' where id = 'b0000000-0000-4000-8000-000000000001';
select is(
  (select name from public.projects where id = 'b0000000-0000-4000-8000-000000000001'),
  'OAuth guard',
  'oauth: cannot edit a project'
);
select throws_ok(
  $$ insert into public.projects (owner_id, name, slug)
     values ('a0000000-0000-4000-8000-000000000001', 'New', 'oauth-guard-new') $$,
  '42501', null,
  'oauth: cannot create a project'
);

-- Members.
select throws_ok(
  $$ insert into public.project_members (project_id, user_id, role)
     values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'member') $$,
  '42501', null,
  'oauth: cannot add a member directly'
);
-- u2's row is hidden from the app, so these are checked as postgres.
update public.project_members set role = 'viewer'
 where project_id = 'b0000000-0000-4000-8000-000000000001'
   and user_id = 'a0000000-0000-4000-8000-000000000002';
select pg_temp.as_postgres();
select is(
  (select role::text from public.project_members
    where project_id = 'b0000000-0000-4000-8000-000000000001'
      and user_id = 'a0000000-0000-4000-8000-000000000002'),
  'admin',
  'oauth: cannot change a member''s role'
);
select pg_temp.as_oauth_client('a0000000-0000-4000-8000-000000000001');
delete from public.project_members
 where project_id = 'b0000000-0000-4000-8000-000000000001'
   and user_id = 'a0000000-0000-4000-8000-000000000002';
select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.project_members
    where project_id = 'b0000000-0000-4000-8000-000000000001'
      and user_id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'oauth: cannot remove a member'
);
-- Nor take the user out of the project: "leave" is a delete of their own row,
-- which the app can see.
select pg_temp.as_oauth_client('a0000000-0000-4000-8000-000000000001');
delete from public.project_members
 where project_id = 'b0000000-0000-4000-8000-000000000001'
   and user_id = 'a0000000-0000-4000-8000-000000000001';
select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.project_members
    where project_id = 'b0000000-0000-4000-8000-000000000001'
      and user_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'oauth: cannot remove the user from a project'
);
select pg_temp.as_oauth_client('a0000000-0000-4000-8000-000000000001');

-- The SECURITY DEFINER invites, which RLS cannot see into.
select throws_ok(
  $$ select public.add_project_member_by_username('b0000000-0000-4000-8000-000000000001', 'oauth_guest', 'member') $$,
  '42501', 'Apps connected through OAuth cannot do this.',
  'oauth: add_project_member_by_username refuses'
);
select throws_ok(
  $$ select public.add_project_member_by_email('b0000000-0000-4000-8000-000000000001', 'oauth-guest@qdit.test', 'member') $$,
  '42501', 'Apps connected through OAuth cannot do this.',
  'oauth: add_project_member_by_email refuses'
);
select throws_ok(
  $$ select public.add_project_member_by_wallet('b0000000-0000-4000-8000-000000000001',
       'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', 'member') $$,
  '42501', 'Apps connected through OAuth cannot do this.',
  'oauth: add_project_member_by_wallet refuses'
);

-- Everything else.
select throws_ok(
  $$ insert into public.tasks (project_id, title)
     values ('b0000000-0000-4000-8000-000000000001', 'From an app') $$,
  '42501', null,
  'oauth: cannot create a task'
);
delete from public.tasks where id = 'd0000000-0000-4000-8000-000000000001';
select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.tasks where id = 'd0000000-0000-4000-8000-000000000001'),
  1,
  'oauth: cannot delete a task'
);
select pg_temp.as_oauth_client('a0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ insert into public.stellar_proofs (project_id, proof_url, created_by)
     values ('b0000000-0000-4000-8000-000000000001', 'https://example.com', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'oauth: cannot attach a proof'
);
select throws_ok(
  $$ insert into public.deployments (project_id, status)
     values ('b0000000-0000-4000-8000-000000000001', 'not_started') $$,
  '42501', null,
  'oauth: cannot log a deployment'
);
select throws_ok(
  $$ insert into public.milestone_anchors (milestone_id, project_id, action, proof_hash, version, contract_id, tx_hash, signer_address, created_by)
     values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'submit',
             repeat('a', 64), 1, 'CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG', repeat('b', 64),
             'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'oauth: cannot record an anchor'
);
update public.notifications set read_at = now()
 where id = 'e0000000-0000-4000-8000-000000000001';
select pg_temp.as_postgres();
select ok(
  (select read_at is null from public.notifications where id = 'e0000000-0000-4000-8000-000000000001'),
  'oauth: cannot mark a notification read'
);
select pg_temp.as_oauth_client('a0000000-0000-4000-8000-000000000001');
update public.profiles set display_name = 'Set by an app'
 where id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select display_name from public.profiles where id = 'a0000000-0000-4000-8000-000000000001'),
  'Owner',
  'oauth: cannot edit the user''s profile'
);


-- ----------------------------------------------------------------------------
-- 3. The same user's own session is unaffected
--
-- Including every insert section 2 saw refused, verbatim: each one passing here
-- is what pins that refusal on the guard rather than on a permissive policy.
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a0000000-0000-4000-8000-000000000001');

-- Reads the app could not make.
select is(
  (select count(*)::int from public.profiles where id = 'a0000000-0000-4000-8000-000000000002'),
  1,
  'session: can read a teammate''s profile'
);
select is(
  (select count(*)::int from public.project_members where project_id = 'b0000000-0000-4000-8000-000000000001'),
  2,
  'session: can read the whole roster of a member project'
);
select is(
  (select count(*)::int from public.tasks where project_id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'session: can read tasks'
);
select is(
  (select count(*)::int from public.stellar_proofs where project_id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'session: can read proofs of work'
);
select is(
  (select count(*)::int from public.deployments where project_id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'session: can read deployments'
);
select is(
  (select count(*)::int from public.milestone_reviews where project_id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'session: can read review decisions'
);
select is(
  (select count(*)::int from public.notifications where recipient_id = 'a0000000-0000-4000-8000-000000000001'),
  1,
  'session: can read own notifications'
);

-- The inserts section 2 refused.
select lives_ok(
  $$ insert into public.milestone_reviews (milestone_id, project_id, from_status, to_status, reason, reviewer_id)
     values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
             'submitted', 'rejected', 'No tests', 'a0000000-0000-4000-8000-000000000001') $$,
  'session: can record a review decision'
);
select lives_ok(
  $$ insert into public.milestones (project_id, title, status)
     values ('b0000000-0000-4000-8000-000000000001', 'Pre-approved', 'approved') $$,
  'session: may still insert a milestone in any status'
);
select lives_ok(
  $$ insert into public.projects (owner_id, name, slug)
     values ('a0000000-0000-4000-8000-000000000001', 'New', 'oauth-guard-new') $$,
  'session: can create a project'
);
select lives_ok(
  $$ insert into public.project_members (project_id, user_id, role)
     values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'member') $$,
  'session: can add a member directly'
);
select lives_ok(
  $$ insert into public.tasks (project_id, title)
     values ('b0000000-0000-4000-8000-000000000001', 'From an app') $$,
  'session: can create a task'
);
select lives_ok(
  $$ insert into public.stellar_proofs (project_id, proof_url, created_by)
     values ('b0000000-0000-4000-8000-000000000001', 'https://example.com', 'a0000000-0000-4000-8000-000000000001') $$,
  'session: can attach a proof'
);
select lives_ok(
  $$ insert into public.deployments (project_id, status)
     values ('b0000000-0000-4000-8000-000000000001', 'not_started') $$,
  'session: can log a deployment'
);
select lives_ok(
  $$ insert into public.milestone_anchors (milestone_id, project_id, action, proof_hash, version, contract_id, tx_hash, signer_address, created_by)
     values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'submit',
             repeat('a', 64), 1, 'CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG', repeat('b', 64),
             'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', 'a0000000-0000-4000-8000-000000000001') $$,
  'session: can record an anchor'
);

-- The writes section 2 saw filtered out.
update public.milestones set status = 'approved'
 where id = 'c0000000-0000-4000-8000-000000000001';
select is(
  (select status::text from public.milestones where id = 'c0000000-0000-4000-8000-000000000001'),
  'approved',
  'session: can approve a milestone'
);
update public.notifications set read_at = now()
 where id = 'e0000000-0000-4000-8000-000000000001';
select ok(
  (select read_at is not null from public.notifications where id = 'e0000000-0000-4000-8000-000000000001'),
  'session: can mark own notification read'
);
update public.profiles set display_name = 'Owner, renamed'
 where id = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select display_name from public.profiles where id = 'a0000000-0000-4000-8000-000000000001'),
  'Owner, renamed',
  'session: can edit own profile'
);
delete from public.project_members
 where project_id = 'b0000000-0000-4000-8000-000000000001'
   and user_id = 'a0000000-0000-4000-8000-000000000003';
select is(
  (select count(*)::int from public.project_members
    where project_id = 'b0000000-0000-4000-8000-000000000001'
      and user_id = 'a0000000-0000-4000-8000-000000000003'),
  0,
  'session: can remove a member'
);
-- After the removal, so the invite does not collide with the direct insert.
select lives_ok(
  $$ select public.add_project_member_by_username('b0000000-0000-4000-8000-000000000001', 'oauth_guest', 'member') $$,
  'session: add_project_member_by_username works'
);
delete from public.projects where id = 'b0000000-0000-4000-8000-000000000001';

select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.projects where id = 'b0000000-0000-4000-8000-000000000001'),
  0,
  'session: owner can delete the project'
);


select * from finish();

rollback;
