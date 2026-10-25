-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/doc_link_connections.test.sql
--
-- Covers 20261025120600_doc_link_connections.sql: which doqtri connections
-- keep a doc link alive, as the WP-2.6 doc card reads them. A write through
-- an OAuth client records a live row; a first-party write records nothing;
-- revoking the app, leaving the project and deleting the account each end the
-- user's rows; a new write through the app revives them, but not one made
-- with a token issued before the revoke. Also who may read the rows (project
-- viewers, only the card's columns, never apps) and that nobody writes them
-- directly.
--
-- And 20261025130000_oauth_revocations.sql: only doqtri's client, as pinned
-- in integration_settings, records anything (D-61); a revoke by a user with no
-- rows is still remembered, so their pre-revoke token's writes record revoked
-- rows (D-59); and doc links are written only through an app (D-60).
--
-- And 20261026100000 and 20261026100100 (WP-2.12): a pre-revoke token's
-- writes are now refused outright (D-75), so the trigger's revoked branch is
-- driven here by a write that skips the guards (as the table owner, with that
-- token's claims), standing in for any path a guard might miss; recording a
-- revoke marks the rows lost at once, and heals if doqtri writes again with a
-- later token; and members read only the current doqtri client's rows.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back. Callers are
-- simulated as in integration_links.test.sql: the JWT's role and claims.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(55);


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

-- A milestone for the first-party milestone link in section 2.
insert into public.milestones (id, project_id, title, status, order_index)
values ('c2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'Hand-linked', 'proposed', 0);

-- doqtri's OAuth client in this environment (D-61): the client the
-- as_oauth_client() helper below uses by default.
update public.integration_settings set doqtri_oauth_client_id = '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d';


-- ----------------------------------------------------------------------------
-- Caller switches
-- ----------------------------------------------------------------------------

-- p_iat_offset: the token's iat in seconds from now(), which is the
-- transaction's start and so also every lost_at the revoke RPC sets here.
-- Null leaves iat out of the token.
create function pg_temp.as_oauth_client(
  p_user uuid,
  p_client text default '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
  p_iat_offset integer default -60
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
    ) || case when p_iat_offset is null then '{}'::jsonb
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

-- The table owner, carrying an OAuth token's claims: a write that RLS, the
-- D-75 guards and the RPCs' checks never see, so only the trigger decides.
create function pg_temp.as_owner_with_token(p_user uuid, p_iat_offset integer default -60) returns void
language sql as $$
  select pg_temp.as_oauth_client(p_user, p_iat_offset => p_iat_offset);
  select set_config('role', 'postgres', true);
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
  has_column_privilege('authenticated', 'public.doc_link_connections', 'doc_link_id', 'select')
  and has_column_privilege('authenticated', 'public.doc_link_connections', 'lost_at', 'select')
  and has_column_privilege('authenticated', 'public.doc_link_connections', 'lost_reason', 'select')
  and not has_column_privilege('authenticated', 'public.doc_link_connections', 'user_id', 'select')
  and not has_column_privilege('authenticated', 'public.doc_link_connections', 'client_id', 'select')
  and not has_column_privilege('authenticated', 'public.doc_link_connections', 'last_write_at', 'select')
  and not has_table_privilege('authenticated', 'public.doc_link_connections', 'insert')
  and not has_table_privilege('authenticated', 'public.doc_link_connections', 'update')
  and not has_table_privilege('authenticated', 'public.doc_link_connections', 'delete')
  and not has_any_column_privilege('anon', 'public.doc_link_connections', 'select'),
  'authenticated may only read the card''s three columns of doc_link_connections; anon not even that'
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

-- D2: the owner's own qdit session cannot link a doc (D-60), so an operator
-- writes it, and the owner links a milestone to one of its headings from
-- their session.
select pg_temp.as_session('a2000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000002', 'Hand-linked plan',
       'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000002') $$,
  '42501', null,
  'session owner cannot link D2 through link_project_doc (D-60)'
);

select pg_temp.as_postgres();
insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url, linked_by)
values ('b2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000002', 'Hand-linked plan',
        'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001');

select pg_temp.as_session('a2000000-0000-4000-8000-000000000001');
select lives_ok(
  $$ insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label, created_by)
     values ('c2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
             'd2000000-0000-4000-8000-000000000002', 'h0', 'Hand-linked', 'a2000000-0000-4000-8000-000000000001') $$,
  'session owner links a milestone to a heading of D2'
);

select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), array['2:live'],
  'an app''s doc link records the linker''s connection');
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000002'), '{}'::text[],
  'first-party link writes record no connection');

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

-- D-61: another OAuth client, a well-formed id that is not doqtri's.
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222');
select lives_ok(
  $$ select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000002', 'Hand-linked plan, by another app',
       'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000002') $$,
  'a write by a second OAuth client succeeds'
);
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000002'), '{}'::text[],
  '... but does not count as a doqtri connection (D-61)');

-- D-61: with doqtri's client id unset, not even doqtri's writes count (and a
-- WARNING says so, which pgTAP cannot see).
update public.integration_settings set doqtri_oauth_client_id = null;
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000002', 'Hand-linked plan',
       'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000002') $$,
  'a write by doqtri''s client while the setting is unset succeeds'
);
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000002'), '{}'::text[],
  '... and records nothing while doqtri_oauth_client_id is unset');
update public.integration_settings set doqtri_oauth_client_id = '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d';


-- ----------------------------------------------------------------------------
-- 3. Who reads, who writes
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a2000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.doc_link_connections), 2,
  'a project viewer reads the connections of the project''s docs');

select pg_temp.as_session('a2000000-0000-4000-8000-000000000004');
select throws_ok(
  $$ select user_id from public.doc_link_connections $$,
  '42501', null,
  'a viewer cannot read who the connection belongs to'
);
select throws_ok(
  $$ select client_id, last_write_at from public.doc_link_connections $$,
  '42501', null,
  '... nor through which client, or when it last wrote'
);

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

-- doqtri still holds the admin's access token from before the revoke (it
-- stays valid until it expires) and saves the doc with it: refused (D-75).
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000001', 'Payroll v1 plan',
       'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000001') $$,
  '42501', 'This app''s access to qdit was revoked.',
  'a write with a token issued before the revoke is refused (D-75)'
);
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002', p_iat_offset => null);
select throws_ok(
  $$ select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000001', 'Payroll v1 plan',
       'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000001') $$,
  '42501', 'This app''s access to qdit was revoked.',
  '... and so is one with a token with no iat'
);

-- The same write past every guard: the trigger alone still keeps it revoked.
select pg_temp.as_owner_with_token('a2000000-0000-4000-8000-000000000002');
update public.project_doc_links set doc_title = 'Payroll v1 plan (saved)'
 where doc_id = 'd2000000-0000-4000-8000-000000000001';
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), array['2:revoked', '3:left_project'],
  'a pre-revoke token''s write that skips the guards does not make the revoked connection live again');

select pg_temp.as_owner_with_token('a2000000-0000-4000-8000-000000000002', p_iat_offset => null);
update public.project_doc_links set doc_title = 'Payroll v1 plan'
 where doc_id = 'd2000000-0000-4000-8000-000000000001';
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), array['2:revoked', '3:left_project'],
  'a token with no iat counts as one from before the revoke');

-- The same old token links another doc, which the admin never wrote before.
select pg_temp.as_owner_with_token('a2000000-0000-4000-8000-000000000002');
insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url, linked_by)
values ('b2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000004', 'Late plan',
        'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000002');
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000004'), array['2:revoked'],
  'a pre-revoke token''s first write to another doc records it as already revoked');

-- The admin reconnects doqtri, and doqtri re-posts the doc with the new
-- grant's token, issued after the revoke.
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002', p_iat_offset => 60);
select lives_ok(
  $$ select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000001', 'Payroll v1 plan',
       'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000001') $$,
  'oauth admin re-posts D1 after reconnecting'
);
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), array['2:live', '3:left_project'],
  'a write with a token issued after the revoke makes the connection live again');
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000004'), array['2:revoked'],
  '... that doc only: the other stays revoked until it is written again');

-- The member's account is deleted: its rows go with it, and the delete works
-- (their milestone link's created_by is set null, which records nothing).
select lives_ok(
  $$ delete from auth.users where id = 'a2000000-0000-4000-8000-000000000003' $$,
  'deleting an account that wrote a link succeeds'
);
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), array['2:live'],
  'a deleted account''s connections are gone');


-- ----------------------------------------------------------------------------
-- 4b. A revoke by a user with no rows (D-59)
--
-- The owner has written nothing through doqtri, so revoking marks no row. The
-- revoke is still on record (oauth_client_revocations), and that is what a
-- pre-revoke token's first write is compared with.
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a2000000-0000-4000-8000-000000000001');
select is(public.mark_doc_link_connections_revoked('9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d'), 0,
  'a user with no connection rows revokes doqtri: nothing to mark');

select pg_temp.as_postgres();
select is(
  (select r.revoked_at from public.oauth_client_revocations r
    where r.user_id = 'a2000000-0000-4000-8000-000000000001'
      and r.client_id = '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d'),
  now(),
  '... but the revoke is on record'
);

-- doqtri still holds the owner's token from before the revoke. Through the
-- RPC it is refused (D-75); past the guards, the trigger records it revoked.
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000005', 'Owner plan',
       'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000005') $$,
  '42501', 'This app''s access to qdit was revoked.',
  'a pre-revoke token of a user with no rows is refused (D-75)'
);
select pg_temp.as_owner_with_token('a2000000-0000-4000-8000-000000000001');
insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url, linked_by)
values ('b2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000005', 'Owner plan',
        'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000001');
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000005'), array['1:revoked'],
  '... and the write is recorded as revoked, not live');

-- The owner connects doqtri again: the new grant's token is issued later.
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000001', p_iat_offset => 60);
select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000005', 'Owner plan',
  'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000005');
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000005'), array['1:live'],
  'a token from the re-consent makes it live');


-- ----------------------------------------------------------------------------
-- 4c. Recording the revoke marks the rows at once (WP-2.12)
--
-- revokeAuthorizedApp() step 1. If Auth then refuses the revoke, doqtri's
-- refresh still works and its next write carries a later iat, which makes the
-- connection live again: the mark heals itself.
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a2000000-0000-4000-8000-000000000001');
select is(public.record_oauth_client_revocation('9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d'), now(),
  'the owner records a revoke of doqtri');
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000005'), array['1:revoked'],
  '... which marks their live connection lost straight away, before Auth is asked');

-- Auth refused the revoke; doqtri refreshed and saves the doc again.
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000001', p_iat_offset => 120);
select * from public.link_project_doc('b2000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000005', 'Owner plan',
  'https://www.doqtri.xyz/d/d2000000-0000-4000-8000-000000000005');
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000005'), array['1:live'],
  '... and a write with a later token makes it live again');


-- ----------------------------------------------------------------------------
-- 4d. Only the current doqtri client's rows count for the card (WP-2.12)
-- ----------------------------------------------------------------------------

-- The operator re-registers doqtri under a new client id.
update public.integration_settings set doqtri_oauth_client_id = '33333333-3333-4333-8333-333333333333';
select pg_temp.as_session('a2000000-0000-4000-8000-000000000004');
select is(
  (select count(*)::int from public.doc_link_connections c
     join public.project_doc_links d on d.id = c.doc_link_id
    where d.doc_id = 'd2000000-0000-4000-8000-000000000005'),
  0,
  'after doqtri is re-registered, a viewer reads no row recorded for the old client (the card says lost)'
);
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000005'), array['1:live'],
  '... and the row itself is kept, not deleted');

update public.integration_settings set doqtri_oauth_client_id = '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d';
select pg_temp.as_session('a2000000-0000-4000-8000-000000000004');
select is(
  (select count(*)::int from public.doc_link_connections c
     join public.project_doc_links d on d.id = c.doc_link_id
    where d.doc_id = 'd2000000-0000-4000-8000-000000000005' and c.lost_at is null),
  1,
  'with the id put back, the row counts again'
);
select pg_temp.as_postgres();


-- ----------------------------------------------------------------------------
-- 5. Cascades
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002', p_iat_offset => 60);
select lives_ok(
  $$ select public.unlink_project_doc('b2000000-0000-4000-8000-000000000001',
       'd2000000-0000-4000-8000-000000000001') $$,
  'oauth admin unlinks D1'
);
select pg_temp.as_postgres();
select is(pg_temp.connections('d2000000-0000-4000-8000-000000000001'), '{}'::text[],
  'unlinking a doc removes its connections');

-- A project with a connected doc can still be deleted (the membership rows go
-- in the same cascade as the doc links and their connections).
select pg_temp.as_oauth_client('a2000000-0000-4000-8000-000000000002', p_iat_offset => 60);
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
