-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/oauth_client_revocations.test.sql
--
-- Covers 20261025130000_oauth_revocations.sql, apart from what
-- doc_link_connections.test.sql and integration_links.test.sql already do:
-- the two hidden tables, recording a revoke (D-59), and oauth_token_revoked(),
-- the check authenticate() makes on every /api/v1 request.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back. Callers are
-- simulated as in the other files: the JWT's role and claims.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'revoke-one@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"One","username":"revoke_one"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'revoke-two@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Two","username":"revoke_two"}', now(), now());


-- ----------------------------------------------------------------------------
-- Caller switches
-- ----------------------------------------------------------------------------

-- p_iat: the token's iat claim as given (seconds from now(), or a raw value
-- through p_iat_raw); null leaves iat out.
create function pg_temp.as_oauth_client(
  p_user uuid,
  p_client text default '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
  p_iat_offset integer default -60,
  p_iat_raw jsonb default null
)
returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', (
    jsonb_build_object(
      'sub', p_user,
      'role', 'authenticated',
      'aud', 'authenticated',
      'client_id', p_client
    ) || case when p_iat_raw is not null then jsonb_build_object('iat', p_iat_raw)
              when p_iat_offset is null then '{}'::jsonb
              else jsonb_build_object('iat', floor(extract(epoch from now()))::bigint + p_iat_offset)
         end
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
-- 1. Shape
-- ----------------------------------------------------------------------------

select ok(
  (select bool_and(c.relrowsecurity)
     from pg_catalog.pg_class c
    where c.oid in ('public.oauth_client_revocations'::regclass, 'public.integration_settings'::regclass)),
  'RLS is enabled on oauth_client_revocations and integration_settings'
);

select ok(
  not has_any_column_privilege('authenticated', 'public.oauth_client_revocations', 'select')
  and not has_any_column_privilege('anon', 'public.oauth_client_revocations', 'select')
  and not has_table_privilege('authenticated', 'public.oauth_client_revocations', 'insert, update, delete')
  and not has_any_column_privilege('authenticated', 'public.integration_settings', 'select')
  and not has_any_column_privilege('anon', 'public.integration_settings', 'select')
  and not has_table_privilege('authenticated', 'public.integration_settings', 'insert, update, delete'),
  'neither table is granted to anon or authenticated'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('oauth_token_revoked', 'record_oauth_client_revocation',
                        'upsert_oauth_client_revocation', 'mark_doc_link_connections_revoked',
                        'record_doc_link_connection')
      and p.prosecdef
      and p.proconfig @> array['search_path=""']),
  array['mark_doc_link_connections_revoked', 'oauth_token_revoked',
        'record_doc_link_connection', 'record_oauth_client_revocation',
        'upsert_oauth_client_revocation'],
  'the new and replaced functions are SECURITY DEFINER with search_path pinned to empty'
);

select ok(
  has_function_privilege('authenticated', 'public.oauth_token_revoked()', 'execute')
  and has_function_privilege('authenticated', 'public.record_oauth_client_revocation(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.oauth_token_revoked()', 'execute')
  and not has_function_privilege('anon', 'public.record_oauth_client_revocation(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.upsert_oauth_client_revocation(uuid, uuid)', 'execute'),
  'authenticated calls the check and the revoke RPC; the upsert is internal'
);

select is((select count(*)::int from public.integration_settings), 1,
  'integration_settings holds one row');
select ok((select doqtri_oauth_client_id is null from public.integration_settings),
  '... with no doqtri client id until the operator sets it');
select throws_ok(
  $$ insert into public.integration_settings (id) values (false) $$,
  '23514', null,
  'a second settings row is refused'
);
select throws_ok(
  $$ update public.integration_settings set doqtri_oauth_client_id = 'not-a-client-id'::uuid $$,
  '22P02', null,
  'a client id that is not a UUID is refused'
);


-- ----------------------------------------------------------------------------
-- 2. Nothing revoked yet
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000001');
select is(public.oauth_token_revoked(), false, 'a token with no revoke on record passes');

select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000001', p_iat_offset => null);
select is(public.oauth_token_revoked(), false, '... even without an iat');

select pg_temp.as_session('a3000000-0000-4000-8000-000000000001');
select is(public.oauth_token_revoked(), false, 'a first-party session is not an app token');


-- ----------------------------------------------------------------------------
-- 3. Recording a revoke
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select public.record_oauth_client_revocation('9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d') $$,
  '42501', null,
  'an app cannot record a revoke'
);
select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select count(*) from public.oauth_client_revocations $$,
  '42501', null,
  'an app cannot read revocations'
);

select pg_temp.as_session('a3000000-0000-4000-8000-000000000001');
select is(public.record_oauth_client_revocation('9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d'), now(),
  'the user records a revoke of doqtri; it returns the revoke time');
select throws_ok(
  $$ select count(*) from public.oauth_client_revocations $$,
  '42501', null,
  '... and cannot read the table directly'
);
select is(public.mark_doc_link_connections_revoked('9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d'), 0,
  'the post-revoke mark finds nothing to mark');

select pg_temp.as_postgres();
select is(
  (select array_agg(right(r.user_id::text, 1) || ':' || r.client_id::text || ':' || (r.revoked_at = now())::text)
     from public.oauth_client_revocations r),
  array['1:9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d:true'],
  'one row for (user, client): the mark upserts the same row'
);

-- An earlier time is never written over a later one.
update public.oauth_client_revocations set revoked_at = now() + interval '1 hour';
select pg_temp.as_session('a3000000-0000-4000-8000-000000000001');
select is(public.record_oauth_client_revocation('9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d'), now() + interval '1 hour',
  'recording again never moves the revoke time back');
select pg_temp.as_postgres();
update public.oauth_client_revocations set revoked_at = now();


-- ----------------------------------------------------------------------------
-- 4. oauth_token_revoked()
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000001', p_iat_offset => -60);
select is(public.oauth_token_revoked(), true, 'a token issued before the revoke is revoked');

select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000001', p_iat_offset => 0);
select is(public.oauth_token_revoked(), true, '... and one issued in the second of the revoke');

select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000001', p_iat_offset => null);
select is(public.oauth_token_revoked(), true, '... and one with no iat');

select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000001', p_iat_raw => '"soon"');
select is(public.oauth_token_revoked(), true, '... and one whose iat is not a number');

select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000001', p_iat_offset => 60);
select is(public.oauth_token_revoked(), false, 'a token from the re-consent, issued after it, passes');

select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222');
select is(public.oauth_token_revoked(), false, 'another client of the same user is not revoked');

select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000002');
select is(public.oauth_token_revoked(), false, 'another user of the same client is not revoked');

select pg_temp.as_oauth_client('a3000000-0000-4000-8000-000000000001', 'not-a-uuid');
-- D-96 (20261026120100): no revoke can name it, so it fails closed.
select is(public.oauth_token_revoked(), true, 'a client id that is not a UUID counts as revoked (D-96), and does not fail');


select * from finish();
rollback;
