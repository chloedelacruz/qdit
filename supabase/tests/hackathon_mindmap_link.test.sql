-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/hackathon_mindmap_link.test.sql
--
-- Covers 20261112140000_hackathon_mindmap_link.sql (QDIT-66, WP-4.7): which
-- links hackathon_mindmap_url_ok() and hackathon_mindmap_url_allowed()
-- accept, with integration_settings.doqtri_origin unset and set; the two
-- columns, their checks and grants; push_doqtri_hackathon_snapshot() storing
-- the payload's mindmap_url (left out, null, valid, refused, replay and
-- conflict unchanged); submit_hackathon_entry() taking, refusing and storing
-- p_mindmap_url; and the version keeping its link once the snapshot is gone.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(64);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- u1 owner of P1, u2 admin, u3 member, u4 viewer.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('a6600000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated',
       'mm-' || n || '@qdit.test',
       '{"provider":"email","providers":["email"]}',
       jsonb_build_object('full_name', 'Mm ' || n, 'username', 'mm_u' || n),
       now(), now()
  from generate_series(1, 4) as n;

insert into public.projects (id, owner_id, name, slug)
values ('b6600000-0000-4000-8000-000000000001', 'a6600000-0000-4000-8000-000000000001', 'Mm one', 'mm-one');

insert into public.project_members (project_id, user_id, role)
values
  ('b6600000-0000-4000-8000-000000000001', 'a6600000-0000-4000-8000-000000000002', 'admin'),
  ('b6600000-0000-4000-8000-000000000001', 'a6600000-0000-4000-8000-000000000003', 'member'),
  ('b6600000-0000-4000-8000-000000000001', 'a6600000-0000-4000-8000-000000000004', 'viewer');

insert into public.hackathons (id, slug, name, opens_at, closes_at, finalist_count)
values ('c6600000-0000-4000-8000-000000000001', 'mm-main', 'Mm main', now() - interval '1 hour', now() + interval '1 hour', 10);

insert into storage.objects (bucket_id, name, owner)
values ('hackathon-mindmaps',
        'c6600000-0000-4000-8000-000000000001/b6600000-0000-4000-8000-000000000001/d6600000-0000-4000-8000-000000000001.png',
        'a6600000-0000-4000-8000-000000000001');

update public.integration_settings
   set doqtri_oauth_client_id = '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
       doqtri_origin = null;


-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

create function pg_temp.as_oauth_client(p_user uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aud', 'authenticated',
    'client_id', '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
    'iat', floor(extract(epoch from now()))::bigint - 60
  )::text, true);
$$;

create function pg_temp.as_session(p_user uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'aud', 'authenticated'
  )::text, true);
$$;

create function pg_temp.as_postgres() returns void
language sql as $$
  select set_config('role', 'postgres', true);
  select set_config('request.jwt.claims', '', true);
$$;

-- A 22-character token, the shortest doqtri may send.
create function pg_temp.tok() returns text
language sql as $$ select 'Ab3_-xYz0123456789AbCd'::text $$;

-- A push of P1 to mm-main with this payload; the hash stands in for the
-- route's SHA-256 of the raw bytes.
create function pg_temp.push(p_snapshot int, p_payload jsonb, p_hash text default null) returns jsonb
language sql as $$
  select public.push_doqtri_hackathon_snapshot('mm-main', 'b6600000-0000-4000-8000-000000000001',
    ('e6600000-0000-4000-8000-00000000000' || p_snapshot)::uuid, 'e6610000-0000-4000-8000-000000000001',
    p_payload, coalesce(p_hash, md5(p_payload::text) || md5(p_payload::text)), 0);
$$;

-- SQLSTATE and HINT of a statement, or 'ok'.
create function pg_temp.err(p_sql text) returns text
language plpgsql as $$
declare
  v_state text;
  v_hint  text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || ':' || coalesce(v_hint, '');
end;
$$;

-- A submit of P1 by u1 with this mindmap argument.
create function pg_temp.submit(p_mindmap text) returns uuid
language sql as $$
  select public.submit_hackathon_entry(
    'c6600000-0000-4000-8000-000000000001', 'b6600000-0000-4000-8000-000000000001', 'Team Mm',
    array['a6600000-0000-4000-8000-000000000001', 'a6600000-0000-4000-8000-000000000002',
          'a6600000-0000-4000-8000-000000000003']::uuid[],
    array['c6600000-0000-4000-8000-000000000001/b6600000-0000-4000-8000-000000000001/d6600000-0000-4000-8000-000000000001.png'],
    'https://docs.google.com/presentation/d/1mmDeck/edit',
    p_mindmap);
$$;

create function pg_temp.snapshots() returns bigint
language sql security definer as $$ select count(*) from public.hackathon_doqtri_snapshots $$;

create function pg_temp.versions() returns bigint
language sql security definer as $$ select count(*) from public.hackathon_submission_versions $$;

grant execute on all functions in schema pg_temp to authenticated;


-- ----------------------------------------------------------------------------
-- 1. The shape
-- ----------------------------------------------------------------------------

select ok(public.hackathon_mindmap_url_ok('https://www.doqtri.xyz/m/' || pg_temp.tok()), 'a 22-character token');
select ok(public.hackathon_mindmap_url_ok('https://www.doqtri.xyz/m/' || repeat('a', 64)), 'a 64-character token');
select ok(public.hackathon_mindmap_url_ok('https://localhost:3000/m/' || pg_temp.tok()), 'a host with a port (local doqtri)');

select ok(not public.hackathon_mindmap_url_ok(null), 'null');
select ok(not public.hackathon_mindmap_url_ok(''), 'empty');
select ok(not public.hackathon_mindmap_url_ok('http://www.doqtri.xyz/m/' || pg_temp.tok()), 'plain http');
select ok(not public.hackathon_mindmap_url_ok('https://www.doqtri.xyz/m/' || repeat('a', 21)), 'a 21-character token');
select ok(not public.hackathon_mindmap_url_ok('https://www.doqtri.xyz/m/' || repeat('a', 65)), 'a 65-character token');
select ok(not public.hackathon_mindmap_url_ok('https://www.doqtri.xyz/m/' || repeat('a', 21) || '.'), 'a character outside [A-Za-z0-9_-]');
select ok(not public.hackathon_mindmap_url_ok('https://www.doqtri.xyz/d/' || pg_temp.tok()), 'another path (a doc page)');
select ok(not public.hackathon_mindmap_url_ok('https://www.doqtri.xyz/m/' || pg_temp.tok() || '/'), 'a trailing slash');
select ok(not public.hackathon_mindmap_url_ok('https://www.doqtri.xyz/m/' || pg_temp.tok() || '?x=1'), 'a query');
select ok(not public.hackathon_mindmap_url_ok('https://www.doqtri.xyz/m/' || pg_temp.tok() || '#x'), 'a fragment');
select ok(not public.hackathon_mindmap_url_ok('https://WWW.doqtri.xyz/m/' || pg_temp.tok()), 'an upper-case host');
select ok(not public.hackathon_mindmap_url_ok('https://x@www.doqtri.xyz/m/' || pg_temp.tok()), 'userinfo');
select ok(not public.hackathon_mindmap_url_ok(' https://www.doqtri.xyz/m/' || pg_temp.tok()), 'leading whitespace');


-- ----------------------------------------------------------------------------
-- 2. The origin
-- ----------------------------------------------------------------------------

select ok(public.hackathon_mindmap_url_allowed('https://other.example/m/' || pg_temp.tok()),
  'doqtri_origin unset: any host of the right shape');
select ok(not public.hackathon_mindmap_url_allowed('https://other.example/m/short'),
  'doqtri_origin unset: the shape still applies');

update public.integration_settings set doqtri_origin = 'https://www.doqtri.xyz';

select ok(public.hackathon_mindmap_url_allowed('https://www.doqtri.xyz/m/' || pg_temp.tok()),
  'doqtri_origin set: a link on it');
select ok(not public.hackathon_mindmap_url_allowed('https://other.example/m/' || pg_temp.tok()),
  'doqtri_origin set: another host');
select ok(not public.hackathon_mindmap_url_allowed('https://www.doqtri.xyz.evil.example/m/' || pg_temp.tok()),
  'doqtri_origin set: a look-alike host');
select ok(not public.hackathon_mindmap_url_allowed('https://www.doqtri.xyz:443/m/' || pg_temp.tok()),
  'doqtri_origin set: the origin with an explicit port');
select ok(not public.hackathon_mindmap_url_allowed('https://doqtri.xyz/m/' || pg_temp.tok()),
  'doqtri_origin set: another of doqtri''s hosts');


-- ----------------------------------------------------------------------------
-- 3. Columns, checks, grants, signatures
-- ----------------------------------------------------------------------------

select col_is_null('public', 'hackathon_doqtri_snapshots', 'mindmap_url', 'snapshots: mindmap_url is nullable');
select col_is_null('public', 'hackathon_submission_versions', 'mindmap_url', 'versions: mindmap_url is nullable');

select ok(
  (select count(*) = 2 from pg_catalog.pg_constraint
    where contype = 'c'
      and conname in ('hackathon_doqtri_snapshots_mindmap_url_check', 'hackathon_submission_versions_mindmap_url_check')),
  'both columns carry the hackathon_mindmap_url_ok check'
);

select ok(
  has_column_privilege('authenticated', 'public.hackathon_submission_versions', 'mindmap_url', 'select')
  and has_column_privilege('authenticated', 'public.hackathon_doqtri_snapshots', 'mindmap_url', 'select')
  and not has_column_privilege('anon', 'public.hackathon_submission_versions', 'mindmap_url', 'select')
  and not has_column_privilege('anon', 'public.hackathon_doqtri_snapshots', 'mindmap_url', 'select'),
  'authenticated may select both columns (under the row policies); anon may not'
);

select ok(
  not has_function_privilege('authenticated', 'public.hackathon_mindmap_url_ok(text)', 'execute')
  and not has_function_privilege('anon', 'public.hackathon_mindmap_url_ok(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.hackathon_mindmap_url_allowed(text)', 'execute')
  and not has_function_privilege('anon', 'public.hackathon_mindmap_url_allowed(text)', 'execute'),
  'the two validators are internal'
);

select ok(
  (select p.prosecdef
          and p.proconfig = array['search_path=""']
          and not has_function_privilege('anon', p.oid, 'execute')
          and has_function_privilege('authenticated', p.oid, 'execute')
     from pg_catalog.pg_proc p
    where p.oid = 'public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[], text, text)'::regprocedure),
  'submit_hackathon_entry(…, p_slides_url, p_mindmap_url): security definer, empty search_path, authenticated only'
);

select results_eq(
  $$ select pg_catalog.pg_get_function_identity_arguments(p.oid)::text
       from pg_catalog.pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = 'push_doqtri_hackathon_snapshot' $$,
  $$ values ('p_hackathon_slug text, p_project_id uuid, p_snapshot_id uuid, p_workspace_id uuid, p_payload jsonb, p_payload_sha256 text, p_note_count integer'::text) $$,
  'push_doqtri_hackathon_snapshot keeps its one seven-argument form'
);

select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
          and not has_function_privilege('anon', p.oid, 'execute')
          and has_function_privilege('authenticated', p.oid, 'execute')
     from pg_catalog.pg_proc p
    where p.oid = 'public.push_doqtri_hackathon_snapshot(text, uuid, uuid, uuid, jsonb, text, integer)'::regprocedure),
  'push_doqtri_hackathon_snapshot: security definer, empty search_path, authenticated only'
);


-- ----------------------------------------------------------------------------
-- 4. doqtri's push (doqtri_origin set to https://www.doqtri.xyz above)
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a6600000-0000-4000-8000-000000000001');

select is(pg_temp.push(1, '{"notes": []}') ->> 'replay', 'false', 'push: a body without mindmap_url is stored');
select is(pg_temp.push(2, '{"notes": [], "mindmap_url": null}') ->> 'replay', 'false', 'push: mindmap_url null is stored');
select is(
  pg_temp.push(3, jsonb_build_object('notes', '[]'::jsonb, 'mindmap_url', 'https://www.doqtri.xyz/m/' || pg_temp.tok())) ->> 'replay',
  'false',
  'push: a valid link is stored'
);

select pg_temp.as_postgres();

select results_eq(
  $$ select snapshot_id::text, mindmap_url from public.hackathon_doqtri_snapshots order by snapshot_id $$,
  $$ values ('e6600000-0000-4000-8000-000000000001', null::text),
            ('e6600000-0000-4000-8000-000000000002', null::text),
            ('e6600000-0000-4000-8000-000000000003', 'https://www.doqtri.xyz/m/' || pg_temp.tok()) $$,
  'push: left out and null store no link; the valid link lands in the column'
);

select pg_temp.as_oauth_client('a6600000-0000-4000-8000-000000000001');

select is(
  pg_temp.err($$ select pg_temp.push(4, jsonb_build_object('notes', '[]'::jsonb, 'mindmap_url', 'http://www.doqtri.xyz/m/' || pg_temp.tok())) $$),
  '22023:mindmap_url', 'push: http is refused on mindmap_url');
select is(
  pg_temp.err($$ select pg_temp.push(4, jsonb_build_object('notes', '[]'::jsonb, 'mindmap_url', 'https://other.example/m/' || pg_temp.tok())) $$),
  '22023:mindmap_url', 'push: another host is refused on mindmap_url');
select is(
  pg_temp.err($$ select pg_temp.push(4, jsonb_build_object('notes', '[]'::jsonb, 'mindmap_url', 'https://www.doqtri.xyz/d/' || pg_temp.tok())) $$),
  '22023:mindmap_url', 'push: a wrong path is refused on mindmap_url');
select is(
  pg_temp.err($$ select pg_temp.push(4, jsonb_build_object('notes', '[]'::jsonb, 'mindmap_url', 'https://www.doqtri.xyz/m/short')) $$),
  '22023:mindmap_url', 'push: a bad token is refused on mindmap_url');
select is(
  pg_temp.err($$ select pg_temp.push(4, '{"notes": [], "mindmap_url": 42}') $$),
  '22023:mindmap_url', 'push: a number is refused on mindmap_url');
select is(
  pg_temp.err($$ select pg_temp.push(4, '{"notes": [], "mindmap_url": ""}') $$),
  '22023:mindmap_url', 'push: an empty string is refused on mindmap_url');

select is(pg_temp.snapshots(), 3::bigint, 'push: nothing was stored for any refused link');

-- Idempotency is unchanged: the same bytes replay, another link under the
-- same snapshot_id is another body.
select is(
  pg_temp.push(3, jsonb_build_object('notes', '[]'::jsonb, 'mindmap_url', 'https://www.doqtri.xyz/m/' || pg_temp.tok())) ->> 'replay',
  'true',
  'push: the same snapshot_id and bytes replay'
);

select throws_ok(
  format($$ select pg_temp.push(3, %L::jsonb) $$,
         jsonb_build_object('notes', '[]'::jsonb, 'mindmap_url', 'https://www.doqtri.xyz/m/' || repeat('Z', 30))),
  'QD409', 'snapshot_conflict',
  'push: the same snapshot_id with another link is snapshot_conflict'
);

select throws_ok(
  $$ select pg_temp.push(3, '{"notes": []}') $$,
  'QD409', 'snapshot_conflict',
  'push: the same snapshot_id with the link left out is snapshot_conflict'
);

select is(pg_temp.snapshots(), 3::bigint, 'push: a replay or conflict stores nothing');


-- ----------------------------------------------------------------------------
-- 5. submit_hackathon_entry
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a6600000-0000-4000-8000-000000000001');

select ok(set_config('mm.v1', pg_temp.submit(null)::text, true) is not null,
  'submit: no link is accepted (the field is optional)');

select is(
  (select v.mindmap_url from public.hackathon_submission_versions v where v.id = current_setting('mm.v1')::uuid),
  null,
  'submit: no link stores null; the database never copies a snapshot''s link'
);

select ok(
  (select v.doqtri_snapshot_id is not null from public.hackathon_submission_versions v where v.id = current_setting('mm.v1')::uuid),
  'submit: the newest snapshot is still frozen into the version'
);

select ok(set_config('mm.v2', pg_temp.submit('   ')::text, true) is not null, 'submit: a blank link is accepted');
select is(
  (select v.mindmap_url from public.hackathon_submission_versions v where v.id = current_setting('mm.v2')::uuid),
  null,
  'submit: a blank link is no link'
);

select ok(set_config('mm.v3', pg_temp.submit('  https://www.doqtri.xyz/m/' || pg_temp.tok() || ' ')::text, true) is not null,
  'submit: a valid link is accepted');
select is(
  (select v.mindmap_url from public.hackathon_submission_versions v where v.id = current_setting('mm.v3')::uuid),
  'https://www.doqtri.xyz/m/' || pg_temp.tok(),
  'submit: a valid link is stored trimmed'
);

select is(pg_temp.err($$ select pg_temp.submit('http://www.doqtri.xyz/m/' || pg_temp.tok()) $$),
  '22023:mindmap_url', 'submit: http is 22023, hint mindmap_url');
select is(pg_temp.err($$ select pg_temp.submit('https://other.example/m/' || pg_temp.tok()) $$),
  '22023:mindmap_url', 'submit: another host is 22023, hint mindmap_url');
select is(pg_temp.err($$ select pg_temp.submit('https://www.doqtri.xyz/m/' || pg_temp.tok() || '?x') $$),
  '22023:mindmap_url', 'submit: anything after the token is 22023, hint mindmap_url');
select is(pg_temp.err($$ select pg_temp.submit('https://www.doqtri.xyz/m/tooshort') $$),
  '22023:mindmap_url', 'submit: a bad token is 22023, hint mindmap_url');

select is(pg_temp.versions(), 3::bigint, 'submit: a refused link adds no version');

-- The Slides link is checked first: with both wrong, the Slides refusal wins.
select is(
  pg_temp.err($$ select public.submit_hackathon_entry(
    'c6600000-0000-4000-8000-000000000001', 'b6600000-0000-4000-8000-000000000001', 'Team Mm',
    array['a6600000-0000-4000-8000-000000000001', 'a6600000-0000-4000-8000-000000000002',
          'a6600000-0000-4000-8000-000000000003']::uuid[],
    array['c6600000-0000-4000-8000-000000000001/b6600000-0000-4000-8000-000000000001/d6600000-0000-4000-8000-000000000001.png'],
    'https://example.com/deck', 'nope') $$),
  '22023:slides_url',
  'submit: the mindmap link is checked after the Slides link'
);

-- The old app's call, six named arguments, still resolves.
select ok(
  public.submit_hackathon_entry(
    p_hackathon_id => 'c6600000-0000-4000-8000-000000000001', p_project_id => 'b6600000-0000-4000-8000-000000000001',
    p_team_name => 'Team Mm',
    p_member_ids => array['a6600000-0000-4000-8000-000000000001', 'a6600000-0000-4000-8000-000000000002',
                          'a6600000-0000-4000-8000-000000000003']::uuid[],
    p_image_paths => array['c6600000-0000-4000-8000-000000000001/b6600000-0000-4000-8000-000000000001/d6600000-0000-4000-8000-000000000001.png'],
    p_slides_url => 'https://docs.google.com/presentation/d/1mmDeck/edit') is not null,
  'submit: a call without p_mindmap_url (the app before QDIT-66) still works'
);

select pg_temp.as_session('a6600000-0000-4000-8000-000000000003');
select is(
  (select v.mindmap_url from public.hackathon_submission_versions v where v.id = current_setting('mm.v3')::uuid),
  'https://www.doqtri.xyz/m/' || pg_temp.tok(),
  'a project member (not admin) reads the version''s link'
);


-- ----------------------------------------------------------------------------
-- 6. The link outlives the snapshot (retention)
-- ----------------------------------------------------------------------------

select pg_temp.as_postgres();

delete from public.hackathon_doqtri_snapshots;

select results_eq(
  format($$ select doqtri_snapshot_id is null, mindmap_url from public.hackathon_submission_versions where id = %L $$,
         current_setting('mm.v3')),
  $$ values (true, 'https://www.doqtri.xyz/m/' || pg_temp.tok()) $$,
  'with the snapshot pruned, the version keeps its link'
);

select throws_ok(
  format($$ update public.hackathon_submission_versions set mindmap_url = null where id = %L $$, current_setting('mm.v3')),
  '42501', null,
  'the version''s link is frozen like the rest of the version'
);

select throws_ok(
  $$ insert into public.hackathon_doqtri_snapshots
       (snapshot_id, hackathon_id, project_id, workspace_id, client_id, payload, payload_sha256, note_count, mindmap_url)
     values ('e6600000-0000-4000-8000-000000000009', 'c6600000-0000-4000-8000-000000000001',
             'b6600000-0000-4000-8000-000000000001', 'e6610000-0000-4000-8000-000000000001',
             '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d', '{}', repeat('a', 64), 0, 'https://www.doqtri.xyz/m/bad') $$,
  '23514', null,
  'the snapshot column''s check refuses a malformed link, whoever writes it'
);


select * from finish();

rollback;
