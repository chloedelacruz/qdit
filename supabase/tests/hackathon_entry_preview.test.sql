-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/hackathon_entry_preview.test.sql
--
-- Covers 20261110110000_hackathon_entry_preview.sql (QDIT-55, WP-4.7):
-- preview_hackathon_entry() refuses whoever submit_hackathon_entry() refuses
-- for the same checks, returns the qdit snapshot and the newest doqtri
-- snapshot submit would freeze, and writes nothing.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- u1 owner of P1 and P2, u2 admin of P1, u3 member of P1, u4 in no project.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('a5500000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated',
       'pv-' || n || '@qdit.test',
       '{"provider":"email","providers":["email"]}',
       jsonb_build_object('full_name', 'Pv ' || n, 'username', 'pv_u' || n),
       now(), now()
  from generate_series(1, 4) as n;

insert into public.projects (id, owner_id, name, slug)
values
  ('b5500000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000001', 'Pv one', 'pv-one'),
  ('b5500000-0000-4000-8000-000000000002', 'a5500000-0000-4000-8000-000000000001', 'Pv two', 'pv-two');

insert into public.project_members (project_id, user_id, role)
values
  ('b5500000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000002', 'admin'),
  ('b5500000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000003', 'member');

insert into public.tasks (project_id, title, status)
values ('b5500000-0000-4000-8000-000000000001', 'Pv task', 'todo');

-- H1 open now, H2 closed an hour ago.
insert into public.hackathons (id, slug, name, opens_at, closes_at, finalist_count)
values
  ('c5500000-0000-4000-8000-000000000001', 'pv-open',   'Open',   now() - interval '1 hour',  now() + interval '1 hour', 10),
  ('c5500000-0000-4000-8000-000000000002', 'pv-closed', 'Closed', now() - interval '3 hours', now() - interval '1 hour', 10);

-- Two pushes for (H1, P1): the newer one is what submit would attach.
insert into public.hackathon_doqtri_snapshots
  (snapshot_id, hackathon_id, project_id, workspace_id, client_id, payload, payload_sha256, note_count, received_at)
values
  ('d5500000-0000-4000-8000-000000000001', 'c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001',
   'e5500000-0000-4000-8000-000000000001', '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
   '{"which":"older","notes":[]}', repeat('a', 64), 1, now() - interval '10 minutes'),
  ('d5500000-0000-4000-8000-000000000002', 'c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001',
   'e5500000-0000-4000-8000-000000000001', '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
   '{"which":"newer","notes":[]}', repeat('b', 64), 6, now() - interval '1 minute');

update public.integration_settings set doqtri_oauth_client_id = '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d';


-- ----------------------------------------------------------------------------
-- Caller switches
-- ----------------------------------------------------------------------------

create function pg_temp.as_session(p_user uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'aud', 'authenticated'
  )::text, true);
$$;

create function pg_temp.as_oauth_client(p_user uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aud', 'authenticated',
    'client_id', '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
    'iat', floor(extract(epoch from now()))::bigint - 60
  )::text, true);
$$;

create function pg_temp.as_anon() returns void
language sql as $$
  select set_config('role', 'anon', true);
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

create function pg_temp.as_postgres() returns void
language sql as $$
  select set_config('role', 'postgres', true);
  select set_config('request.jwt.claims', '', true);
$$;

-- Rows in every table submit writes, as postgres sees them.
create function pg_temp.written() returns bigint
language sql as $$
  select (select count(*) from public.hackathon_submissions)
       + (select count(*) from public.hackathon_submission_versions)
       + (select count(*) from public.hackathon_team_members)
       + (select count(*) from public.hackathon_grading_jobs);
$$;

create temp table pv_before as select pg_temp.written() as n;
grant select on pv_before to authenticated;


-- ----------------------------------------------------------------------------
-- 1. Who is refused
-- ----------------------------------------------------------------------------

select pg_temp.as_anon();
select throws_ok(
  $$ select public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'anon cannot call preview_hackathon_entry'
);

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$ select public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001') $$,
  '42501', 'Sign in to submit.',
  'no signed-in user'
);

select pg_temp.as_oauth_client('a5500000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001') $$,
  '42501', 'Apps connected through OAuth cannot do this.',
  'an OAuth client, even the project owner''s'
);

select pg_temp.as_session('a5500000-0000-4000-8000-000000000003');
select throws_ok(
  $$ select public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'a project member below admin'
);

select pg_temp.as_session('a5500000-0000-4000-8000-000000000004');
select throws_ok(
  $$ select public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001') $$,
  'P0002', null,
  'someone outside the project'
);

select pg_temp.as_session('a5500000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000009', 'b5500000-0000-4000-8000-000000000001') $$,
  'P0002', 'No such hackathon.',
  'an unknown hackathon'
);

select throws_ok(
  $$ select public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000002', 'b5500000-0000-4000-8000-000000000001') $$,
  'QD409', 'hackathon_closed',
  'a closed hackathon'
);


-- ----------------------------------------------------------------------------
-- 2. What it returns
-- ----------------------------------------------------------------------------

select is(
  public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001')
    #>> '{qdit_snapshot,project,id}',
  'b5500000-0000-4000-8000-000000000001',
  'the owner gets the project''s qdit snapshot'
);

select is(
  (public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001')
    -> 'qdit_snapshot' -> 'tasks' -> 0 ->> 'title'),
  'Pv task',
  'the qdit snapshot is the live board'
);

select is(
  public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001')
    #>> '{doqtri_snapshot,which}',
  'newer',
  'the doqtri snapshot is the newest push, the one submit would attach'
);

select is(
  (public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001')
    ->> 'doqtri_note_count')::integer,
  6,
  'with its note count'
);

select ok(
  (public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001')
    ->> 'doqtri_received_at')::timestamptz between now() - interval '2 minutes' and now(),
  'and its arrival time'
);

select is(
  public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000002')
    -> 'doqtri_snapshot',
  'null'::jsonb,
  'no push yet: doqtri_snapshot is null'
);

select pg_temp.as_session('a5500000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select public.preview_hackathon_entry('c5500000-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001') $$,
  'a project admin may preview'
);


-- ----------------------------------------------------------------------------
-- 3. It writes nothing
-- ----------------------------------------------------------------------------

select pg_temp.as_postgres();

select is(pg_temp.written(), (select n from pv_before), 'no submission, version, team row or grading job was written');

select is(
  (select provolatile from pg_catalog.pg_proc where oid = 'public.preview_hackathon_entry(uuid, uuid)'::regprocedure),
  'v'::"char",
  'volatile, like the asserts it calls'
);


select * from finish();

rollback;
