-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/oauth_write_guards_revoked.test.sql
--
-- Covers 20261026100000_oauth_write_guards_revoked.sql (D-75): a token its
-- user revoked is refused on every PostgREST write the D-03 guards open to
-- apps, and by the three /api/v1 RPCs, while a token from the re-consent, the
-- same user's own session and another app of the same user keep writing, and
-- reads keep their window. And 20261026120100_oauth_token_revoked_fail_closed.sql
-- (D-96): a token whose client_id is not a UUID counts as revoked on those
-- same writes, while a first-party session still does not.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back. Callers are
-- simulated as in the other files: the JWT's role and claims. As there, a
-- refused INSERT raises while a refused UPDATE or DELETE filters the row out
-- silently, so the latter are checked by reading the row afterwards as
-- postgres.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(36);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- u1 owns P1 and revoked doqtri's client a minute ago.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a4000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'revoked-writes@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Owner","username":"revoked_writes"}', now(), now());

insert into public.projects (id, owner_id, name, slug)
values ('b4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'Revoked writes', 'revoked-writes');

-- M1 is linked to node h1 of D1; M2 is not linked.
insert into public.milestones (id, project_id, title, status, order_index)
values
  ('c4000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001', 'Escrow contract', 'proposed', 0),
  ('c4000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000001', 'Payroll run', 'proposed', 1);

insert into public.project_doc_links (id, project_id, doc_id, doc_title, doc_url, linked_by)
values
  ('e4000000-0000-4000-8000-000000000001', 'b4000000-0000-4000-8000-000000000001',
   'd4000000-0000-4000-8000-000000000001', 'Payroll v1 plan',
   'https://www.doqtri.xyz/d/d4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001'),
  ('e4000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000001',
   'd4000000-0000-4000-8000-000000000002', 'Payroll v2 plan',
   'https://www.doqtri.xyz/d/d4000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000001');

insert into public.milestone_external_links (id, milestone_id, project_id, doc_id, node_id, node_label, doc_version, created_by)
values ('f4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
        'b4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
        'h1', 'Escrow contract', 3, 'a4000000-0000-4000-8000-000000000001');

insert into public.oauth_client_revocations (user_id, client_id, revoked_at)
values ('a4000000-0000-4000-8000-000000000001', '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d', now());


-- ----------------------------------------------------------------------------
-- Caller switches
-- ----------------------------------------------------------------------------

-- p_iat_offset: the token's iat, in seconds from now(). -60 is a token doqtri
-- held when the user revoked; +60 one from the re-consent.
create function pg_temp.as_oauth_client(
  p_iat_offset integer,
  p_client text default '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d'
)
returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', 'a4000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'aud', 'authenticated',
    'client_id', p_client,
    'iat', floor(extract(epoch from now()))::bigint + p_iat_offset
  )::text, true);
$$;

create function pg_temp.as_session() returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', json_build_object(
    'sub', 'a4000000-0000-4000-8000-000000000001',
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

select is(
  (select array_agg(p.tablename || ': ' || p.cmd order by p.tablename, p.cmd)
     from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.permissive = 'RESTRICTIVE'
      and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%oauth_token_revoked()%'),
  array['milestone_external_links: DELETE', 'milestone_external_links: INSERT', 'milestone_external_links: UPDATE',
        'milestones: INSERT', 'milestones: UPDATE', 'project_doc_links: DELETE'],
  'exactly the six guards that open a write to apps check the revoke (D-75)'
);

select ok(
  not has_function_privilege('anon', 'public.oauth_token_revoked()', 'execute'),
  'anon still cannot call oauth_token_revoked()'
);


-- ----------------------------------------------------------------------------
-- 2. A token issued before the revoke: every write refused
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client(-60);
select throws_ok(
  $$ insert into public.milestones (project_id, title, status)
     values ('b4000000-0000-4000-8000-000000000001', 'From a revoked token', 'proposed') $$,
  '42501', null,
  'revoked token: cannot create a proposed milestone over PostgREST'
);

select pg_temp.as_oauth_client(-60);
update public.milestones set title = 'Renamed by a revoked token'
 where id = 'c4000000-0000-4000-8000-000000000001';

select pg_temp.as_oauth_client(-60);
select throws_ok(
  $$ insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label, created_by)
     values ('c4000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000001',
             'd4000000-0000-4000-8000-000000000001', 'h2', 'Payroll run', 'a4000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'revoked token: cannot link a milestone'
);

select pg_temp.as_oauth_client(-60);
update public.milestone_external_links set node_id = 'h7'
 where id = 'f4000000-0000-4000-8000-000000000001';
select pg_temp.as_oauth_client(-60);
delete from public.milestone_external_links where id = 'f4000000-0000-4000-8000-000000000001';
select pg_temp.as_oauth_client(-60);
delete from public.project_doc_links where id = 'e4000000-0000-4000-8000-000000000002';

select pg_temp.as_postgres();
select is((select title from public.milestones where id = 'c4000000-0000-4000-8000-000000000001'),
  'Escrow contract', 'revoked token: the linked milestone''s title did not change');
select is((select node_id from public.milestone_external_links where id = 'f4000000-0000-4000-8000-000000000001'),
  'h1', 'revoked token: the milestone link''s node did not move (row kept, not deleted either)');
select ok(exists (select 1 from public.project_doc_links where id = 'e4000000-0000-4000-8000-000000000002'),
  'revoked token: the doc link was not deleted');

select pg_temp.as_oauth_client(-60);
select throws_ok(
  $$ select public.create_linked_milestone('b4000000-0000-4000-8000-000000000001', 'Payroll run v2', null, null,
                                          'd4000000-0000-4000-8000-000000000001', 'h3', 3) $$,
  '42501', 'This app''s access to qdit was revoked.',
  'revoked token: create_linked_milestone() refuses it over /rest/v1/rpc'
);
select pg_temp.as_oauth_client(-60);
select throws_ok(
  $$ select * from public.link_project_doc('b4000000-0000-4000-8000-000000000001',
                                           'd4000000-0000-4000-8000-000000000003', 'Another plan',
                                           'https://www.doqtri.xyz/d/d4000000-0000-4000-8000-000000000003') $$,
  '42501', 'This app''s access to qdit was revoked.',
  'revoked token: link_project_doc() refuses it'
);
select pg_temp.as_oauth_client(-60);
select throws_ok(
  $$ select * from public.unlink_project_doc('b4000000-0000-4000-8000-000000000001',
                                             'd4000000-0000-4000-8000-000000000002') $$,
  '42501', 'This app''s access to qdit was revoked.',
  'revoked token: unlink_project_doc() refuses it'
);
select pg_temp.as_oauth_client(-60);
select throws_ok(
  $$ select public.create_linked_milestone('b4000000-0000-4000-8000-00000000ffff', 'Elsewhere', null, null,
                                          'd4000000-0000-4000-8000-000000000001', 'h3', 3) $$,
  '42501', 'This app''s access to qdit was revoked.',
  '... before the role check, so it learns nothing about another project'
);

-- Reads keep the window the contract states (section 5).
select pg_temp.as_oauth_client(-60);
select is((select count(*)::int from public.milestones where project_id = 'b4000000-0000-4000-8000-000000000001'), 2,
  'revoked token: still reads milestones until exp');
select pg_temp.as_oauth_client(-60);
select is((select count(*)::int from public.projects where id = 'b4000000-0000-4000-8000-000000000001'), 1,
  '... and the project');
select pg_temp.as_oauth_client(-60);
select is((select count(*)::int from public.milestone_external_links), 1,
  '... and the milestone links');


-- ----------------------------------------------------------------------------
-- 3. Another app of the same user: not revoked, unaffected
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client(-60, '22222222-2222-4222-8222-222222222222');
select lives_ok(
  $$ insert into public.milestones (id, project_id, title, status)
     values ('c4000000-0000-4000-8000-000000000010', 'b4000000-0000-4000-8000-000000000001', 'Other app', 'proposed') $$,
  'another client of the same user still creates milestones'
);


-- ----------------------------------------------------------------------------
-- 4. A token from the re-consent: every write allowed again
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client(60);
select lives_ok(
  $$ insert into public.milestones (id, project_id, title, status)
     values ('c4000000-0000-4000-8000-000000000003', 'b4000000-0000-4000-8000-000000000001', 'After re-consent', 'proposed') $$,
  're-consent token: creates a proposed milestone'
);

select pg_temp.as_oauth_client(60);
update public.milestones set title = 'Escrow contract v2'
 where id = 'c4000000-0000-4000-8000-000000000001';
select pg_temp.as_postgres();
select is((select title from public.milestones where id = 'c4000000-0000-4000-8000-000000000001'),
  'Escrow contract v2', 're-consent token: renames the linked milestone (D-12)');

select pg_temp.as_oauth_client(60);
select lives_ok(
  $$ insert into public.milestone_external_links (id, milestone_id, project_id, doc_id, node_id, node_label, created_by)
     values ('f4000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000002',
             'b4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
             'h2', 'Payroll run', 'a4000000-0000-4000-8000-000000000001') $$,
  're-consent token: links a milestone'
);

select pg_temp.as_oauth_client(60);
update public.milestone_external_links set node_id = 'h7'
 where id = 'f4000000-0000-4000-8000-000000000001';
select pg_temp.as_postgres();
select is((select node_id from public.milestone_external_links where id = 'f4000000-0000-4000-8000-000000000001'),
  'h7', 're-consent token: moves a milestone link (D-21)');

select pg_temp.as_oauth_client(60);
delete from public.milestone_external_links where id = 'f4000000-0000-4000-8000-000000000002';
select pg_temp.as_postgres();
select ok(not exists (select 1 from public.milestone_external_links where id = 'f4000000-0000-4000-8000-000000000002'),
  're-consent token: deletes a milestone link');

select pg_temp.as_oauth_client(60);
select isnt(
  public.create_linked_milestone('b4000000-0000-4000-8000-000000000001', 'Payroll run v2', null, null,
                                 'd4000000-0000-4000-8000-000000000001', 'h3', 3),
  null,
  're-consent token: create_linked_milestone() works'
);
select pg_temp.as_oauth_client(60);
select is(
  (select created from public.link_project_doc('b4000000-0000-4000-8000-000000000001',
                                               'd4000000-0000-4000-8000-000000000003', 'Another plan',
                                               'https://www.doqtri.xyz/d/d4000000-0000-4000-8000-000000000003')),
  true,
  're-consent token: link_project_doc() works'
);

select pg_temp.as_oauth_client(60);
delete from public.project_doc_links where id = 'e4000000-0000-4000-8000-000000000002';
select pg_temp.as_postgres();
select ok(not exists (select 1 from public.project_doc_links where id = 'e4000000-0000-4000-8000-000000000002'),
  're-consent token: deletes a doc link');


-- ----------------------------------------------------------------------------
-- 5. The user's own session: never a revoked token
-- ----------------------------------------------------------------------------

select pg_temp.as_session();
select is(public.oauth_token_revoked(), false, 'a first-party session is not revoked, with a revoke on record');

select pg_temp.as_session();
select lives_ok(
  $$ insert into public.milestones (id, project_id, title, status)
     values ('c4000000-0000-4000-8000-000000000004', 'b4000000-0000-4000-8000-000000000001', 'From the session', 'submitted') $$,
  'session: creates a milestone in any status, as before'
);

select pg_temp.as_session();
update public.milestones set status = 'approved'
 where id = 'c4000000-0000-4000-8000-000000000004';
select pg_temp.as_postgres();
select is((select status::text from public.milestones where id = 'c4000000-0000-4000-8000-000000000004'),
  'approved', 'session: changes a milestone''s status');

select pg_temp.as_session();
select lives_ok(
  $$ insert into public.milestone_external_links (id, milestone_id, project_id, doc_id, node_id, node_label, created_by)
     values ('f4000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000004',
             'b4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
             'h4', 'From the session', 'a4000000-0000-4000-8000-000000000001') $$,
  'session: links a milestone'
);

select pg_temp.as_session();
delete from public.milestone_external_links where id = 'f4000000-0000-4000-8000-000000000004';
select pg_temp.as_session();
delete from public.project_doc_links where id = 'e4000000-0000-4000-8000-000000000001';
select pg_temp.as_postgres();
select ok(
  not exists (select 1 from public.milestone_external_links where id = 'f4000000-0000-4000-8000-000000000004')
  and not exists (select 1 from public.project_doc_links where id = 'e4000000-0000-4000-8000-000000000001'),
  'session: deletes a milestone link and a doc link'
);

select pg_temp.as_session();
select throws_ok(
  $$ select public.create_linked_milestone('b4000000-0000-4000-8000-00000000ffff', 'Elsewhere', null, null,
                                          'd4000000-0000-4000-8000-000000000001', 'h3', 3) $$,
  'P0002', null,
  'session: assert_project_role() still answers not found for another project'
);


-- ----------------------------------------------------------------------------
-- 6. A client_id that is not a UUID: revoked, fail closed (D-96)
--
-- No revoke can ever name it (the table keys on a uuid), so it is refused on
-- every write the guards open to apps, whatever its iat. The token below is
-- from after the user's revoke, so only the shape refuses it.
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client(60, 'doqtri-app');
select is(public.oauth_token_revoked(), true, 'non-UUID client_id: counts as revoked');

select pg_temp.as_oauth_client(60, 'doqtri-app');
select throws_ok(
  $$ insert into public.milestones (project_id, title, status)
     values ('b4000000-0000-4000-8000-000000000001', 'From a non-UUID client', 'proposed') $$,
  '42501', null,
  'non-UUID client_id: cannot create a proposed milestone over PostgREST'
);

select pg_temp.as_oauth_client(60, 'doqtri-app');
update public.milestones set title = 'Renamed by a non-UUID client'
 where id = 'c4000000-0000-4000-8000-000000000001';
select pg_temp.as_postgres();
select is((select title from public.milestones where id = 'c4000000-0000-4000-8000-000000000001'),
  'Escrow contract v2', 'non-UUID client_id: the linked milestone''s title did not change');

select pg_temp.as_oauth_client(60, 'doqtri-app');
select throws_ok(
  $$ insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label, created_by)
     values ('c4000000-0000-4000-8000-000000000010', 'b4000000-0000-4000-8000-000000000001',
             'd4000000-0000-4000-8000-000000000001', 'h9', 'Other app', 'a4000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'non-UUID client_id: cannot link a milestone'
);

select pg_temp.as_oauth_client(60, 'doqtri-app');
select throws_ok(
  $$ select * from public.link_project_doc('b4000000-0000-4000-8000-000000000001',
                                           'd4000000-0000-4000-8000-000000000004', 'Non-UUID plan',
                                           'https://www.doqtri.xyz/d/d4000000-0000-4000-8000-000000000004') $$,
  '42501', 'This app''s access to qdit was revoked.',
  'non-UUID client_id: link_project_doc() refuses it'
);

select pg_temp.as_oauth_client(60, 'doqtri-app');
select throws_ok(
  $$ select public.create_linked_milestone('b4000000-0000-4000-8000-000000000001', 'Non-UUID milestone', null, null,
                                          'd4000000-0000-4000-8000-000000000001', 'h8', 3) $$,
  '42501', 'This app''s access to qdit was revoked.',
  'non-UUID client_id: create_linked_milestone() refuses it'
);

-- A first-party session has no client_id at all, so D-96 never touches it.
select pg_temp.as_session();
select lives_ok(
  $$ insert into public.milestones (id, project_id, title, status)
     values ('c4000000-0000-4000-8000-000000000005', 'b4000000-0000-4000-8000-000000000001', 'Session after D-96', 'proposed') $$,
  'session: still creates a milestone after D-96'
);


select * from finish();
rollback;
