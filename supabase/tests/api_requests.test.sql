-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/api_requests.test.sql
--
-- Covers 20261024100000_api_requests.sql: the audit log is invisible and
-- unwritable for every client role — first-party session and OAuth token
-- alike — while the secret key (service_role) may insert and read but never
-- rewrite a row.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back.
--
-- How callers are simulated: PostgREST runs each request as the JWT's role
-- with the claims in `request.jwt.claims`; the tests set exactly those two
-- things. A role with no table privilege gets 42501 on any statement,
-- SELECT included, which is why reads are checked with throws_ok here and not
-- by counting rows.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);


-- ----------------------------------------------------------------------------
-- Shape and lockdown
-- ----------------------------------------------------------------------------

select has_table('public', 'api_requests', 'api_requests exists');

select columns_are(
  'public', 'api_requests',
  array['id', 'request_id', 'client_id', 'user_id', 'method', 'path', 'status', 'created_at'],
  'api_requests has exactly the audit columns'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.api_requests'::regclass),
  true,
  'RLS is enabled on api_requests'
);

select policies_are(
  'public', 'api_requests', array[]::name[],
  'api_requests has no policies at all'
);

select table_privs_are(
  'public', 'api_requests', 'anon', array[]::text[],
  'anon holds no privilege on api_requests'
);

select table_privs_are(
  'public', 'api_requests', 'authenticated', array[]::text[],
  'authenticated holds no privilege on api_requests'
);

select table_privs_are(
  'public', 'api_requests', 'service_role', array['INSERT', 'SELECT'],
  'service_role may only insert and select: the log is append-only'
);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'api-audit@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Audit","username":"api_audit"}', now(), now());


-- ----------------------------------------------------------------------------
-- service_role: insert and read, nothing else
-- ----------------------------------------------------------------------------

set local role service_role;

select lives_ok(
  $$ insert into public.api_requests (request_id, client_id, user_id, method, path, status)
     values ('e1000000-0000-4000-8000-000000000001', '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
             'a1000000-0000-4000-8000-000000000001', 'GET', '/api/v1/me', 200) $$,
  'service_role can append a row'
);

select is(
  (select count(*)::int from public.api_requests
    where request_id = 'e1000000-0000-4000-8000-000000000001'),
  1,
  'service_role can read the row back by request id'
);

select throws_ok(
  $$ update public.api_requests set status = 204
      where request_id = 'e1000000-0000-4000-8000-000000000001' $$,
  '42501', null,
  'service_role cannot rewrite a row'
);

select throws_ok(
  $$ delete from public.api_requests $$,
  '42501', null,
  'service_role cannot delete rows'
);

select throws_ok(
  $$ insert into public.api_requests (request_id, client_id, user_id, method, path, status)
     values (gen_random_uuid(), 'c', 'a1000000-0000-4000-8000-000000000001', 'GET', '/dashboard', 200) $$,
  '23514', null,
  'path is restricted to /api/v1/'
);

select throws_ok(
  $$ insert into public.api_requests (request_id, client_id, user_id, method, path, status)
     values (gen_random_uuid(), 'c', 'a1000000-0000-4000-8000-000000000001', 'GET', '/api/v1/me', 99) $$,
  '23514', null,
  'status must be an HTTP status'
);

select throws_ok(
  $$ insert into public.api_requests (request_id, client_id, user_id, method, path, status)
     values (gen_random_uuid(), '', 'a1000000-0000-4000-8000-000000000001', 'GET', '/api/v1/me', 200) $$,
  '23514', null,
  'client_id may not be empty'
);

reset role;


-- ----------------------------------------------------------------------------
-- authenticated: neither an OAuth token nor a first-party session gets in
-- ----------------------------------------------------------------------------

set local role authenticated;

-- An OAuth access token: carries client_id.
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","client_id":"9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d"}',
  true
);

select throws_ok(
  $$ select count(*) from public.api_requests $$,
  '42501', null,
  'an OAuth token cannot read the audit log, not even its own rows'
);

select throws_ok(
  $$ insert into public.api_requests (request_id, client_id, user_id, method, path, status)
     values (gen_random_uuid(), '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
             'a1000000-0000-4000-8000-000000000001', 'GET', '/api/v1/me', 200) $$,
  '42501', null,
  'an OAuth token cannot write an audit row'
);

-- A first-party session: no client_id.
select set_config(
  'request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$ select count(*) from public.api_requests $$,
  '42501', null,
  'a first-party session cannot read the audit log either'
);

reset role;


-- ----------------------------------------------------------------------------
-- anon
-- ----------------------------------------------------------------------------

set local role anon;

select throws_ok(
  $$ select count(*) from public.api_requests $$,
  '42501', null,
  'anon cannot read the audit log'
);

reset role;

select * from finish();

rollback;
