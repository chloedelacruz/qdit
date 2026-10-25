-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/doqtri_origin_doc_links.test.sql
--
-- Covers 20261026120000_doqtri_origin_doc_url_check.sql sections 2 and 3
-- (D-95): link_project_doc() refuses a doc_url off
-- integration_settings.doqtri_origin with 22023 (hint doc_url), by the strict
-- D-72 rule, and only after the D-60 and role checks; while doqtri_origin is
-- unset it links as before; and doqtri_origin_setting() hands the stored
-- origin to service_role only. Section 1 (no docUrl in the anon answer) is in
-- public_milestone_doc_source.test.sql.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back. Callers are
-- simulated as in integration_links.test.sql: the JWT's role and claims.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- u1 owns P1, u2 is a member of it.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'origin-owner@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Owner","username":"origin_owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'origin-member@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Member","username":"origin_member"}', now(), now());

insert into public.projects (id, owner_id, name, slug)
values ('b5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'Origin', 'origin-test');

insert into public.project_members (project_id, user_id, role)
values ('b5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000002', 'member');


-- ----------------------------------------------------------------------------
-- Caller switches, and a way to read a raised HINT
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

create function pg_temp.raised_hint(p_sql text) returns text
language plpgsql as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end;
$$;

-- link_project_doc() for P1 as the owner's app, doc d<n>, with p_url.
create function pg_temp.link(p_doc integer, p_url text) returns text
language sql as $$
  select format(
    'select * from public.link_project_doc(%L, %L, %L, %L)',
    'b5000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-' || lpad(p_doc::text, 12, '0'),
    'Plan ' || p_doc,
    p_url
  );
$$;


-- ----------------------------------------------------------------------------
-- 1. doqtri_origin_setting()
-- ----------------------------------------------------------------------------

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_catalog.pg_proc p
    where p.oid = 'public.doqtri_origin_setting()'::regprocedure)
  and has_function_privilege('service_role', 'public.doqtri_origin_setting()', 'execute')
  and not has_function_privilege('anon', 'public.doqtri_origin_setting()', 'execute')
  and not has_function_privilege('authenticated', 'public.doqtri_origin_setting()', 'execute'),
  'doqtri_origin_setting: SECURITY DEFINER, empty search_path, service_role only'
);

select set_config('role', 'service_role', true);
select is(public.doqtri_origin_setting(), null, 'service_role: null while doqtri_origin is unset');

select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.doqtri_origin_setting() $$,
  '42501', null,
  'an OAuth client cannot call doqtri_origin_setting'
);


-- ----------------------------------------------------------------------------
-- 2. Unset: link_project_doc() as before
-- ----------------------------------------------------------------------------

-- Any https URL the column allows: the API's DOQTRI_ORIGIN check is the only
-- one while the database has no origin to hold it to.
select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000001');
select is(
  (select created from public.link_project_doc(
     'b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001',
     'Plan 1', 'https://elsewhere.example/d/d5000000-0000-4000-8000-000000000001')),
  true,
  'unset: a doc URL on any https host is linked, as before'
);


-- ----------------------------------------------------------------------------
-- 3. Set: the strict D-72 rule
-- ----------------------------------------------------------------------------

select pg_temp.as_postgres();
update public.integration_settings set doqtri_origin = 'https://www.doqtri.xyz';

select set_config('role', 'service_role', true);
select is(public.doqtri_origin_setting(), 'https://www.doqtri.xyz', 'service_role: reads the stored origin');

select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000001');
select is(
  (select created from public.link_project_doc(
     'b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000002',
     'Plan 2', 'https://www.doqtri.xyz/d/d5000000-0000-4000-8000-000000000002')),
  true,
  'set: a doc URL on doqtri_origin is linked'
);

select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000001');
select throws_ok(
  pg_temp.link(3, 'https://www.doqtri.xyz.evil.example/d/3'),
  '22023', 'must be a doqtri URL starting with https://www.doqtri.xyz/',
  'set: a host that only starts with the origin is refused'
);

select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000001');
select throws_ok(
  pg_temp.link(3, 'https://www.doqtri.xyz?d=3'),
  '22023', null,
  'set: the origin straight into a query, with no /, is refused'
);

select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000001');
select throws_ok(
  pg_temp.link(3, 'https://doqtri.xyz/d/3'),
  '22023', null,
  'set: another of doqtri''s hosts (apex against www) is refused'
);

select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000001');
select throws_ok(
  pg_temp.link(3, 'https://WWW.doqtri.xyz/d/3'),
  '22023', null,
  'set: the origin in another case is refused, byte for byte'
);

select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000001');
select is(
  pg_temp.raised_hint(pg_temp.link(3, 'https://doqtri.xyz/d/3')),
  'doc_url',
  'set: the refusal names the field in its hint, for /api/v1''s 400'
);

select pg_temp.as_postgres();
select ok(
  not exists (select 1 from public.project_doc_links where doc_id = 'd5000000-0000-4000-8000-000000000003'),
  'set: no refused URL left a doc link'
);

-- Refreshing an existing link goes through the same check.
select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000001');
select throws_ok(
  pg_temp.link(2, 'https://doqtri.xyz/d/d5000000-0000-4000-8000-000000000002'),
  '22023', null,
  'set: a refresh to a URL off the origin is refused'
);
select pg_temp.as_postgres();
select is(
  (select doc_url from public.project_doc_links where doc_id = 'd5000000-0000-4000-8000-000000000002'),
  'https://www.doqtri.xyz/d/d5000000-0000-4000-8000-000000000002',
  '... and the stored doc_url did not change'
);

-- A link stored before the origin was set stays, and a refresh onto the
-- origin is allowed.
select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000001');
select is(
  (select doc_url from public.link_project_doc(
     'b5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001',
     'Plan 1', 'https://www.doqtri.xyz/d/d5000000-0000-4000-8000-000000000001')),
  'https://www.doqtri.xyz/d/d5000000-0000-4000-8000-000000000001',
  'set: a link from before refreshes onto the origin'
);


-- ----------------------------------------------------------------------------
-- 4. The earlier checks still come first
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000002');
select throws_ok(
  pg_temp.link(4, 'https://doqtri.xyz/d/4'),
  '42501', 'Your role in this project does not allow that.',
  'a member''s app gets the role refusal, not the origin one'
);

select pg_temp.as_session('a5000000-0000-4000-8000-000000000001');
select throws_ok(
  pg_temp.link(4, 'https://doqtri.xyz/d/4'),
  '42501', 'Doc links are made and removed from doqtri, through its connection to qdit.',
  'a session gets the D-60 refusal, not the origin one'
);

select pg_temp.as_oauth_client('a5000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select * from public.link_project_doc('b5000000-0000-4000-8000-00000000ffff',
       'd5000000-0000-4000-8000-000000000004', 'Plan 4', 'https://doqtri.xyz/d/4') $$,
  'P0002', null,
  'another project: not found, not the origin refusal'
);


select * from finish();

rollback;
