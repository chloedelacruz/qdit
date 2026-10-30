-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/integration_links.test.sql
--
-- Covers 20261024120000_integration_links.sql: the two doqtri link tables,
-- their D-23 policies and D-03 guards, the title lock on linked milestones
-- (D-12), the frozen columns of both link tables (and their one exception,
-- the account going), the rule that a linked milestone stays in its project,
-- the D-22 cascade, and the three /api/v1 RPCs. Also
-- 20261025090000_integration_hardening.sql section 1: no client writes a doc
-- link directly, every INSERT and UPDATE goes through link_project_doc()
-- (D-48), so the frozen-column trigger is exercised as postgres.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back.
--
-- Callers are simulated the way oauth_client_guards.test.sql does it: the
-- JWT's role and claims, which is all auth.uid() and auth.jwt() read. As
-- there, a refused INSERT raises while a refused UPDATE or DELETE filters the
-- row out silently, so the latter are checked by reading the row afterwards
-- as postgres. Trigger refusals raise for every command.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(109);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- u1 owner, u2 admin, u3 member, u4 viewer of P1; u5 owns P2 and is a
-- stranger to P1.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'links-owner@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Owner","username":"links_owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'links-admin@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Admin","username":"links_admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'links-member@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Member","username":"links_member"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'links-viewer@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Viewer","username":"links_viewer"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'links-stranger@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Stranger","username":"links_stranger"}', now(), now());

insert into public.projects (id, owner_id, name, slug)
values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Links', 'links-test'),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000005', 'Elsewhere', 'links-elsewhere');

insert into public.project_members (project_id, user_id, role)
values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'admin'),
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'member'),
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', 'viewer');

-- M1 stays unlinked; M2 is linked to node h1 of doc D1.
insert into public.milestones (id, project_id, title, status, order_index)
values
  ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Unlinked', 'proposed', 0),
  ('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'Escrow contract', 'submitted', 4),
  ('c1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002', 'Other project', 'proposed', 0);

insert into public.project_doc_links (id, project_id, doc_id, doc_title, doc_url, linked_by)
values ('e1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000001', 'Payroll v1 plan',
        'https://www.doqtri.xyz/d/d1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002');

insert into public.milestone_external_links (id, milestone_id, project_id, doc_id, node_id, node_label, doc_version, created_by)
values ('f1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
        'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
        'h1', 'Escrow contract', 7, 'a1000000-0000-4000-8000-000000000003');


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


-- ----------------------------------------------------------------------------
-- 1. Shape: what the schema itself refuses
-- ----------------------------------------------------------------------------

select ok(
  (select bool_and(c.relrowsecurity)
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('project_doc_links', 'milestone_external_links')),
  'RLS is enabled on both link tables'
);

select throws_ok(
  $$ insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url)
     values ('b1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001',
             'Same doc', 'https://www.doqtri.xyz/d/x') $$,
  '23505', null,
  'a doc belongs to at most one project (D-09)'
);
select lives_ok(
  $$ insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url)
     values ('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002',
             'Second plan', 'https://www.doqtri.xyz/d/y') $$,
  'a project holds many docs (D-09)'
);
select throws_ok(
  $$ insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url)
     values ('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000009',
             'Plain http', 'http://www.doqtri.xyz/d/z') $$,
  '23514', null,
  'doc_url must be https'
);

-- The rest of the https rule (D-45's origin is the app's, see the migration).
select lives_ok(
  $$ insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url)
     values ('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000020',
             'Port, query and fragment', 'https://www.doqtri.xyz:8443/d/1?v=2#h3') $$,
  'doc_url: a port, a query and a fragment are fine'
);
select lives_ok(
  $$ insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url)
     values ('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000021',
             'Bare origin', 'https://www.doqtri.xyz') $$,
  'doc_url: a bare origin is fine'
);
select is(
  (select count(*)::int from (values
     ('https://www.doqtri.xyz@evil.example/d/1'),
     ('https://user:pw@www.doqtri.xyz/d/1'),
     ('https://d' || chr(1086) || 'qtri.xyz/d/1'),
     ('https://www.doqtri.xyz/d/1 2'),
     ('https://www.doqtri.xyz/d/1' || chr(10)),
     ('https://www.doqtri.xyz/d/' || chr(0x7f)),
     ('https://www.doqtri.xyz\evil.example/'),
     ('https://www.doqtri.xyz/\evil.example'),
     ('https://www.doqtri.xyz:/d/1'),
     ('https://www.doqtri.xyz:123456/d/1'),
     ('https:///d/1'),
     (' https://www.doqtri.xyz/d/1'),
     ('HTTPS://www.doqtri.xyz/d/1'),
     ('https://www.doqtri.xyz/' || repeat('a', 2048))
   ) as bad (url)
   where bad.url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]\\]*)?$'
     and char_length(bad.url) <= 2048),
  0,
  'every bad doc_url in the list fails the CHECK expression'
);
select is(
  (select pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid),
            '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]\\]*)?$') > 0
     from pg_catalog.pg_constraint c
    where c.conname = 'project_doc_links_doc_url_check'),
  true,
  'the CHECK on doc_url is the expression the list above was run against'
);
select throws_ok(
  $$ insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url)
     values ('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000022',
             'User info', 'https://www.doqtri.xyz@evil.example/d/1') $$,
  '23514', null,
  'doc_url: user info in the authority is refused'
);
select throws_ok(
  $$ insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url)
     values ('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000023',
             'Look-alike', 'https://d' || chr(1086) || 'qtri.xyz/d/1') $$,
  '23514', null,
  'doc_url: a non-ASCII host is refused'
);
select throws_ok(
  $$ insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url)
     values ('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000024',
             'Whitespace', 'https://www.doqtri.xyz/d/1 onmouseover=x') $$,
  '23514', null,
  'doc_url: whitespace after the host is refused'
);
select throws_ok(
  $$ insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url)
     values ('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000025',
             'Backslash', 'https://www.doqtri.xyz\evil.example/') $$,
  '23514', null,
  'doc_url: a backslash is refused'
);
delete from public.project_doc_links
 where doc_id in ('d1000000-0000-4000-8000-000000000020', 'd1000000-0000-4000-8000-000000000021');
select throws_ok(
  $$ insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label)
     values ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000001', 'h1', 'Unlinked') $$,
  '23505', null,
  'one milestone per node (D-06)'
);
select throws_ok(
  $$ insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label)
     values ('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000001', 'h9', 'Escrow contract') $$,
  '23505', null,
  'one node per milestone (D-06)'
);
select throws_ok(
  $$ insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label)
     values ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000099', 'h2', 'Unlinked') $$,
  '23503', null,
  'a milestone link needs its doc linked to the same project'
);
select throws_ok(
  $$ insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label)
     values ('c1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000001', 'h2', 'Other project') $$,
  '23514', 'A milestone link must be in the milestone''s own project.',
  'a milestone link is in its milestone''s project'
);
select throws_ok(
  $$ insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label)
     values ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000001', 'h2', 'Something else') $$,
  '23514', null,
  'node_label must equal the milestone title on insert (D-12)'
);
select throws_ok(
  $$ insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label)
     values ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000001', 'h 2', 'Unlinked') $$,
  '23514', null,
  'node_id must be a doqtri node id'
);
select is(
  (select doc_title from public.milestone_external_links where id = 'f1000000-0000-4000-8000-000000000001'),
  'Payroll v1 plan',
  'a link copies its doc''s title'
);


-- ----------------------------------------------------------------------------
-- 2. Reads (D-23 viewer+, and readable by apps per D-03)
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000004');
select is(
  (select count(*)::int from public.project_doc_links where project_id = 'b1000000-0000-4000-8000-000000000001'),
  2,
  'oauth viewer: reads the project''s doc links'
);
select is(
  (select count(*)::int from public.milestone_external_links where project_id = 'b1000000-0000-4000-8000-000000000001'),
  1,
  'oauth viewer: reads the project''s milestone links'
);

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000005');
select is(
  (select count(*)::int from public.project_doc_links where project_id = 'b1000000-0000-4000-8000-000000000001'),
  0,
  'oauth stranger: sees no doc links of a project it is not in'
);
select is(
  (select count(*)::int from public.milestone_external_links),
  0,
  'oauth stranger: sees no milestone links of a project it is not in'
);


-- ----------------------------------------------------------------------------
-- 3. Doc link writes: admin+ (D-23), only through link_project_doc() (D-48);
-- apps and sessions delete directly
-- ----------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.project_doc_links', 'insert')
  and not has_table_privilege('authenticated', 'public.project_doc_links', 'update')
  and not has_table_privilege('anon', 'public.project_doc_links', 'insert')
  and not has_table_privilege('anon', 'public.project_doc_links', 'update'),
  'D-48: neither authenticated nor anon may INSERT or UPDATE doc links'
);
select ok(
  has_table_privilege('authenticated', 'public.project_doc_links', 'select')
  and has_table_privilege('authenticated', 'public.project_doc_links', 'delete'),
  'D-48: authenticated still reads and deletes doc links, as the policies allow'
);
select is_empty(
  $$ select p.policyname
       from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'project_doc_links'
        and p.cmd in ('INSERT', 'UPDATE')
        and (p.permissive = 'PERMISSIVE'
             or coalesce(p.qual, 'false') <> 'false'
             or coalesce(p.with_check, 'false') <> 'false') $$,
  'D-48: no policy admits a direct INSERT or UPDATE, should a grant come back'
);

-- A project admin, with their own qdit session and as an app: refused at
-- the grant, whatever the row says.
select pg_temp.as_session('a1000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url, linked_by)
     values ('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003',
             'Direct', 'https://www.doqtri.xyz/d/3', 'a1000000-0000-4000-8000-000000000002') $$,
  '42501', 'permission denied for table project_doc_links',
  'session admin: a direct INSERT is refused (D-48)'
);
select throws_ok(
  $$ update public.project_doc_links set doc_url = 'https://evil.example/d/1'
      where id = 'e1000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table project_doc_links',
  'session admin: a direct UPDATE is refused (D-48)'
);
select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url, linked_by)
     values ('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003',
             'Direct', 'https://www.doqtri.xyz/d/3', 'a1000000-0000-4000-8000-000000000002') $$,
  '42501', 'permission denied for table project_doc_links',
  'oauth admin: a direct INSERT is refused (D-48)'
);
select throws_ok(
  $$ update public.project_doc_links set doc_title = 'Rewritten by an app'
      where id = 'e1000000-0000-4000-8000-000000000001' $$,
  '42501', 'permission denied for table project_doc_links',
  'oauth admin: a direct UPDATE is refused (D-48)'
);

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ select * from public.link_project_doc(
       'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003',
       'By a member', 'https://www.doqtri.xyz/d/3') $$,
  '42501', null,
  'oauth member: cannot link a doc (admin+)'
);

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select * from public.link_project_doc(
       'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003',
       'By an admin', 'https://www.doqtri.xyz/d/3') $$,
  'oauth admin: links a doc through link_project_doc'
);
select pg_temp.as_postgres();
select is(
  (select linked_by from public.project_doc_links where doc_id = 'd1000000-0000-4000-8000-000000000003'),
  'a1000000-0000-4000-8000-000000000002'::uuid,
  'link_project_doc: linked_by is always the caller, never another user'
);

-- D-60: not from a qdit session, even an admin's; doc links come from doqtri.
select pg_temp.as_session('a1000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select * from public.link_project_doc(
       'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
       'Payroll v1.1 plan', 'https://www.doqtri.xyz/d/d1000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'session admin: cannot call link_project_doc (D-60)'
);

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000002');
select is(
  (select doc_title from public.link_project_doc(
     'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
     'Payroll v1.1 plan', 'https://www.doqtri.xyz/d/d1000000-0000-4000-8000-000000000001')),
  'Payroll v1.1 plan',
  'oauth admin: refreshes a doc link through link_project_doc'
);
select throws_ok(
  $$ select * from public.link_project_doc(
       'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
       'Payroll', 'http://www.doqtri.xyz/d/1') $$,
  '23514', null,
  'link_project_doc: the https CHECK holds for the function too (D-45)'
);
select pg_temp.as_postgres();
select is(
  (select doc_title from public.milestone_external_links where id = 'f1000000-0000-4000-8000-000000000001'),
  'Payroll v1.1 plan',
  'the milestone link''s doc_title follows the doc link'
);

-- Only doc_title and doc_url move. No client can UPDATE the table any more,
-- so the trigger is tested as a privileged session, which RLS does not stop:
-- what refuses these is check_project_doc_link(), for every caller.
-- A doc with no milestone links, so the composite foreign key cannot be what
-- refuses the move.
insert into public.project_doc_links (id, project_id, doc_id, doc_title, doc_url, linked_by)
values ('e1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000008', 'Unused plan', 'https://www.doqtri.xyz/d/8',
        'a1000000-0000-4000-8000-000000000002');

select throws_ok(
  $$ update public.project_doc_links set project_id = 'b1000000-0000-4000-8000-000000000002'
      where id = 'e1000000-0000-4000-8000-000000000002' $$,
  '42501', 'Only doc_title and doc_url of a doc link can change; unlink the doc and link it again instead.',
  'a direct database session cannot move a doc link to another project'
);
select throws_ok(
  $$ update public.project_doc_links set doc_id = 'd1000000-0000-4000-8000-000000000009'
      where id = 'e1000000-0000-4000-8000-000000000002' $$,
  '42501', 'Only doc_title and doc_url of a doc link can change; unlink the doc and link it again instead.',
  'a direct database session cannot re-point a doc link at another doc'
);
select throws_ok(
  $$ update public.project_doc_links set linked_by = 'a1000000-0000-4000-8000-000000000001'
      where id = 'e1000000-0000-4000-8000-000000000002' $$,
  '42501', 'Only doc_title and doc_url of a doc link can change; unlink the doc and link it again instead.',
  'a direct database session cannot rewrite who linked a doc'
);
select lives_ok(
  $$ update public.project_doc_links set doc_title = 'Unused plan (ops)'
      where id = 'e1000000-0000-4000-8000-000000000002' $$,
  'a direct database session may still refresh the copies'
);
delete from public.project_doc_links where id = 'e1000000-0000-4000-8000-000000000002';

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000003');
delete from public.project_doc_links where doc_id = 'd1000000-0000-4000-8000-000000000003';
select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.project_doc_links where doc_id = 'd1000000-0000-4000-8000-000000000003'),
  1,
  'oauth member: cannot unlink a doc (admin+)'
);
select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000002');
delete from public.project_doc_links where doc_id = 'd1000000-0000-4000-8000-000000000003';
select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.project_doc_links where doc_id = 'd1000000-0000-4000-8000-000000000003'),
  0,
  'oauth admin: unlinks a doc'
);


-- ----------------------------------------------------------------------------
-- 4. Milestone link writes: member+ (D-23); apps insert, re-point (D-21) and
-- delete
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label, created_by)
     values ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000001', 'h2', 'Unlinked', 'a1000000-0000-4000-8000-000000000004') $$,
  '42501', null,
  'oauth viewer: cannot write a milestone link'
);
update public.milestone_external_links set node_id = 'h8'
 where id = 'f1000000-0000-4000-8000-000000000001';
select pg_temp.as_postgres();
select is(
  (select node_id from public.milestone_external_links where id = 'f1000000-0000-4000-8000-000000000001'),
  'h1',
  'oauth viewer: cannot re-point a milestone link'
);

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000003');
select lives_ok(
  $$ insert into public.milestone_external_links (id, milestone_id, project_id, doc_id, node_id, node_label, created_by)
     values ('f1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000001', 'h2', 'Unlinked', 'a1000000-0000-4000-8000-000000000003') $$,
  'oauth member: writes a milestone link'
);
select throws_ok(
  $$ insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label, created_by)
     values ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000002', 'h2', 'Unlinked', 'a1000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'oauth member: cannot write a milestone link in another user''s name'
);
update public.milestone_external_links set node_id = 'h5', doc_version = 8
 where id = 'f1000000-0000-4000-8000-000000000001';
select is(
  (select node_id || '@' || doc_version from public.milestone_external_links where id = 'f1000000-0000-4000-8000-000000000001'),
  'h5@8',
  'oauth member: re-points a link in place (D-21)'
);
select throws_ok(
  $$ update public.milestone_external_links set node_id = 'h2'
      where id = 'f1000000-0000-4000-8000-000000000001' $$,
  '23505', null,
  'oauth member: cannot re-point onto a node that already has a milestone'
);
select throws_ok(
  $$ update public.milestone_external_links set milestone_id = 'c1000000-0000-4000-8000-000000000001'
      where id = 'f1000000-0000-4000-8000-000000000001' $$,
  '42501', 'Only node_id and doc_version of a milestone link can change.',
  'oauth member: cannot move a link to another milestone'
);
select throws_ok(
  $$ update public.milestone_external_links set doc_id = 'd1000000-0000-4000-8000-000000000002'
      where id = 'f1000000-0000-4000-8000-000000000001' $$,
  '42501', 'Only node_id and doc_version of a milestone link can change.',
  'oauth member: cannot move a link to another doc'
);
select throws_ok(
  $$ update public.milestone_external_links set node_label = 'Renamed here'
      where id = 'f1000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'oauth member: cannot change node_label apart from the title (D-12)'
);
delete from public.milestone_external_links where id = 'f1000000-0000-4000-8000-000000000002';
select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.milestone_external_links where id = 'f1000000-0000-4000-8000-000000000002'),
  0,
  'oauth member: deletes a milestone link'
);
select is(
  (select count(*)::int from public.milestones where id = 'c1000000-0000-4000-8000-000000000001'),
  1,
  'deleting a link leaves its milestone'
);


-- ----------------------------------------------------------------------------
-- 5. The title lock (D-12) and the app column limit (D-03)
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000003');
update public.milestones set title = 'Escrow contract v2'
 where id = 'c1000000-0000-4000-8000-000000000002';
select is(
  (select title from public.milestones where id = 'c1000000-0000-4000-8000-000000000002'),
  'Escrow contract v2',
  'oauth member: renames a linked milestone'
);
select is(
  (select node_label from public.milestone_external_links where id = 'f1000000-0000-4000-8000-000000000001'),
  'Escrow contract v2',
  'the link''s node_label follows the title'
);
select throws_ok(
  $$ update public.milestones set status = 'approved'
      where id = 'c1000000-0000-4000-8000-000000000002' $$,
  '42501', 'Apps connected through OAuth can only rename a linked milestone.',
  'oauth member: cannot approve a linked milestone'
);
select throws_ok(
  $$ update public.milestones set title = 'Both', description = 'and more'
      where id = 'c1000000-0000-4000-8000-000000000002' $$,
  '42501', 'Apps connected through OAuth can only rename a linked milestone.',
  'oauth member: cannot change anything beside the title'
);
select throws_ok(
  $$ update public.milestones set order_index = 99
      where id = 'c1000000-0000-4000-8000-000000000002' $$,
  '42501', null,
  'oauth member: cannot reorder a linked milestone'
);
update public.milestones set title = 'Renamed by an app'
 where id = 'c1000000-0000-4000-8000-000000000001';
select is(
  (select title from public.milestones where id = 'c1000000-0000-4000-8000-000000000001'),
  'Unlinked',
  'oauth member: cannot rename an unlinked milestone'
);

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000004');
update public.milestones set title = 'Renamed by a viewer'
 where id = 'c1000000-0000-4000-8000-000000000002';
select is(
  (select title from public.milestones where id = 'c1000000-0000-4000-8000-000000000002'),
  'Escrow contract v2',
  'oauth viewer: cannot rename a linked milestone (member+)'
);

select pg_temp.as_session('a1000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ update public.milestones set title = 'Renamed in qdit'
      where id = 'c1000000-0000-4000-8000-000000000002' $$,
  '42501', 'This milestone''s title is managed by doqtri.',
  'session member: cannot rename a linked milestone (D-12)'
);
select lives_ok(
  $$ update public.milestones set description = 'Edited in qdit', title = 'Escrow contract v2'
      where id = 'c1000000-0000-4000-8000-000000000002' $$,
  'session member: edits a linked milestone''s other fields, title unchanged'
);
select lives_ok(
  $$ update public.milestones set status = 'rejected'
      where id = 'c1000000-0000-4000-8000-000000000002' $$,
  'session member: still moves a linked milestone''s status'
);
select lives_ok(
  $$ update public.milestones set title = 'Unlinked, renamed'
      where id = 'c1000000-0000-4000-8000-000000000001' $$,
  'session member: renames an unlinked milestone'
);

select pg_temp.as_postgres();
select lives_ok(
  $$ update public.milestones set title = 'Escrow contract (ops)'
      where id = 'c1000000-0000-4000-8000-000000000002' $$,
  'a direct database session (no JWT) is not limited by the lock'
);

-- A linked milestone stays in its project, for every caller. u3 is made a
-- member of P2 too, so RLS would allow the move.
insert into public.project_members (project_id, user_id, role)
values ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'member');

select pg_temp.as_session('a1000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ update public.milestones set project_id = 'b1000000-0000-4000-8000-000000000002'
      where id = 'c1000000-0000-4000-8000-000000000002' $$,
  '23514', 'A milestone linked to a doqtri plan cannot move to another project; unlink it first.',
  'session member of both projects: cannot move a linked milestone'
);
select lives_ok(
  $$ update public.milestones set project_id = 'b1000000-0000-4000-8000-000000000002'
      where id = 'c1000000-0000-4000-8000-000000000001' $$,
  'session member of both projects: still moves an unlinked milestone'
);

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ update public.milestones set project_id = 'b1000000-0000-4000-8000-000000000002'
      where id = 'c1000000-0000-4000-8000-000000000002' $$,
  '23514', null,
  'oauth member of both projects: cannot move a linked milestone'
);

select pg_temp.as_postgres();
select is(
  (select project_id from public.milestones where id = 'c1000000-0000-4000-8000-000000000001'),
  'b1000000-0000-4000-8000-000000000002'::uuid,
  'the unlinked milestone moved'
);
select throws_ok(
  $$ update public.milestones set project_id = 'b1000000-0000-4000-8000-000000000002'
      where id = 'c1000000-0000-4000-8000-000000000002' $$,
  '23514', null,
  'a direct database session cannot move a linked milestone either'
);
update public.milestones set project_id = 'b1000000-0000-4000-8000-000000000001'
 where id = 'c1000000-0000-4000-8000-000000000001';
delete from public.project_members
 where project_id = 'b1000000-0000-4000-8000-000000000002'
   and user_id = 'a1000000-0000-4000-8000-000000000003';


-- ----------------------------------------------------------------------------
-- 6. link_project_doc()
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000002');
select is(
  (select row(doc_title, created)::text from public.link_project_doc(
     'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005',
     '  Treasury plan  ', 'https://www.doqtri.xyz/d/5')),
  row('Treasury plan', true)::text,
  'link_project_doc: oauth admin links a new doc, title trimmed, created'
);
select is(
  (select row(doc_title, doc_url, created)::text from public.link_project_doc(
     'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005',
     'Treasury plan v2', 'https://www.doqtri.xyz/d/5?v=2')),
  row('Treasury plan v2', 'https://www.doqtri.xyz/d/5?v=2', false)::text,
  'link_project_doc: re-posting refreshes title and url, not created'
);
select is(
  (select count(*)::int from public.project_doc_links where doc_id = 'd1000000-0000-4000-8000-000000000005'),
  1,
  'link_project_doc: re-posting is idempotent'
);
select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000005');
select throws_ok(
  $$ select * from public.link_project_doc(
       'b1000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000005',
       'Taken', 'https://www.doqtri.xyz/d/5') $$,
  'QD409', 'doc_linked_elsewhere',
  'link_project_doc: a doc linked to another project is a conflict'
);
select throws_ok(
  $$ select * from public.link_project_doc(
       'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000006',
       'Not mine', 'https://www.doqtri.xyz/d/6') $$,
  'P0002', null,
  'link_project_doc: a project the caller is not in is not found'
);
select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ select * from public.link_project_doc(
       'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000006',
       'By a member', 'https://www.doqtri.xyz/d/6') $$,
  '42501', null,
  'link_project_doc: a member is forbidden (admin+)'
);


-- ----------------------------------------------------------------------------
-- 7. create_linked_milestone()
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000003');
select lives_ok(
  $$ select set_config('test.new_milestone', public.create_linked_milestone(
       'b1000000-0000-4000-8000-000000000001', '  Payroll run  ', null, '2026-11-15',
       'd1000000-0000-4000-8000-000000000001', 'h4', 7)::text, true) $$,
  'create_linked_milestone: oauth member creates a linked milestone'
);
select is(
  (select row(m.title, m.status, m.order_index, m.due_date)::text
     from public.milestones m where m.id = current_setting('test.new_milestone')::uuid),
  row('Payroll run', 'proposed'::public.milestone_status, 5, '2026-11-15'::date)::text,
  'create_linked_milestone: proposed, trimmed, after the last order_index'
);
select is(
  (select row(l.node_id, l.node_label, l.doc_version, l.doc_title, l.source, l.created_by)::text
     from public.milestone_external_links l where l.milestone_id = current_setting('test.new_milestone')::uuid),
  row('h4', 'Payroll run', 7::bigint, 'Payroll v1.1 plan', 'doqtri', 'a1000000-0000-4000-8000-000000000003'::uuid)::text,
  'create_linked_milestone: the link carries node, label, version, doc title and creator'
);
select throws_ok(
  $$ select public.create_linked_milestone(
       'b1000000-0000-4000-8000-000000000001', 'Again', null, null,
       'd1000000-0000-4000-8000-000000000001', 'h4', null) $$,
  'QD409', 'node_already_linked',
  'create_linked_milestone: a node that already has a milestone is a conflict'
);
select is(
  pg_temp.raised_hint($$ select public.create_linked_milestone(
       'b1000000-0000-4000-8000-000000000001', 'Again', null, null,
       'd1000000-0000-4000-8000-000000000001', 'h4', null) $$),
  current_setting('test.new_milestone'),
  'create_linked_milestone: the conflict names the existing milestone'
);
select throws_ok(
  $$ select public.create_linked_milestone(
       'b1000000-0000-4000-8000-000000000001', 'Unlinked doc', null, null,
       'd1000000-0000-4000-8000-000000000077', 'h1', null) $$,
  'QD409', 'doc_not_linked',
  'create_linked_milestone: refuses a doc not linked to the project'
);
select throws_ok(
  $$ select public.create_linked_milestone(
       'b1000000-0000-4000-8000-000000000002', 'Wrong project', null, null,
       'd1000000-0000-4000-8000-000000000001', 'h6', null) $$,
  'P0002', null,
  'create_linked_milestone: a project the caller is not in is not found'
);
select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000005');
select throws_ok(
  $$ select public.create_linked_milestone(
       'b1000000-0000-4000-8000-000000000002', 'Doc of another project', null, null,
       'd1000000-0000-4000-8000-000000000001', 'h6', null) $$,
  'QD409', 'doc_not_linked',
  'create_linked_milestone: refuses a doc linked to a different project'
);
select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000004');
select throws_ok(
  $$ select public.create_linked_milestone(
       'b1000000-0000-4000-8000-000000000001', 'By a viewer', null, null,
       'd1000000-0000-4000-8000-000000000001', 'h6', null) $$,
  '42501', null,
  'create_linked_milestone: a viewer is forbidden (member+)'
);


-- ----------------------------------------------------------------------------
-- 8. unlink_project_doc() and the D-22 cascade
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a1000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select public.unlink_project_doc('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'session admin: cannot call unlink_project_doc (D-60); a direct delete stays'
);

select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ select public.unlink_project_doc('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'unlink_project_doc: a member is forbidden (admin+)'
);
select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000005');
select throws_ok(
  $$ select public.unlink_project_doc('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001') $$,
  'P0002', null,
  'unlink_project_doc: a project the caller is not in is not found'
);

select pg_temp.as_postgres();
select set_config('test.removed', (
  select array_agg(l.id order by l.id)::text
    from public.milestone_external_links l
   where l.doc_id = 'd1000000-0000-4000-8000-000000000001'), true);
select is(
  cardinality(current_setting('test.removed')::uuid[]),
  2,
  'fixture: the doc has two milestone links before the unlink'
);
select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000002');
select is(
  public.unlink_project_doc('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001'),
  current_setting('test.removed')::uuid[],
  'unlink_project_doc: returns every removed link id'
);
select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.milestone_external_links where doc_id = 'd1000000-0000-4000-8000-000000000001'),
  0,
  'unlink_project_doc: the doc''s milestone links are gone (D-22)'
);
select is(
  (select count(*)::int from public.project_doc_links where doc_id = 'd1000000-0000-4000-8000-000000000001'),
  0,
  'unlink_project_doc: the doc link is gone'
);
select is(
  (select count(*)::int from public.milestones
    where id in ('c1000000-0000-4000-8000-000000000002', current_setting('test.new_milestone')::uuid)),
  2,
  'unlink_project_doc: the milestones stay'
);
select pg_temp.as_oauth_client('a1000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ select public.unlink_project_doc('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001') $$,
  'P0002', null,
  'unlink_project_doc: a repeated unlink is not found'
);
select is(
  public.unlink_project_doc('b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005'),
  '{}'::uuid[],
  'unlink_project_doc: a doc with no milestone links returns an empty list'
);

select pg_temp.as_session('a1000000-0000-4000-8000-000000000003');
select lives_ok(
  $$ update public.milestones set title = 'Editable again'
      where id = 'c1000000-0000-4000-8000-000000000002' $$,
  'session member: an unlinked milestone''s title is editable again'
);

-- The cascade holds whatever removes the doc link, not only the RPC.
select pg_temp.as_postgres();
insert into public.milestone_external_links (id, milestone_id, project_id, doc_id, node_id, node_label)
values ('f1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001',
        'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'h1', 'Unlinked, renamed');
select pg_temp.as_session('a1000000-0000-4000-8000-000000000002');
delete from public.project_doc_links where doc_id = 'd1000000-0000-4000-8000-000000000002';
select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.milestone_external_links where id = 'f1000000-0000-4000-8000-000000000003'),
  0,
  'a direct delete of the doc link cascades to its milestone links (D-22)'
);


-- ----------------------------------------------------------------------------
-- 9. Functions: what a client may call
-- ----------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.guard_milestone_update()', 'execute')
  and not has_function_privilege('authenticated', 'public.check_milestone_external_link()', 'execute')
  and not has_function_privilege('authenticated', 'public.check_project_doc_link()', 'execute')
  and not has_function_privilege('authenticated', 'public.sync_link_node_label()', 'execute')
  and not has_function_privilege('authenticated', 'public.sync_link_doc_title()', 'execute')
  and not has_function_privilege('authenticated', 'public.assert_project_role(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.assert_oauth_client_session()', 'execute'),
  'trigger functions, assert_project_role and assert_oauth_client_session are not callable by clients'
);
select ok(
  has_function_privilege('authenticated', 'public.link_project_doc(uuid, uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.unlink_project_doc(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.create_linked_milestone(uuid, text, text, date, uuid, text, bigint)', 'execute'),
  'the three RPCs are callable by authenticated'
);
select ok(
  not has_function_privilege('anon', 'public.link_project_doc(uuid, uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.unlink_project_doc(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.create_linked_milestone(uuid, text, text, date, uuid, text, bigint)', 'execute'),
  'the RPCs are not callable by anon'
);
select ok(
  (select bool_and(p.proconfig @> array['search_path=""'])
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('guard_milestone_update', 'check_milestone_external_link', 'check_project_doc_link',
                        'link_author_gone', 'sync_link_node_label',
                        'sync_link_doc_title', 'assert_project_role', 'link_project_doc',
                        'unlink_project_doc', 'create_linked_milestone')),
  'every new function pins search_path'
);
select ok(
  not has_table_privilege('anon', 'public.project_doc_links', 'select')
  and not has_table_privilege('anon', 'public.milestone_external_links', 'select'),
  'anon cannot reach the link tables'
);


-- ----------------------------------------------------------------------------
-- 10. Deleting an account: linked_by and created_by go to null
--
-- Both are `on delete set null`, which Postgres runs as an UPDATE that the
-- frozen-column triggers see. It must pass once the account is gone, and only
-- then.
-- ----------------------------------------------------------------------------

select pg_temp.as_postgres();
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
        'links-leaver@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Leaver","username":"links_leaver"}', now(), now());
insert into public.project_members (project_id, user_id, role)
values ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000006', 'admin');
insert into public.milestones (id, project_id, title, status, order_index)
values ('c1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000001', 'Leaver heading', 'proposed', 9);
insert into public.project_doc_links (id, project_id, doc_id, doc_title, doc_url, linked_by)
values ('e1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000006', 'Leaver plan', 'https://www.doqtri.xyz/d/6',
        'a1000000-0000-4000-8000-000000000006');
insert into public.milestone_external_links (id, milestone_id, project_id, doc_id, node_id, node_label, created_by)
values ('f1000000-0000-4000-8000-000000000006', 'c1000000-0000-4000-8000-000000000006',
        'b1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000006',
        'h0', 'Leaver heading', 'a1000000-0000-4000-8000-000000000006');

-- While the account exists, nulling the pointer is still a rewrite. (A
-- session cannot UPDATE a doc link at all, D-48; the trigger is checked as
-- postgres below.)
select pg_temp.as_session('a1000000-0000-4000-8000-000000000006');
select throws_ok(
  $$ update public.milestone_external_links set created_by = null
      where id = 'f1000000-0000-4000-8000-000000000006' $$,
  '42501', 'Only node_id and doc_version of a milestone link can change.',
  'session member: cannot blank who created a milestone link while that account exists'
);
select pg_temp.as_postgres();
select throws_ok(
  $$ update public.project_doc_links set linked_by = null
      where id = 'e1000000-0000-4000-8000-000000000006' $$,
  '42501', null,
  'a direct database session cannot blank linked_by of a live account either'
);
select throws_ok(
  $$ update public.milestone_external_links set created_by = null
      where id = 'f1000000-0000-4000-8000-000000000006' $$,
  '42501', null,
  'a direct database session cannot blank created_by of a live account either'
);

select lives_ok(
  $$ delete from auth.users where id = 'a1000000-0000-4000-8000-000000000006' $$,
  'deleting the account that linked a doc and created a milestone link succeeds'
);
select is(
  (select row(d.linked_by, d.doc_title, d.doc_url)::text
     from public.project_doc_links d where d.id = 'e1000000-0000-4000-8000-000000000006'),
  row(null::uuid, 'Leaver plan', 'https://www.doqtri.xyz/d/6')::text,
  'the doc link stays, with linked_by null'
);
select is(
  (select row(l.created_by, l.node_id, l.milestone_id)::text
     from public.milestone_external_links l where l.id = 'f1000000-0000-4000-8000-000000000006'),
  row(null::uuid, 'h0', 'c1000000-0000-4000-8000-000000000006'::uuid)::text,
  'the milestone link stays, with created_by null'
);


select * from finish();

rollback;
