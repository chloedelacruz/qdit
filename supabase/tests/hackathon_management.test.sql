-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/hackathon_management.test.sql
--
-- Covers 20261110120000_hackathon_management.sql (QDIT-56, WP-4.7): who may
-- create, edit, hide and delete hackathons; the slug and release locks; and
-- that only an empty hackathon can be deleted.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(32);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- u1 operator, u2 admin of H1 (not an operator), u3 judge of H1, u4 nobody.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('a5600000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated',
       'mg-' || n || '@qdit.test',
       '{"provider":"email","providers":["email"]}',
       jsonb_build_object('full_name', 'Mg ' || n, 'username', 'mg_u' || n),
       now(), now()
  from generate_series(1, 4) as n;

insert into public.qdit_operators (user_id) values ('a5600000-0000-4000-8000-000000000001');

insert into public.projects (id, owner_id, name, slug)
values ('b5600000-0000-4000-8000-000000000001', 'a5600000-0000-4000-8000-000000000004', 'Mg one', 'mg-one');

-- H1 empty, H2 with a doqtri snapshot, H3 released.
insert into public.hackathons (id, slug, name, opens_at, closes_at, finalist_count, released_at)
values
  ('c5600000-0000-4000-8000-000000000001', 'mg-empty',    'Empty',    now() + interval '1 day',  now() + interval '2 days', 10, null),
  ('c5600000-0000-4000-8000-000000000002', 'mg-used',     'Used',     now() - interval '1 hour', now() + interval '1 hour', 10, null),
  ('c5600000-0000-4000-8000-000000000003', 'mg-released', 'Released', now() - interval '3 days', now() - interval '2 days', 10, now() - interval '1 day');

insert into public.hackathon_staff (hackathon_id, user_id, role)
values
  ('c5600000-0000-4000-8000-000000000001', 'a5600000-0000-4000-8000-000000000002', 'admin'),
  ('c5600000-0000-4000-8000-000000000001', 'a5600000-0000-4000-8000-000000000003', 'judge');

insert into public.hackathon_doqtri_snapshots
  (snapshot_id, hackathon_id, project_id, workspace_id, client_id, payload, payload_sha256, note_count)
values
  ('d5600000-0000-4000-8000-000000000001', 'c5600000-0000-4000-8000-000000000002', 'b5600000-0000-4000-8000-000000000001',
   'e5600000-0000-4000-8000-000000000001', '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d', '{"notes":[]}', repeat('a', 64), 0);


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


-- ----------------------------------------------------------------------------
-- 1. Operators
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a5600000-0000-4000-8000-000000000001');
select ok(public.is_qdit_operator(), 'an operator is one');

select pg_temp.as_session('a5600000-0000-4000-8000-000000000002');
select ok(not public.is_qdit_operator(), 'a hackathon admin is not an operator');

select pg_temp.as_oauth_client('a5600000-0000-4000-8000-000000000001');
select ok(not public.is_qdit_operator(), 'an operator over OAuth is not one');

select pg_temp.as_session('a5600000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select count(*) from public.qdit_operators $$,
  '42501', null,
  'no client reads qdit_operators'
);


-- ----------------------------------------------------------------------------
-- 1b. The management list
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a5600000-0000-4000-8000-000000000001');
select is(
  (select array_agg(slug || ':' || entries || ':' || snapshots || ':' || can_delete order by slug)
     from public.hackathon_manage_list()),
  array['mg-empty:0:0:true', 'mg-released:0:0:true', 'mg-used:0:1:false'],
  'an operator sees every hackathon, its counts, and Delete only where empty'
);

select pg_temp.as_session('a5600000-0000-4000-8000-000000000002');
select is(
  (select array_agg(slug || ':' || can_delete) from public.hackathon_manage_list()),
  array['mg-empty:false'],
  'a hackathon admin sees only theirs, and never Delete'
);

select pg_temp.as_session('a5600000-0000-4000-8000-000000000003');
select is_empty($$ select * from public.hackathon_manage_list() $$, 'a judge manages nothing');

select pg_temp.as_oauth_client('a5600000-0000-4000-8000-000000000001');
select throws_ok($$ select * from public.hackathon_manage_list() $$, '42501', null, 'not over OAuth');


-- ----------------------------------------------------------------------------
-- 2. Create
-- ----------------------------------------------------------------------------

select pg_temp.as_anon();
select throws_ok(
  $$ select public.create_hackathon('mg-new', 'New', null, now() + interval '1 day', now() + interval '2 days', 3, 4, 10, false) $$,
  '42501', null,
  'anon cannot create'
);

select pg_temp.as_oauth_client('a5600000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.create_hackathon('mg-new', 'New', null, now() + interval '1 day', now() + interval '2 days', 3, 4, 10, false) $$,
  '42501', null,
  'an operator over OAuth cannot create'
);

select pg_temp.as_session('a5600000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select public.create_hackathon('mg-new', 'New', null, now() + interval '1 day', now() + interval '2 days', 3, 4, 10, false) $$,
  '42501', 'Only qdit operators can create hackathons.',
  'a hackathon admin who is not an operator cannot create'
);

select pg_temp.as_session('a5600000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select public.create_hackathon('  MG-New ', ' New one ', '  ', now() + interval '1 day', now() + interval '2 days', 3, 4, 10, true) $$,
  'an operator creates'
);

select pg_temp.as_postgres();
select is(
  (select row(slug, name, description, hidden)::text from public.hackathons where slug = 'mg-new'),
  row('mg-new', 'New one', null::text, true)::text,
  'slug lower-cased and trimmed, name trimmed, blank description null, hidden kept'
);
select is(
  (select role::text from public.hackathon_staff s join public.hackathons h on h.id = s.hackathon_id
    where h.slug = 'mg-new' and s.user_id = 'a5600000-0000-4000-8000-000000000001'),
  'admin',
  'the creator is its admin'
);

select pg_temp.as_session('a5600000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.create_hackathon('mg-new', 'Again', null, now() + interval '1 day', now() + interval '2 days', 3, 4, 10, false) $$,
  '23505', null,
  'a taken slug'
);
select throws_ok(
  $$ select public.create_hackathon('mg-bad', 'Backwards', null, now() + interval '2 days', now() + interval '1 day', 3, 4, 10, false) $$,
  '23514', null,
  'closes before it opens'
);
select throws_ok(
  $$ select public.create_hackathon('manage', 'Reserved', null, now() + interval '1 day', now() + interval '2 days', 3, 4, 10, false) $$,
  'QD409', 'slug_reserved',
  'manage is reserved for the management page'
);
select throws_ok(
  $$ select public.create_hackathon('Mg Bad!', 'Bad slug', null, now() + interval '1 day', now() + interval '2 days', 3, 4, 10, false) $$,
  '23514', null,
  'a slug outside [a-z0-9-]'
);


-- ----------------------------------------------------------------------------
-- 3. Update and hide
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a5600000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select public.update_hackathon('c5600000-0000-4000-8000-000000000001', 'mg-empty-2', 'Empty, renamed', 'About',
       now() + interval '1 day', now() + interval '3 days', 2, 5, 8, true) $$,
  'the hackathon''s admin edits and hides it'
);

select pg_temp.as_postgres();
select is(
  (select row(slug, name, description, team_min, team_max, finalist_count, hidden)::text
     from public.hackathons where id = 'c5600000-0000-4000-8000-000000000001'),
  row('mg-empty-2', 'Empty, renamed', 'About', 2, 5, 8, true)::text,
  'every field is written'
);

select pg_temp.as_session('a5600000-0000-4000-8000-000000000003');
select throws_ok(
  $$ select public.update_hackathon('c5600000-0000-4000-8000-000000000001', 'mg-empty-2', 'x', null,
       now() + interval '1 day', now() + interval '3 days', 2, 5, 8, false) $$,
  '42501', null,
  'a judge cannot edit'
);

select pg_temp.as_session('a5600000-0000-4000-8000-000000000004');
select throws_ok(
  $$ select public.update_hackathon('c5600000-0000-4000-8000-000000000001', 'mg-empty-2', 'x', null,
       now() + interval '1 day', now() + interval '3 days', 2, 5, 8, false) $$,
  '42501', null,
  'someone else cannot edit'
);

select pg_temp.as_session('a5600000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.update_hackathon('c5600000-0000-4000-8000-000000000009', 'x', 'x', null, now(), now() + interval '1 hour', 3, 4, 10, false) $$,
  'P0002', null,
  'an unknown hackathon'
);

select throws_ok(
  $$ select public.update_hackathon('c5600000-0000-4000-8000-000000000002', 'mg-used-2', 'Used', null,
       (select opens_at from public.hackathons where id = 'c5600000-0000-4000-8000-000000000002'),
       (select closes_at from public.hackathons where id = 'c5600000-0000-4000-8000-000000000002'), 3, 4, 10, false) $$,
  'QD409', 'slug_locked',
  'the slug is locked once doqtri has pushed to it'
);

select lives_ok(
  $$ select public.update_hackathon('c5600000-0000-4000-8000-000000000002', 'mg-used', 'Used, renamed', null,
       (select opens_at from public.hackathons where id = 'c5600000-0000-4000-8000-000000000002'),
       (select closes_at from public.hackathons where id = 'c5600000-0000-4000-8000-000000000002') + interval '30 minutes', 3, 4, 10, true) $$,
  'an operator renames, extends and hides a hackathon in use, slug unchanged'
);

select throws_ok(
  $$ select public.update_hackathon('c5600000-0000-4000-8000-000000000003', 'mg-released', 'Released', null,
       (select opens_at from public.hackathons where id = 'c5600000-0000-4000-8000-000000000003'),
       (select closes_at from public.hackathons where id = 'c5600000-0000-4000-8000-000000000003'), 3, 4, 5, false) $$,
  'QD409', 'released_locked',
  'the finalist count is locked after release'
);

select lives_ok(
  $$ select public.update_hackathon('c5600000-0000-4000-8000-000000000003', 'mg-released', 'Released, renamed', null,
       (select opens_at from public.hackathons where id = 'c5600000-0000-4000-8000-000000000003'),
       (select closes_at from public.hackathons where id = 'c5600000-0000-4000-8000-000000000003'), 3, 4, 10, true) $$,
  'name and hidden still change after release'
);


-- ----------------------------------------------------------------------------
-- 4. Delete
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a5600000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select public.delete_hackathon('c5600000-0000-4000-8000-000000000001') $$,
  '42501', 'Only qdit operators can delete hackathons.',
  'a hackathon admin cannot delete'
);

select pg_temp.as_session('a5600000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.delete_hackathon('c5600000-0000-4000-8000-000000000002') $$,
  'QD409', 'hackathon_not_empty',
  'a hackathon with a doqtri snapshot is not deleted'
);

select lives_ok(
  $$ select public.delete_hackathon('c5600000-0000-4000-8000-000000000001') $$,
  'an operator deletes an empty hackathon'
);

select pg_temp.as_postgres();
select is(
  (select count(*) from public.hackathon_staff where hackathon_id = 'c5600000-0000-4000-8000-000000000001'),
  0::bigint,
  'its staff rows went with it'
);

select pg_temp.as_anon();
select throws_ok(
  $$ select public.delete_hackathon('c5600000-0000-4000-8000-000000000002') $$,
  '42501', null,
  'anon cannot delete'
);


select * from finish();

rollback;
