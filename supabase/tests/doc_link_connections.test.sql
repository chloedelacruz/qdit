-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/doc_link_connections.test.sql
--
-- Covers 20261025120600_doc_link_connections.sql: which doqtri connections
-- keep a doc link alive, as the WP-2.6 doc card reads them. A write through
-- an OAuth client records a live row; a first-party write records nothing;
-- revoking the app, leaving the project and deleting the account each end the
-- user's rows; a new write through the app revives them. Also who may read
-- the rows (project viewers, never apps) and that nobody writes them directly.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back. Callers are
-- simulated as in integration_links.test.sql: the JWT's role and claims.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(31);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- u1 owner, u2 admin, u3 member, u4 viewer of P1; u5 a stranger to it.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'conn-owner@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Owner","username":"conn_owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'conn-admin@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Admin","username":"conn_admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'conn-member@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Member","username":"conn_member"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'conn-viewer@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Viewer","username":"conn_viewer"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'conn-stranger@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Stranger","username":"conn_stranger"}', now(), now());

insert into public.projects (id, owner_id, name, slug)
values ('b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Connections', 'conn-test');

insert into public.project_members (project_id, user_id, role)
values
  ('b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'admin'),
  ('b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'member'),
  ('b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000004', 'viewer');


-- ----------------------------------------------------------------------------
-- Caller switches
-- ----------------------------------------------------------------------------

create function pg_temp.as_oauth_client(p_user uuid, p_client text default '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d')
returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_user,
    'role', 'authenticated',
    'aud', 'authenticated',
    'client_id', p_client
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

-- "user:reason" per row of a doc link, reason `live` while lost_at is null,
-- read as postgres so RLS does not shape the answer.
create function pg_temp.connections(p_doc_id uuid) returns text[]
language sql as $$
  select coalesce(array_agg(
           right(c.user_id::text, 1) || ':' || coalesce(c.lost_reason, 'live')
           order by c.user_id), '{}')
    from public.doc_link_connections c
    join public.project_doc_links d on d.id = c.doc_link_id
   where d.doc_id = p_doc_id;
$$;


-- ----------------------------------------------------------------------------
-- 1. Shape
-- ----------------------------------------------------------------------------

select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.doc_link_connections'::regclass),
  'RLS is enabled on doc_link_connections'
);

select ok(
  has_table_privilege('authenticated', 'public.doc_link_connections', 'select')
  and not has_table_privilege('authenticated', 'public.doc_link_connections', 'insert')
  and not has_table_privilege('authenticated', 'public.doc_link_connections', 'update')
  and not has_table_privilege('authenticated', 'public.doc_link_connections', 'delete')
  and not has_table_privilege('anon', 'public.doc_link_connections', 'select'),
  'authenticated may only read doc_link_connections; anon not even that'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('record_doc_link_connection', 'mark_doc_link_connections_revoked',
                        'mark_doc_link_connections_left')
      and p.prosecdef
      and p.proconfig @> array['search_path=""']),
  array['mark_doc_link_connections_left', 'mark_doc_link_connections_revoked', 'record_doc_link_connection'],
  'the new functions are SECURITY DEFINER with search_path pinned to empty'
);

select ok(
  not has_function_privilege('authenticated', 'public.record_doc_link_connection()', 'execute')
  and not has_function_privilege('authenticated', 'public.mark_doc_link_connections_left()', 'execute')
  and has_function_privilege('authenticated', 'public.mark_doc_link_connections_revoked(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.mark_doc_link_connections_revoked(uuid)', 'execute'),
  'only the revoke RPC is callable, and only by authenticated'
);


-- ----------------------------------------------------------------------------
-- 2. Writes through an app record a live connection; first-party ones do not
-- ----------------------------------------------------------------------------

-- D1: linked by the admin through doqtri (POST /projects/{id}/docs).
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000001', 'Payroll v1 plan',
       'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000001') $$,
  'oauth admin links D1'
);

-- D2: linked by the owner from their own qdit session, not through doqtri.
select pg_temp.as_session('a2000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000002', 'Hand-linked plan',
       'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000002') $$,
  'session owner links D2'
);

select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), array['2:live'],
  'an app''s doc link records the linker''s connection');
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000002'), '{}'::text[],
  'a first-party doc link records no connection');

select is(
  (select c.client_id::text from public.doc_link_connections c
     join public.project_doc_links d on d.id = c.doc_link_id
    where d.doc_id = 'd2000000-0000-4000-8000-000000000001'),
  '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
  'the connection names the OAuth client from the token'
);

-- A member creates a milestone from a heading of D1 (POST /milestones).
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000003');
select lives_ok(
  $$ select public.create_linked_milestone('b2000000-0000-4000-8000-000000000001', 'Escrow contract',
       null, null, 'd2000000-0000-4000-8000-000000000001', 'h1', 7) $$,
  'oauth member creates a linked milestone on D1'
);

select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), array['2:live', '3:live'],
  'a milestone link written through the app records that member''s connection too');

-- The same member renames it (PATCH /milestones/{id}): the label follows by
-- trigger, inside the app's request, and the row is refreshed, not doubled.
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000003');
update public.milestones set title = 'Escrow contract v2'
 where project_id = 'b2000000-0000-4000-8000-000000000001' and title = 'Escrow contract';

select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.doc_link_connections c
     join public.project_doc_links d on d.id = c.doc_link_id
    where d.doc_id = 'd2000000-0000-4000-8000-000000000001'),
  2,
  'a rename through the app refreshes the member''s row rather than adding one'
);

-- A client id that is not a UUID is not recorded, and does not break the write.
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002', 'not-a-uuid');
select lives_ok(
  $$ select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000002', 'Hand-linked plan, renamed',
       'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000002') $$,
  'a write with a malformed client_id still succeeds'
);
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000002'), '{}'::text[],
  '... and records nothing');


-- ----------------------------------------------------------------------------
-- 3. Who reads, who writes
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a2000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.doc_link_connections), 2,
  'a project viewer reads the connections of the project''s docs');

select pg_temp.as_session('a2000000-0000-4000-8000-000000000005');
select is((select count(*)::int from public.doc_link_connections), 0,
  'a stranger reads none');

select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.doc_link_connections), 0,
  'an app reads none, even for its own user''s project');

select pg_temp.as_session('a2000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ update public.doc_link_connections set lost_at = null, lost_reason = null $$,
  '42501', null,
  'not even the project owner writes the rows directly'
);


-- ----------------------------------------------------------------------------
-- 4. Losing a connection, and getting it back
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select public.mark_doc_link_connections_revoked('9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d') $$,
  '42501', null,
  'an app cannot call the revoke RPC'
);

select pg_temp.as_session('a2000000-0000-4000-8000-000000000002');
select is(public.mark_doc_link_connections_revoked('11111111-1111-4111-8111-111111111111'), 0,
  'revoking another client marks nothing');
select is(public.mark_doc_link_connections_revoked('9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d'), 1,
  'revoking doqtri marks the caller''s one connection');

select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), array['2:revoked', '3:live'],
  '... and only the caller''s: the member''s connection still keeps D1 connected');

-- The member leaves the project: their token can no longer write there.
delete from public.project_members
 where project_id = 'b2000000-0000-4000-8000-000000000001'
   and user_id = 'a2000000-0000-4000-8000-000000000003';
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), array['2:revoked', '3:left_project'],
  'leaving the project marks the member''s connection lost: D1 has none live');

-- The admin reconnects doqtri and doqtri re-posts the doc.
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000001', 'Payroll v1 plan',
       'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000001') $$,
  'oauth admin re-posts D1 after reconnecting'
);
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), array['2:live', '3:left_project'],
  'a new write through the app makes the connection live again');

-- The member's account is deleted: its rows go with it, and the delete works
-- (their milestone link's created_by is set null, which records nothing).
select lives_ok(
  $$ delete from auth.users where id = 'a2000000-0000-4000-8000-000000000003' $$,
  'deleting an account that wrote a link succeeds'
);
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), array['2:live'],
  'a deleted account''s connections are gone');


-- ----------------------------------------------------------------------------
-- 5. Cascades
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select public.unlink_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000001') $$,
  'oauth admin unlinks D1'
);
select pg_temp.as_postgres();
select is((select count(*)::int from public.doc_link_connections), 0,
  'unlinking a doc removes its connections');

-- A project with a connected doc can still be deleted (the membership rows go
-- in the same cascade as the doc links and their connections).
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002');
select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000003', 'Another plan',
  'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000003');
select pg_temp.as_postgres();
select lives_ok(
  $$ delete from public.projects where id = 'b2000000-0000-4000-8000-000000000001' $$,
  'deleting a project with a connected doc succeeds'
);
select is((select count(*)::int from public.doc_link_connections), 0,
  '... and leaves no connections behind');


select * from finish();
rollback;
