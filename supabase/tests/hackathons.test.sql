-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/hackathons.test.sql
--
-- Covers 20261110100000_hackathons.sql (WP-4.7; D-115, D-116, D-117, D-119):
-- who reads what (anon, strangers, team members, judges, admins, OAuth apps),
-- the mindmap bucket's policies, submit and resubmit (window, late pass, team
-- rules, image paths, the frozen snapshot, job supersession), doqtri's push
-- (client, revoke, replay, conflict, cap, window), the grading queue (cap of
-- 20, leases, retries, third run, regrade), sealed grades (status without
-- scores, leaderboard only after release, release rules and finalist order),
-- judging, staff management and retention.
--
-- Run with `supabase test db` against a local stack. Everything happens
-- inside one transaction that is rolled back. Callers are simulated as in
-- doc_link_connections.test.sql: the JWT's role and claims.
--
-- now() is the transaction's start for the whole file, so time is moved by
-- editing the hackathon rows as postgres (the operator's own edit), and the
-- two submission times the tie-break needs are set as postgres with the
-- frozen-row trigger switched off for that one statement.
--
-- What pgTAP cannot show from one session: FOR UPDATE SKIP LOCKED against
-- another worker's lock, and two pushes with one key racing (the
-- `on conflict do nothing` loser path). Both are single statements in the
-- migration; see its comments.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(257);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- u01..u18 builders, u09 a stranger in no project, u21 a judge, u22 and u23
-- hackathon admins (u23 added later by username).
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('a7000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'authenticated', 'authenticated',
       'hk-' || n || '@qdit.test',
       '{"provider":"email","providers":["email"]}',
       jsonb_build_object('full_name', 'Hk ' || n, 'username', 'hk_u' || lpad(n::text, 2, '0')),
       now(), now()
  from generate_series(1, 26) as n;

-- P1 (u01 owner; u02 admin, u03 member, u04 viewer, u05 member),
-- P2 (u06; u07, u08, and u05 again), P3 (u10; u11, u12), P4 (u13; u14, u15),
-- P5 (u16; u17, u18).
insert into public.projects (id, owner_id, name, slug)
values
  ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'Hk one',   'hk-one'),
  ('b7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000006', 'Hk two',   'hk-two'),
  ('b7000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000010', 'Hk three', 'hk-three'),
  ('b7000000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000013', 'Hk four',  'hk-four'),
  ('b7000000-0000-4000-8000-000000000005', 'a7000000-0000-4000-8000-000000000016', 'Hk five',  'hk-five');

insert into public.project_members (project_id, user_id, role)
values
  ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'admin'),
  ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003', 'member'),
  ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 'viewer'),
  ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000005', 'member'),
  ('b7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000007', 'member'),
  ('b7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000008', 'member'),
  ('b7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000005', 'member'),
  ('b7000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000011', 'member'),
  ('b7000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-000000000012', 'member'),
  ('b7000000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000014', 'member'),
  ('b7000000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000015', 'member'),
  ('b7000000-0000-4000-8000-000000000005', 'a7000000-0000-4000-8000-000000000017', 'member'),
  ('b7000000-0000-4000-8000-000000000005', 'a7000000-0000-4000-8000-000000000018', 'member'),
  -- The judge u21 is also in P5, for the staff/team separation (member_is_staff).
  ('b7000000-0000-4000-8000-000000000005', 'a7000000-0000-4000-8000-000000000021', 'viewer');

-- P1's board: a milestone, two tasks (one with an over-long description), and
-- one row in every other table the snapshot copies.
-- The milestone's description is 5,000 emoji (4 bytes each): clipped by
-- characters, not bytes.
insert into public.milestones (id, project_id, title, description, status)
values ('f7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'Escrow contract',
        repeat(U&'\+01F600', 5000), 'submitted');

insert into public.tasks (id, project_id, milestone_id, title, description, assignee_id, priority, due_date, status, created_at)
values
  ('f7100000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001',
   'Write tests', repeat('x', 5000), 'a7000000-0000-4000-8000-000000000002', 'high', '2026-11-20', 'in_progress', now() - interval '2 minutes'),
  ('f7100000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000001', null,
   'Ship it', 'short', 'a7000000-0000-4000-8000-000000000003', 'low', null, 'todo', now() - interval '1 minute');

insert into public.milestone_reviews (milestone_id, project_id, from_status, to_status, reason, reviewer_id)
values ('f7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
        'proposed', 'submitted', null, 'a7000000-0000-4000-8000-000000000001');

insert into public.milestone_anchors (milestone_id, project_id, action, proof_hash, version, contract_id, tx_hash, signer_address, created_by)
values ('f7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'submit',
        repeat('c', 64), 1, 'CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG', repeat('e', 64),
        'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', 'a7000000-0000-4000-8000-000000000001');

insert into public.stellar_proofs (project_id, milestone_id, proof_url, created_by)
values ('b7000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001',
        'https://example.com/proof', 'a7000000-0000-4000-8000-000000000001');

insert into public.deployments (project_id, status, network, deployed_by)
values ('b7000000-0000-4000-8000-000000000001', 'testnet', 'testnet', 'a7000000-0000-4000-8000-000000000001');

insert into public.project_doc_links (project_id, doc_id, doc_title, doc_url, linked_by)
values ('b7000000-0000-4000-8000-000000000001', 'f7200000-0000-4000-8000-000000000001', 'Plan',
        'https://doqtri.test/d/plan', 'a7000000-0000-4000-8000-000000000001');

insert into public.milestone_external_links (milestone_id, project_id, doc_id, node_id, node_label, doc_version, created_by)
values ('f7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
        'f7200000-0000-4000-8000-000000000001', 'h0', 'Escrow contract', 2, 'a7000000-0000-4000-8000-000000000001');

-- H1 open now (the main event, two finalists), H2 closed an hour ago, H3
-- opening in an hour, H4 closed 100 days ago (retention).
insert into public.hackathons (id, slug, name, opens_at, closes_at, finalist_count)
values
  ('c7000000-0000-4000-8000-000000000001', 'hk-main',   'Main',   now() - interval '1 hour',   now() + interval '1 hour', 2),
  ('c7000000-0000-4000-8000-000000000002', 'hk-closed', 'Closed', now() - interval '3 hours',  now() - interval '1 hour', 10),
  ('c7000000-0000-4000-8000-000000000003', 'hk-future', 'Future', now() + interval '1 hour',   now() + interval '2 hours', 10),
  ('c7000000-0000-4000-8000-000000000004', 'hk-old',    'Old',    now() - interval '101 days', now() - interval '100 days', 10);

-- u22 admin of H1 and H2; u21 judge of H1.
insert into public.hackathon_staff (hackathon_id, user_id, role)
values
  ('c7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000022', 'admin'),
  ('c7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000021', 'judge'),
  ('c7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000022', 'admin');

-- Uploaded mindmaps, as Storage would record them. d7..08 is under P1 but
-- uploaded by the stranger u09, which no submit accepts.
insert into storage.objects (bucket_id, name, owner)
values
  ('hackathon-mindmaps', 'c7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000001/d7000000-0000-4000-8000-000000000001.png', 'a7000000-0000-4000-8000-000000000001'),
  ('hackathon-mindmaps', 'c7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000001/d7000000-0000-4000-8000-000000000002.webp', 'a7000000-0000-4000-8000-000000000002'),
  ('hackathon-mindmaps', 'c7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000002/d7000000-0000-4000-8000-000000000003.png', 'a7000000-0000-4000-8000-000000000006'),
  ('hackathon-mindmaps', 'c7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000003/d7000000-0000-4000-8000-000000000004.png', 'a7000000-0000-4000-8000-000000000010'),
  ('hackathon-mindmaps', 'c7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000004/d7000000-0000-4000-8000-000000000005.png', 'a7000000-0000-4000-8000-000000000013'),
  ('hackathon-mindmaps', 'c7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000005/d7000000-0000-4000-8000-000000000006.png', 'a7000000-0000-4000-8000-000000000016'),
  ('hackathon-mindmaps', 'c7000000-0000-4000-8000-000000000002/b7000000-0000-4000-8000-000000000001/d7000000-0000-4000-8000-000000000007.png', 'a7000000-0000-4000-8000-000000000001'),
  ('hackathon-mindmaps', 'c7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000001/d7000000-0000-4000-8000-000000000008.png', 'a7000000-0000-4000-8000-000000000009');

-- doqtri's OAuth client here (D-61).
update public.integration_settings set doqtri_oauth_client_id = '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d';


-- ----------------------------------------------------------------------------
-- Caller switches and helpers
-- ----------------------------------------------------------------------------

create function pg_temp.as_oauth_client(
  p_user uuid,
  p_client text default '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d',
  p_iat_offset integer default -60
)
returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aud', 'authenticated', 'client_id', p_client,
    'iat', floor(extract(epoch from now()))::bigint + p_iat_offset
  )::text, true);
$$;

create function pg_temp.as_session(p_user uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_user, 'role', 'authenticated', 'aud', 'authenticated'
  )::text, true);
$$;

create function pg_temp.as_anon() returns void
language sql as $$
  select set_config('role', 'anon', true);
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;

create function pg_temp.as_service() returns void
language sql as $$
  select set_config('role', 'service_role', true);
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;

create function pg_temp.as_postgres() returns void
language sql as $$
  select set_config('role', 'postgres', true);
  select set_config('request.jwt.claims', '', true);
$$;

-- The hackathon tables, by name.
create function pg_temp.hk_tables() returns text[]
language sql as $$
  select array['hackathons', 'hackathon_staff', 'hackathon_late_passes', 'hackathon_doqtri_snapshots',
               'hackathon_submissions', 'hackathon_team_members', 'hackathon_submission_versions',
               'hackathon_eligibility_overrides', 'hackathon_grading_jobs', 'hackathon_ai_runs',
               'hackathon_finalists', 'hackathon_finalist_ranks', 'hackathon_judge_scores'];
$$;

-- As the current role: 'table:rows' for each hackathon table that answers
-- with rows, 'table:denied' for each that refuses the read.
create function pg_temp.hk_visible() returns text[]
language plpgsql as $$
declare
  t text;
  n bigint;
  out text[] := '{}';
begin
  foreach t in array pg_temp.hk_tables() loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then out := out || (t || ':' || n); end if;
    exception when insufficient_privilege then
      out := out || (t || ':denied');
    end;
  end loop;
  return out;
end;
$$;

create function pg_temp.keys(p jsonb) returns text[]
language sql as $$
  select array_agg(k order by k) from jsonb_object_keys(p) as k;
$$;

create function pg_temp.img(p_h int, p_p int, p_n int, p_ext text default 'png') returns text
language sql as $$
  select 'c7000000-0000-4000-8000-00000000000' || p_h || '/b7000000-0000-4000-8000-00000000000' || p_p
         || '/d7000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0') || '.' || p_ext;
$$;

-- An entry's submission id, whoever is asking.
create function pg_temp.sub(p_version text) returns uuid
language sql security definer as $$
  select submission_id from public.hackathon_submission_versions where id = current_setting(p_version)::uuid;
$$;

grant execute on all functions in schema pg_temp to anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 1. Shape: RLS, grants, no client write policies
-- ----------------------------------------------------------------------------

select ok(
  (select bool_and(c.relrowsecurity) from pg_catalog.pg_class c
    where c.oid = any (select ('public.' || t)::regclass from unnest(pg_temp.hk_tables()) as t)),
  'RLS is on for every hackathon table'
);

select is_empty(
  $$ select tablename, policyname from pg_catalog.pg_policies
      where schemaname = 'public' and tablename like 'hackathon%'
        and permissive = 'PERMISSIVE' and cmd <> 'SELECT' $$,
  'no permissive INSERT, UPDATE or DELETE policy on any hackathon table: writes go through RPCs'
);

select is_empty(
  $$ select tablename from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename in ('hackathon_ai_runs', 'hackathon_grading_jobs', 'hackathon_finalists',
                          'hackathon_finalist_ranks', 'hackathon_eligibility_overrides')
        and permissive = 'PERMISSIVE' $$,
  'the runs, the queue, finalists, their ranks and overrides have no permissive policy at all (D-116)'
);

select is_empty(
  $$ select c.relname from pg_catalog.pg_attribute a
       join pg_catalog.pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and a.attname = 'ai_rank' and a.attnum > 0
        and (has_table_privilege('authenticated', c.oid, 'select')
             or has_column_privilege('authenticated', c.oid, a.attnum, 'select')) $$,
  'no table authenticated can read has an ai_rank column'
);

select is_empty(
  $$ select i.indexrelid::regclass from pg_catalog.pg_index i
       join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
       join pg_catalog.pg_class c on c.oid = i.indrelid
      where c.relnamespace = 'public'::regnamespace
        and a.attname = 'ai_rank'
        and has_any_column_privilege('authenticated', c.oid, 'select') $$,
  'no index on a client-readable table leads with ai_rank'
);

select is_empty(
  $$ select table_name, grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name like 'hackathon%'
        and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT' $$,
  'anon and authenticated hold no write grant on any hackathon table'
);

select is_empty(
  $$ select table_name, grantee from information_schema.role_table_grants
      where table_schema = 'public' and table_name like 'hackathon%'
        and (grantee = 'anon'
             or (grantee = 'authenticated'
                 and table_name in ('hackathon_ai_runs', 'hackathon_grading_jobs', 'hackathon_finalists',
                                    'hackathon_finalist_ranks', 'hackathon_eligibility_overrides'))) $$,
  'anon holds no grant on any hackathon table; authenticated none on the runs, queue, finalists, ranks and overrides'
);

select is_empty(
  $$ select column_name from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'authenticated'
        and ((table_name = 'hackathon_submission_versions' and column_name = 'eligibility')
             or (table_name = 'hackathon_submissions' and column_name = 'updated_at')) $$,
  'authenticated is granted neither versions.eligibility nor submissions.updated_at'
);

select is_empty(
  $$ select p.proname from pg_catalog.pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and (p.proname like '%hackathon%' or p.proname in (
              'claim_grading_jobs', 'complete_grading_job', 'fail_grading_job', 'enqueue_third_run',
              'set_version_eligibility', 'record_doqtri_chain_check', 'grant_late_pass',
              'set_eligibility_override', 'set_pitch_order', 'upsert_judge_score', 'regrade_submission'))
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon can execute none of the hackathon functions'
);

-- The sweep: every hackathon function, the assert_ helpers and the queue,
-- minus the ones a signed-in user is meant to call.
select is_empty(
  $$ select p.oid::regprocedure from pg_catalog.pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and (p.proname like '%hackathon%'
             or p.proname like 'assert\_%'
             or p.proname in ('claim_grading_jobs', 'complete_grading_job', 'fail_grading_job', 'skip_grading_job',
                              'enqueue_third_run', 'set_version_eligibility', 'record_doqtri_chain_check',
                              'grant_late_pass', 'set_eligibility_override', 'set_pitch_order',
                              'regrade_submission', 'upsert_judge_score'))
        and p.proname not in (
              -- called from policies
              'is_hackathon_staff', 'hackathon_role_rank', 'hackathon_entry_eligible', 'hackathon_clip_text',
              'hackathon_mindmap_path', 'hackathon_mindmap_upload_allowed', 'hackathon_mindmap_read_allowed',
              -- the user RPCs, each checking session and role itself
              'submit_hackathon_entry', 'push_doqtri_hackathon_snapshot', 'hackathon_grading_status',
              'hackathon_leaderboard', 'release_hackathon_grades', 'grant_late_pass', 'set_eligibility_override',
              'set_hackathon_staff', 'hackathon_staff_list', 'set_pitch_order', 'regrade_submission',
              'hackathon_finals_for_judge', 'upsert_judge_score')
        and has_function_privilege('authenticated', p.oid, 'execute') $$,
  'authenticated can execute no hackathon, assert_ or queue function outside the allowlist'
);

select throws_ok(
  $$ insert into public.hackathons (slug, name, opens_at, closes_at, finalist_count)
     values ('hk-eleven', 'Eleven', now(), now() + interval '1 hour', 11) $$,
  '23514', null,
  'finalist_count is at most 10'
);

select ok(
  (select not public and file_size_limit = 5242880
          and allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
     from storage.buckets where id = 'hackathon-mindmaps'),
  'bucket hackathon-mindmaps: private, 5 MB, png/jpeg/webp'
);


-- ----------------------------------------------------------------------------
-- 2. Anonymous callers get nothing
-- ----------------------------------------------------------------------------

select pg_temp.as_anon();

select is(
  pg_temp.hk_visible(),
  array['hackathons:denied', 'hackathon_staff:denied', 'hackathon_late_passes:denied',
        'hackathon_doqtri_snapshots:denied', 'hackathon_submissions:denied',
        'hackathon_team_members:denied', 'hackathon_submission_versions:denied',
        'hackathon_eligibility_overrides:denied', 'hackathon_grading_jobs:denied',
        'hackathon_ai_runs:denied', 'hackathon_finalists:denied', 'hackathon_finalist_ranks:denied',
        'hackathon_judge_scores:denied'],
  'anon: every hackathon table refuses the read'
);

select throws_ok(
  $$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'x', '{}', '{}') $$,
  '42501', null,
  'anon cannot call submit_hackathon_entry'
);

select is(
  (select count(*) from storage.objects where bucket_id = 'hackathon-mindmaps'),
  0::bigint,
  'anon sees no mindmap object'
);


-- ----------------------------------------------------------------------------
-- 3. The mindmap bucket's policies
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a7000000-0000-4000-8000-000000000001');

select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('hackathon-mindmaps', %L, auth.uid()) $$,
         pg_temp.img(1, 1, 51)),
  'the project owner uploads a mindmap while the hackathon is open'
);

select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('hackathon-mindmaps', %L, auth.uid()) $$,
         pg_temp.img(1, 2, 52)),
  '42501', null,
  'not under a project the uploader administers'
);

select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('hackathon-mindmaps', %L, auth.uid()) $$,
         pg_temp.img(2, 1, 53)),
  '42501', null,
  'not while the hackathon is closed for the project'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('hackathon-mindmaps', 'c7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000001/map.png', auth.uid()) $$,
  '42501', null,
  'not with a file name that is not <uuid>.<ext>'
);

select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('hackathon-mindmaps', %L, auth.uid()) $$,
         pg_temp.img(1, 1, 54, 'gif')),
  '42501', null,
  'not with another extension'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000003');

select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('hackathon-mindmaps', %L, auth.uid()) $$,
         pg_temp.img(1, 1, 55)),
  '42501', null,
  'a project member below admin cannot upload'
);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000001');

select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('hackathon-mindmaps', %L, auth.uid()) $$,
         pg_temp.img(1, 1, 56)),
  '42501', null,
  'an OAuth token cannot upload, even for the owner'
);

select is(
  (select count(*) from storage.objects where bucket_id = 'hackathon-mindmaps'),
  0::bigint,
  'an OAuth token sees no mindmap object'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000004');

select is(
  (select count(*) from storage.objects where bucket_id = 'hackathon-mindmaps'
      and name like 'c7000000-0000-4000-8000-000000000001/b7000000-0000-4000-8000-000000000001/%'),
  4::bigint,
  'a viewer of the project reads its mindmaps'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000009');

select is(
  (select count(*) from storage.objects where bucket_id = 'hackathon-mindmaps'),
  0::bigint,
  'a stranger reads no mindmap'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000021');

select is(
  (select count(*) from storage.objects where bucket_id = 'hackathon-mindmaps'
      and name like 'c7000000-0000-4000-8000-000000000001/%'),
  8::bigint,
  'a judge reads every mindmap of the hackathon'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000001');

update storage.objects set name = pg_temp.img(1, 1, 57) where name = pg_temp.img(1, 1, 51);

select pg_temp.as_postgres();

select is(
  (select count(*) from storage.objects where name = pg_temp.img(1, 1, 51)),
  1::bigint,
  'an uploaded mindmap cannot be renamed (no UPDATE policy)'
);


-- ----------------------------------------------------------------------------
-- 4. Submitting: who, when, which team, which images
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a7000000-0000-4000-8000-000000000009');

select is(
  (select count(*) from public.hackathons),
  4::bigint,
  'any signed-in user reads the hackathons'
);

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
            array[%L]) $$, pg_temp.img(1, 1, 1)),
  'P0002', 'No such project.',
  'a stranger cannot submit for a project (not found)'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000003');

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
            array[%L]) $$, pg_temp.img(1, 1, 1)),
  '42501', 'Your role in this project does not allow that.',
  'a project member below admin cannot submit'
);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000001');

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
            array[%L]) $$, pg_temp.img(1, 1, 1)),
  '42501', 'Apps connected through OAuth cannot do this.',
  'an OAuth token cannot submit'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000003', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
            array['x']) $$,
  'QD409', 'hackathon_not_open',
  'refused before opens_at'
);

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
            array[%L]) $$, pg_temp.img(2, 1, 7)),
  'QD409', 'hackathon_closed',
  'refused after closes_at without a late pass'
);

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            '   ', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
            array[%L]) $$, pg_temp.img(1, 1, 1)),
  '22023', null,
  'a blank team name is refused'
);

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002']::uuid[],
            array[%L]) $$, pg_temp.img(1, 1, 1)),
  '22023', 'A team has 3 to 4 members; this one has 2.',
  'a team below team_min is refused'
);

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003',
                          'a7000000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000005']::uuid[],
            array[%L]) $$, pg_temp.img(1, 1, 1)),
  '22023', 'A team has 3 to 4 members; this one has 5.',
  'a team above team_max is refused'
);

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000009']::uuid[],
            array[%L]) $$, pg_temp.img(1, 1, 1)),
  '22023', 'Every team member must be a member of the project.',
  'a team member from outside the project is refused'
);

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
            array[%L]) $$, pg_temp.img(1, 2, 3)),
  '22023', null,
  'an image under another project''s prefix is refused'
);

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
            array[%L]) $$, pg_temp.img(1, 1, 99)),
  '22023', null,
  'an image path with no uploaded object is refused'
);

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
            array[%L]) $$, pg_temp.img(1, 1, 8)),
  '22023', null,
  'an image uploaded by someone outside the project is refused'
);

select throws_ok(
  $$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
            '{}') $$,
  '22023', 'Attach 1 to 3 different mindmap images.',
  'no image is refused'
);

-- P2 enters first, with u05, who is also in P1.
select pg_temp.as_session('a7000000-0000-4000-8000-000000000006');

select ok(
  set_config('hk.p2v1', public.submit_hackathon_entry(
    'c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002', 'Team Two',
    array['a7000000-0000-4000-8000-000000000006', 'a7000000-0000-4000-8000-000000000007', 'a7000000-0000-4000-8000-000000000005']::uuid[],
    array[pg_temp.img(1, 2, 3)])::text, true) is not null,
  'P2''s owner submits in the window'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000002');

select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000005']::uuid[],
            array[%L]) $$, pg_temp.img(1, 1, 1)),
  'QD409', 'member_on_other_team',
  'a person already on another team in this hackathon is refused'
);

select ok(
  set_config('hk.p1v1', public.submit_hackathon_entry(
    'c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', '  Team One  ',
    array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
    array[pg_temp.img(1, 1, 1)])::text, true) is not null,
  'a project admin (not the owner) submits in the window'
);

select pg_temp.as_postgres();

select results_eq(
  format($$ select s.team_name, v.version_no, s.current_version_id = v.id, v.member_ids, v.doqtri_snapshot_id is null
              from public.hackathon_submissions s join public.hackathon_submission_versions v on v.submission_id = s.id
             where v.id = %L $$, current_setting('hk.p1v1')),
  $$ values ('Team One'::text, 1, true,
             array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
             true) $$,
  'version 1: trimmed team name, current, sorted members, no doqtri snapshot yet'
);

select results_eq(
  format($$ select run_no::int, status, attempts from public.hackathon_grading_jobs where version_id = %L order by run_no $$,
         current_setting('hk.p1v1')),
  $$ values (1, 'pending'::text, 0), (2, 'pending'::text, 0) $$,
  'submit queues runs 1 and 2'
);

select results_eq(
  $$ select user_id from public.hackathon_team_members
      where submission_id = (select id from public.hackathon_submissions where project_id = 'b7000000-0000-4000-8000-000000000001')
      order by user_id $$,
  $$ values ('a7000000-0000-4000-8000-000000000001'::uuid), ('a7000000-0000-4000-8000-000000000002'::uuid),
            ('a7000000-0000-4000-8000-000000000003'::uuid) $$,
  'the team rows are the submitted members'
);


-- ----------------------------------------------------------------------------
-- 5. The frozen qdit snapshot (QditSnapshotV1)
-- ----------------------------------------------------------------------------

create function pg_temp.snap() returns jsonb
language sql as $$
  select qdit_snapshot from public.hackathon_submission_versions where id = current_setting('hk.p1v1')::uuid;
$$;

select is(pg_temp.keys(pg_temp.snap()),
  array['captured_at', 'deployments', 'doc_links', 'members', 'milestone_anchors', 'milestone_links',
        'milestone_reviews', 'milestones', 'project', 'schema_version', 'stellar_proofs', 'tasks', 'truncated'],
  'snapshot: top-level keys');
select is(pg_temp.snap() -> 'schema_version', '1'::jsonb, 'snapshot: schema_version 1');
select is(pg_temp.keys(pg_temp.snap() -> 'project'),
  array['chain_contract_id', 'created_at', 'demo_url', 'description', 'docs_url', 'id', 'name',
        'public_proofs', 'repo_url', 'slug', 'status'],
  'snapshot: project keys');
select is(pg_temp.keys(pg_temp.snap() -> 'members' -> 0),
  array['display_name', 'joined_at', 'role', 'user_id', 'username', 'wallet_address'],
  'snapshot: member keys');
select is(pg_temp.keys(pg_temp.snap() -> 'milestones' -> 0),
  array['created_at', 'description', 'due_date', 'id', 'order_index', 'status', 'title', 'updated_at'],
  'snapshot: milestone keys');
select is(pg_temp.keys(pg_temp.snap() -> 'tasks' -> 0),
  array['assignee_id', 'created_at', 'description', 'due_date', 'id', 'milestone_id', 'priority',
        'status', 'title', 'updated_at'],
  'snapshot: task keys');
select is(pg_temp.keys(pg_temp.snap() -> 'milestone_reviews' -> 0),
  array['created_at', 'from_status', 'id', 'milestone_id', 'reason', 'reviewer_id', 'to_status'],
  'snapshot: milestone_review keys');
select is(pg_temp.keys(pg_temp.snap() -> 'milestone_anchors' -> 0),
  array['action', 'contract_id', 'created_at', 'id', 'ledger', 'milestone_id', 'network', 'proof_hash',
        'signer_address', 'tx_hash', 'version'],
  'snapshot: milestone_anchor keys');
select is(pg_temp.keys(pg_temp.snap() -> 'stellar_proofs' -> 0),
  array['contract_id', 'created_at', 'id', 'milestone_id', 'network', 'notes', 'proof_url', 'tx_hash', 'wallet_address'],
  'snapshot: stellar_proof keys');
select is(pg_temp.keys(pg_temp.snap() -> 'deployments' -> 0),
  array['contract_id', 'created_at', 'deployed_at', 'id', 'network', 'release_notes', 'status', 'tx_hash'],
  'snapshot: deployment keys');
select is(pg_temp.keys(pg_temp.snap() -> 'doc_links' -> 0),
  array['doc_id', 'doc_title', 'doc_url'],
  'snapshot: doc_link keys');
select is(pg_temp.keys(pg_temp.snap() -> 'milestone_links' -> 0),
  array['doc_id', 'doc_version', 'milestone_id', 'node_id', 'node_label'],
  'snapshot: milestone_link keys');

select results_eq(
  $$ select jsonb_array_length(pg_temp.snap() -> 'tasks'), jsonb_array_length(pg_temp.snap() -> 'members'),
            pg_temp.snap() -> 'tasks' -> 0 ->> 'title', pg_temp.snap() -> 'tasks' -> 0 ->> 'priority',
            pg_temp.snap() -> 'tasks' -> 0 ->> 'due_date', pg_temp.snap() -> 'project' ->> 'slug' $$,
  $$ values (2, 5, 'Write tests'::text, 'high'::text, '2026-11-20'::text, 'hk-one'::text) $$,
  'snapshot: both tasks and all five members, with priority and a YYYY-MM-DD due date'
);

select results_eq(
  $$ select (pg_temp.snap() ->> 'truncated')::boolean,
            char_length(pg_temp.snap() -> 'tasks' -> 0 ->> 'description'),
            right(pg_temp.snap() -> 'tasks' -> 0 ->> 'description', 12) $$,
  $$ values (true, 4000, ' [truncated]'::text) $$,
  'snapshot: a 5,000-character description is clipped to 4,000 with the marker, and truncated is set'
);

select results_eq(
  $$ select char_length(pg_temp.snap() -> 'milestones' -> 0 ->> 'description'),
            right(pg_temp.snap() -> 'milestones' -> 0 ->> 'description', 12),
            left(pg_temp.snap() -> 'milestones' -> 0 ->> 'description', 1) = U&'\+01F600' $$,
  $$ values (4000, ' [truncated]'::text, true) $$,
  'snapshot: 5,000 emoji are clipped to 4,000 characters, not bytes'
);

-- An edit after the submit does not reach the frozen copy.
update public.tasks set title = 'Edited later' where id = 'f7100000-0000-4000-8000-000000000001';

select is(pg_temp.snap() -> 'tasks' -> 0 ->> 'title', 'Write tests', 'snapshot: a later task edit leaves the version unchanged');

select throws_ok(
  format($$ update public.hackathon_submission_versions set team_name = 'Forged' where id = %L $$, current_setting('hk.p1v1')),
  '42501', 'Submission versions are insert-only; only eligibility changes.',
  'a version cannot be edited, even by the table owner'
);


-- ----------------------------------------------------------------------------
-- 6. doqtri's push
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a7000000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', '{"notes": []}', repeat('a', 64), 0) $$,
  '42501', 'Hackathon snapshots are sent from doqtri, through its connection to qdit.',
  'push: a first-party session is refused'
);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222');

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', '{"notes": []}', repeat('a', 64), 0) $$,
  '42501', 'Only doqtri can send hackathon snapshots.',
  'push: another OAuth client is refused'
);

select pg_temp.as_postgres();
insert into public.oauth_client_revocations (user_id, client_id, revoked_at)
values ('a7000000-0000-4000-8000-000000000002', '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d', now());

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000002');

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', '{"notes": []}', repeat('a', 64), 0) $$,
  '42501', 'This app''s access to qdit was revoked.',
  'push: a token issued before its user revoked doqtri is refused'
);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000003');

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', '{"notes": []}', repeat('a', 64), 0) $$,
  '42501', 'Your role in this project does not allow that.',
  'push: below admin is refused'
);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('no-such-slug', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', '{"notes": []}', repeat('a', 64), 0) $$,
  'P0002', 'No such hackathon.',
  'push: an unknown slug is not found'
);

select ok(
  set_config('hk.push1', public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
    'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001',
    '{"notes": [{}, {}, {}]}', repeat('a', 64), 3)::text, true) is not null,
  'push: doqtri''s client, for a project admin, in the window'
);

select results_eq(
  $$ select (current_setting('hk.push1')::jsonb ->> 'replay')::boolean,
            (current_setting('hk.push1')::jsonb ->> 'note_count')::int,
            current_setting('hk.push1')::jsonb ->> 'submission_state',
            (current_setting('hk.push1')::jsonb ->> 'id') <> 'e7000000-0000-4000-8000-000000000001' $$,
  $$ values (false, 3, 'submitted_older'::text, true) $$,
  'push: stored, not a replay, the entry''s current version predates it, id is qdit''s own'
);

select is(
  public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
    'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001',
    '{"notes": [{}, {}, {}]}', repeat('a', 64), 3) - 'replay',
  current_setting('hk.push1')::jsonb - 'replay',
  'push: the same snapshot_id with the same hash answers the first answer'
);

select is(
  public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
    'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001',
    '{"notes": [{}, {}, {}]}', repeat('a', 64), 3) ->> 'replay',
  'true',
  'push: ... flagged as a replay'
);

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001', '{"notes": [{}, {}, {}]}', repeat('b', 64), 3) $$,
  'QD409', 'snapshot_conflict',
  'push: the same snapshot_id with another hash is a conflict'
);

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-closed', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001',
            '{"notes": [{}, {}, {}]}', repeat('a', 64), 3) $$,
  'QD409', 'snapshot_conflict',
  'push: the same snapshot_id and hash for another hackathon is a conflict'
);

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000006', 'e7100000-0000-4000-8000-000000000001',
            '{"notes": [{}]}', repeat('a', 64), 0) $$,
  '22023', 'note_count must be the number of notes in the payload.',
  'push: note_count must match the payload'
);

-- The database backstop is 3 MiB of jsonb text (the route holds the exact
-- 2 MiB of raw bytes). A compact body under 2 MiB whose jsonb text form is
-- over 2 MiB (99,000 short strings: 21 bytes each compact, 22 with jsonb's
-- added space) gets past it: the unknown slug answers, not the size.
select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('no-such-slug', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000007', 'e7100000-0000-4000-8000-000000000001',
            x.p, repeat('a', 64), 0)
       from (select jsonb_build_object('notes', '[]'::jsonb, 'pad', jsonb_agg(repeat('n', 18))) as p
               from generate_series(1, 99000)) x
      where octet_length(x.p::text) > 2097152
        and octet_length(replace(x.p::text, ', ', ',')) < 2097152 $$,
  'P0002', 'No such hackathon.',
  'push: a payload whose jsonb text is just over 2 MiB passes the database cap'
);

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000007', 'e7100000-0000-4000-8000-000000000001',
            jsonb_build_object('notes', '[]'::jsonb, 'pad', repeat('x', 3145728)), repeat('a', 64), 0) $$,
  'QD413', 'payload_too_large',
  'push: a payload over 3 MiB of jsonb text is refused by the database backstop'
);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000006');

select is(
  public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000002',
    'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000002',
    '{"notes": []}', repeat('b', 64), 0) ->> 'replay',
  'false',
  'push: the same snapshot_id in another project is unrelated'
);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-closed', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-000000000001', '{"notes": []}', repeat('a', 64), 0) $$,
  'QD409', 'hackathon_closed',
  'push: closed window'
);

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-future', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000003', 'e7100000-0000-4000-8000-000000000001', '{"notes": []}', repeat('a', 64), 0) $$,
  'QD409', 'hackathon_not_open',
  'push: not open yet'
);

-- A late pass for P1 in H2 opens both doors for P1 only.
select pg_temp.as_session('a7000000-0000-4000-8000-000000000021');

select throws_ok(
  $$ select public.grant_late_pass('c7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000001', now() + interval '1 hour') $$,
  '42501', null,
  'late pass: not by a judge (or anyone but an admin of that hackathon)'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');
select lives_ok(
  $$ select public.grant_late_pass('c7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000001', now() + interval '1 hour') $$,
  'late pass: granted by the hackathon''s admin'
);

select throws_ok(
  $$ select public.release_hackathon_grades('c7000000-0000-4000-8000-000000000002') $$,
  'QD409', 'late_pass_active',
  'release: refused while a late pass is in force'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000001');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('hackathon-mindmaps', %L, auth.uid()) $$,
         pg_temp.img(2, 1, 58)),
  'storage: the late pass lets the owner upload to the closed hackathon'
);
select pg_temp.as_session('a7000000-0000-4000-8000-000000000006');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('hackathon-mindmaps', %L, auth.uid()) $$,
         pg_temp.img(2, 2, 59)),
  '42501', null,
  'storage: but only for the project holding it'
);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000001');

select is(
  public.push_doqtri_hackathon_snapshot('hk-closed', 'b7000000-0000-4000-8000-000000000001',
    'e7000000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-000000000001',
    '{"notes": []}', repeat('c', 64), 0) ->> 'submission_state',
  'none',
  'push: a late pass lets a closed hackathon take the project''s push'
);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000006');

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-closed', 'b7000000-0000-4000-8000-000000000002',
            'e7000000-0000-4000-8000-000000000009', 'e7100000-0000-4000-8000-000000000002', '{"notes": []}', repeat('a', 64), 0) $$,
  'QD409', 'hackathon_closed',
  'push: the late pass is P1''s, not P2''s'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000001');

select ok(
  set_config('hk.p1h2', public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000001', 'Late team',
    array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
    array[pg_temp.img(2, 1, 7)])::text, true) is not null,
  'submit: a late pass lets a closed hackathon take the project''s entry'
);

-- The pass ends; a retry of the landed push still replays, a new one does not land.
select pg_temp.as_postgres();
update public.hackathon_late_passes set until = now() - interval '1 second'
 where hackathon_id = 'c7000000-0000-4000-8000-000000000002';

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000001');

select is(
  public.push_doqtri_hackathon_snapshot('hk-closed', 'b7000000-0000-4000-8000-000000000001',
    'e7000000-0000-4000-8000-000000000002', 'e7100000-0000-4000-8000-000000000001',
    '{"notes": []}', repeat('c', 64), 0) ->> 'replay',
  'true',
  'push: a replay is answered before the window, so it survives the close'
);

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-closed', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000004', 'e7100000-0000-4000-8000-000000000001', '{"notes": []}', repeat('d', 64), 0) $$,
  'QD409', 'hackathon_closed',
  'push: a new snapshot after the pass ended is refused'
);

-- The cap: 30 per (hackathon, project), counted after the replay check.
select pg_temp.as_postgres();
insert into public.hackathon_doqtri_snapshots (snapshot_id, hackathon_id, project_id, workspace_id, client_id, payload, payload_sha256, note_count)
select gen_random_uuid(), 'c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000003',
       gen_random_uuid(), '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d', '{"notes": []}', repeat('f', 64), 0
  from generate_series(1, 29);
insert into public.hackathon_doqtri_snapshots (snapshot_id, hackathon_id, project_id, workspace_id, client_id, payload, payload_sha256, note_count)
values ('e7000000-0000-4000-8000-000000000030', 'c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000003',
        gen_random_uuid(), '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d', '{"notes": []}', repeat('e', 64), 0);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000010');

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000003',
            'e7000000-0000-4000-8000-000000000031', 'e7100000-0000-4000-8000-000000000003', '{"notes": []}', repeat('a', 64), 0) $$,
  'QD409', 'snapshot_limit',
  'push: the 31st snapshot for one entry is refused'
);

select is(
  public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000003',
    'e7000000-0000-4000-8000-000000000030', 'e7100000-0000-4000-8000-000000000003', '{"notes": []}', repeat('e', 64), 0) ->> 'replay',
  'true',
  'push: a replay of one of the 30 still answers'
);

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000005', 'e7100000-0000-4000-8000-000000000001', '{}', 'NOT-HEX', 0) $$,
  'P0002', 'No such project.',
  'push: from outside the project nothing is learnt about it (role first)'
);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
            'e7000000-0000-4000-8000-000000000005', 'e7100000-0000-4000-8000-000000000001', '{}', 'NOT-HEX', 0) $$,
  '22023', null,
  'push: a malformed hash is refused'
);


-- ----------------------------------------------------------------------------
-- 7. Resubmitting
-- ----------------------------------------------------------------------------

-- An older snapshot for P1 in H1 (received an hour ago): not the newest.
select pg_temp.as_postgres();
insert into public.hackathon_doqtri_snapshots (snapshot_id, hackathon_id, project_id, workspace_id, client_id, payload, payload_sha256, note_count, received_at)
values ('e7000000-0000-4000-8000-000000000040', 'c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
        gen_random_uuid(), '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d', '{"notes": []}', repeat('9', 64), 0, now() - interval '1 hour');

-- One of version 1's jobs is mid-run when the team resubmits.
select pg_temp.as_service();
select is(
  (select count(*) from public.claim_grading_jobs(1, 200, current_setting('hk.p1v1')::uuid)),
  1::bigint,
  'a worker claims one of version 1''s jobs'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000001');

select ok(
  set_config('hk.p1v2', public.submit_hackathon_entry(
    'c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'Team One',
    array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003',
          'a7000000-0000-4000-8000-000000000004']::uuid[],
    array[pg_temp.img(1, 1, 1), pg_temp.img(1, 1, 2, 'webp')])::text, true) is not null,
  'the owner resubmits with a fourth member (a viewer still counts) and a second image'
);

select pg_temp.as_postgres();

select results_eq(
  format($$ select v.version_no, s.current_version_id = v.id, ds.snapshot_id
              from public.hackathon_submission_versions v
              join public.hackathon_submissions s on s.id = v.submission_id
              left join public.hackathon_doqtri_snapshots ds on ds.id = v.doqtri_snapshot_id
             where v.id = %L $$, current_setting('hk.p1v2')),
  $$ values (2, true, 'e7000000-0000-4000-8000-000000000001'::uuid) $$,
  'version 2 is current and froze the newest doqtri snapshot by received_at'
);

select results_eq(
  format($$ select run_no::int, status from public.hackathon_grading_jobs where version_id = %L order by run_no $$,
         current_setting('hk.p1v1')),
  $$ values (1, 'superseded'::text), (2, 'superseded'::text) $$,
  'resubmit supersedes version 1''s pending and running jobs'
);

select results_eq(
  format($$ select run_no::int, status from public.hackathon_grading_jobs where version_id = %L order by run_no $$,
         current_setting('hk.p1v2')),
  $$ values (1, 'pending'::text), (2, 'pending'::text) $$,
  'and queues runs 1 and 2 for version 2'
);

select is(
  (select count(*) from public.hackathon_team_members
    where submission_id = (select id from public.hackathon_submissions
                            where hackathon_id = 'c7000000-0000-4000-8000-000000000001'
                              and project_id = 'b7000000-0000-4000-8000-000000000001')),
  4::bigint,
  'the team rows are replaced'
);

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000001');

select is(
  public.push_doqtri_hackathon_snapshot('hk-main', 'b7000000-0000-4000-8000-000000000001',
    'e7000000-0000-4000-8000-000000000001', 'e7100000-0000-4000-8000-000000000001',
    '{"notes": [{}, {}, {}]}', repeat('a', 64), 3) ->> 'submission_state',
  'current',
  'push: a replay after the resubmit says the current version froze it'
);

-- P3, P4 and P5 enter too.
select pg_temp.as_session('a7000000-0000-4000-8000-000000000010');
select ok(
  set_config('hk.p3v1', public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000003', 'Team Three',
    array['a7000000-0000-4000-8000-000000000010', 'a7000000-0000-4000-8000-000000000011', 'a7000000-0000-4000-8000-000000000012']::uuid[],
    array[pg_temp.img(1, 3, 4)])::text, true) is not null,
  'P3 submits'
);
select pg_temp.as_session('a7000000-0000-4000-8000-000000000013');
select ok(
  set_config('hk.p4v1', public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000004', 'Team Four',
    array['a7000000-0000-4000-8000-000000000013', 'a7000000-0000-4000-8000-000000000014', 'a7000000-0000-4000-8000-000000000015']::uuid[],
    array[pg_temp.img(1, 4, 5)])::text, true) is not null,
  'P4 submits'
);
select pg_temp.as_session('a7000000-0000-4000-8000-000000000016');
select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000005', 'Team Five',
            array['a7000000-0000-4000-8000-000000000016', 'a7000000-0000-4000-8000-000000000017', 'a7000000-0000-4000-8000-000000000021']::uuid[],
            array[%L]) $$, pg_temp.img(1, 5, 6)),
  'QD409', 'member_is_staff',
  'submit: a judge of this hackathon cannot be on a team'
);
select ok(
  set_config('hk.p5v1', public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000005', 'Team Five',
    array['a7000000-0000-4000-8000-000000000016', 'a7000000-0000-4000-8000-000000000017', 'a7000000-0000-4000-8000-000000000018']::uuid[],
    array[pg_temp.img(1, 5, 6)])::text, true) is not null,
  'P5 submits'
);


-- ----------------------------------------------------------------------------
-- 8. Who reads entries
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a7000000-0000-4000-8000-000000000004');

select results_eq(
  $$ select (select count(*) from public.hackathon_submissions),
            (select count(*) from public.hackathon_submission_versions),
            (select count(*) from public.hackathon_team_members),
            (select count(*) from public.hackathon_doqtri_snapshots),
            (select count(*) from public.hackathon_late_passes) $$,
  $$ values (2::bigint, 3::bigint, 7::bigint, 3::bigint, 1::bigint) $$,
  'a viewer of P1 reads P1''s two entries, three versions, both teams, its three snapshots and its late pass'
);

select throws_ok('select count(*) from public.hackathon_ai_runs', '42501', null,
  'a team member cannot read hackathon_ai_runs');
select throws_ok('select count(*) from public.hackathon_grading_jobs', '42501', null,
  'a team member cannot read hackathon_grading_jobs');
select is((select count(*) from public.hackathon_staff), 0::bigint, 'a team member reads no staff rows');

select pg_temp.as_session('a7000000-0000-4000-8000-000000000006');

select results_eq(
  $$ select project_id from public.hackathon_submissions $$,
  $$ values ('b7000000-0000-4000-8000-000000000002'::uuid) $$,
  'P2''s owner reads only P2''s entry'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000009');

select is(
  pg_temp.hk_visible(),
  array['hackathons:4', 'hackathon_eligibility_overrides:denied', 'hackathon_grading_jobs:denied',
        'hackathon_ai_runs:denied', 'hackathon_finalists:denied', 'hackathon_finalist_ranks:denied'],
  'a stranger reads the hackathons and nothing else'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000021');

select results_eq(
  $$ select (select count(*) from public.hackathon_submissions),
            (select count(*) from public.hackathon_submission_versions v
               join public.hackathon_submissions s on s.id = v.submission_id
              where s.hackathon_id = 'c7000000-0000-4000-8000-000000000001'),
            (select count(*) from public.hackathon_team_members),
            (select count(*) from public.hackathon_doqtri_snapshots),
            (select count(*) from public.hackathon_staff) $$,
  $$ values (5::bigint, 6::bigint, 16::bigint, 33::bigint, 2::bigint) $$,
  'a judge reads every entry, version, team, snapshot and the staff of their hackathon, before release (Q-15)'
);

select throws_ok(
  $$ select * from public.hackathon_grading_status('c7000000-0000-4000-8000-000000000001') $$,
  '42501', 'Only this hackathon''s admins can do that.',
  'a judge cannot read the grading status'
);

select throws_ok(
  $$ select * from public.hackathon_leaderboard('c7000000-0000-4000-8000-000000000001') $$,
  '42501', 'Only this hackathon''s admins can do that.',
  'a judge cannot read the leaderboard'
);

select throws_ok(
  $$ select * from public.hackathon_finals_for_judge('c7000000-0000-4000-8000-000000000001') $$,
  'QD409', 'grades_not_released',
  'a judge sees no finalists before release'
);

select throws_ok(
  format($$ select public.upsert_judge_score((select submission_id from public.hackathon_submission_versions where id = %L), 3, 3, 3, 3, 3, null) $$,
         current_setting('hk.p1v2')),
  'QD409', 'grades_not_released',
  'a judge cannot score before release'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');

select throws_ok(
  $$ select * from public.hackathon_leaderboard('c7000000-0000-4000-8000-000000000001') $$,
  'QD409', 'grades_not_released',
  'the admin cannot read the leaderboard before release'
);

select results_eq(
  $$ select project_slug, version_no, jsonb_array_length(jobs), jobs -> 0 ->> 'status'
       from public.hackathon_grading_status('c7000000-0000-4000-8000-000000000001')
      where project_slug = 'hk-one' $$,
  $$ values ('hk-one'::text, 2, 2, 'pending'::text) $$,
  'grading status: current version and its two live jobs, superseded ones left out'
);

select ok(
  pg_get_function_result('public.hackathon_grading_status(uuid)'::regprocedure) !~ 'total|score|flag|criteria|summary|runs|rank',
  'grading status has no score, total, flag, criteria, summary, runs or rank column'
);


-- ----------------------------------------------------------------------------
-- 8b. Snapshot size: progressive clipping, then QD413
-- ----------------------------------------------------------------------------

-- H8 for this alone; P6 (u24, with u25 and u26) has 2,000 tasks of 4,000
-- characters each: too big at 4,000 and at 1,000, fits at 300.
select pg_temp.as_postgres();
insert into public.hackathons (id, slug, name, opens_at, closes_at)
values ('c7000000-0000-4000-8000-000000000008', 'hk-size', 'Size', now() - interval '1 hour', now() + interval '1 hour');
insert into public.projects (id, owner_id, name, slug)
values ('b7000000-0000-4000-8000-000000000006', 'a7000000-0000-4000-8000-000000000024', 'Hk six', 'hk-six');
insert into public.project_members (project_id, user_id, role)
values ('b7000000-0000-4000-8000-000000000006', 'a7000000-0000-4000-8000-000000000025', 'member'),
       ('b7000000-0000-4000-8000-000000000006', 'a7000000-0000-4000-8000-000000000026', 'member');
insert into public.tasks (project_id, title, description)
select 'b7000000-0000-4000-8000-000000000006', 'Task ' || n, repeat('d', 4000) from generate_series(1, 2000) as n;
insert into storage.objects (bucket_id, name, owner)
values ('hackathon-mindmaps', pg_temp.img(8, 6, 60), 'a7000000-0000-4000-8000-000000000024');

select pg_temp.as_session('a7000000-0000-4000-8000-000000000024');
select ok(
  set_config('hk.p6v1', public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000008', 'b7000000-0000-4000-8000-000000000006', 'Team Six',
    array['a7000000-0000-4000-8000-000000000024', 'a7000000-0000-4000-8000-000000000025', 'a7000000-0000-4000-8000-000000000026']::uuid[],
    array[pg_temp.img(8, 6, 60)])::text, true) is not null,
  'size: an 8 MB project still submits, rebuilt with smaller clips'
);

select pg_temp.as_postgres();
select results_eq(
  $$ select jsonb_array_length(v.qdit_snapshot -> 'tasks'),
            char_length(v.qdit_snapshot -> 'tasks' -> 0 ->> 'description'),
            (v.qdit_snapshot ->> 'truncated')::boolean,
            pg_column_size(v.qdit_snapshot) <= 2 * 1024 * 1024
       from public.hackathon_submission_versions v where v.id = current_setting('hk.p6v1')::uuid $$,
  $$ values (2000, 300, true, true) $$,
  'size: every task kept, text clipped to 300 characters, truncated set, under 2 MB'
);

-- 2,000 proofs with five 400-character fields: over 2 MB even at 300.
insert into public.stellar_proofs (project_id, contract_id, tx_hash, wallet_address, proof_url, notes)
select 'b7000000-0000-4000-8000-000000000006', repeat('c', 400), repeat('t', 400), repeat('w', 400),
       'https://example.com/' || repeat('p', 380), repeat('n', 400)
  from generate_series(1, 2000);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000024');
select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000008', 'b7000000-0000-4000-8000-000000000006', 'Team Six',
            array['a7000000-0000-4000-8000-000000000024', 'a7000000-0000-4000-8000-000000000025', 'a7000000-0000-4000-8000-000000000026']::uuid[],
            array[%L]) $$, pg_temp.img(8, 6, 60)),
  'QD413', 'snapshot_too_large',
  'size: still over 2 MB with text at 300 characters is QD413'
);


-- ----------------------------------------------------------------------------
-- 9. The queue (service role)
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a7000000-0000-4000-8000-000000000001');

select throws_ok(
  $$ select * from public.claim_grading_jobs(5, 200) $$,
  '42501', null,
  'a signed-in user cannot claim jobs'
);

-- Twenty running jobs on a filler entry (P2 in H2): the cap is reached.
select pg_temp.as_postgres();
insert into public.hackathon_submissions (id, hackathon_id, project_id, team_name)
values ('f7300000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000002', 'Filler');
insert into public.hackathon_submission_versions (id, submission_id, version_no, team_name, member_ids, qdit_snapshot, image_paths)
select ('f7400000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'f7300000-0000-4000-8000-000000000001', n, 'Filler',
       array['a7000000-0000-4000-8000-000000000006']::uuid[], '{}', array['x']
  from generate_series(1, 10) as n;
insert into public.hackathon_grading_jobs (version_id, run_no, status, attempts, lease_until)
select v.id, r, 'running', 1, now() + interval '10 minutes'
  from public.hackathon_submission_versions v, generate_series(1, 2) as r
 where v.submission_id = 'f7300000-0000-4000-8000-000000000001';

select pg_temp.as_service();

select is((select count(*) from public.claim_grading_jobs(10, 200)), 0::bigint,
  'claim: nothing while 20 jobs are running');

select pg_temp.as_postgres();
update public.hackathon_grading_jobs set status = 'done', lease_until = null
 where version_id in ('f7400000-0000-4000-8000-000000000001', 'f7400000-0000-4000-8000-000000000002',
                      'f7400000-0000-4000-8000-000000000003')
   and run_no = 1;

select pg_temp.as_service();

select is((select count(*) from public.claim_grading_jobs(50, 200)), 3::bigint,
  'claim: three slots free, three claimed, whatever the limit asked');

-- Settle the filler; the three real jobs just claimed go back untouched.
select pg_temp.as_postgres();
update public.hackathon_grading_jobs set status = 'done', lease_until = null
 where status = 'running'
   and version_id in (select id from public.hackathon_submission_versions
                       where submission_id = 'f7300000-0000-4000-8000-000000000001');
update public.hackathon_grading_jobs set status = 'pending', attempts = 0, lease_until = null
 where status = 'running';

-- One version only, when asked.
select pg_temp.as_service();

select results_eq(
  format($$ select version_id, run_no::int, attempts from public.claim_grading_jobs(10, 200, %L) order by run_no $$,
         current_setting('hk.p3v1')),
  format($$ values (%L::uuid, 1, 1), (%L::uuid, 2, 1) $$, current_setting('hk.p3v1'), current_setting('hk.p3v1')),
  'claim: p_version_id claims only that version''s jobs, counting the attempt'
);

-- A lapsed lease goes back to the queue and is claimed again.
select pg_temp.as_postgres();
update public.hackathon_grading_jobs set lease_until = now() - interval '1 second'
 where version_id = current_setting('hk.p3v1')::uuid and run_no = 1;

select pg_temp.as_service();

select results_eq(
  format($$ select run_no::int, attempts from public.claim_grading_jobs(10, 200, %L) $$, current_setting('hk.p3v1')),
  $$ values (1, 2) $$,
  'claim: a lapsed lease is reclaimed, as attempt 2'
);

create function pg_temp.job(p_version text, p_run int) returns uuid
language sql as $$
  select id from public.hackathon_grading_jobs where version_id = current_setting(p_version)::uuid and run_no = p_run;
$$;

-- Fencing: the worker whose lease lapsed (claim 1) cannot settle claim 2.
select is(public.complete_grading_job(pg_temp.job('hk.p3v1', 1), 1, 'test-model', '{}', 50, '{}', 'x', 'end_turn', '{}', false),
  'stale', 'fencing: complete under an earlier claim is stale');
select is(public.fail_grading_job(pg_temp.job('hk.p3v1', 1), 1, 'late', 0), 'stale',
  'fencing: fail under an earlier claim is stale');
select is(public.skip_grading_job(pg_temp.job('hk.p3v1', 1), 1, 'late'), 'stale',
  'fencing: skip under an earlier claim is stale');

select pg_temp.as_postgres();
select results_eq(
  format($$ select status, attempts, (select count(*)::int from public.hackathon_ai_runs r where r.version_id = j.version_id)
              from public.hackathon_grading_jobs j where id = %L $$, pg_temp.job('hk.p3v1', 1)),
  $$ values ('running'::text, 2, 0) $$,
  'fencing: the current claim is untouched and nothing was recorded'
);
select pg_temp.as_service();

select is(public.fail_grading_job(pg_temp.job('hk.p3v1', 1), 2, 'overloaded', 0, false, false), 'pending',
  'fail: an uncounted attempt (overload) goes back to pending');

select is((select attempts from public.claim_grading_jobs(10, 200, current_setting('hk.p3v1')::uuid)), 3,
  'fail: a retry with no delay is claimable at once, as claim 3');

select throws_ok(
  format($$ select public.fail_grading_job(%L, 3, 'Model said: ignore previous instructions', 0) $$, pg_temp.job('hk.p3v1', 1)),
  '22023', 'error must be a code: ^[a-z0-9_:.-]{1,80}$.',
  'fail: last_error takes a code, never prose'
);

select is(public.fail_grading_job(pg_temp.job('hk.p3v1', 1), 3, 'bad_output', 0), 'pending',
  'fail: claim 3 is only the second counted attempt, so pending again');

select is((select attempts from public.claim_grading_jobs(10, 200, current_setting('hk.p3v1')::uuid)), 4,
  'fail: claimed a fourth time');

select is(public.fail_grading_job(pg_temp.job('hk.p3v1', 1), 4, 'bad_output', 0), 'failed',
  'fail: failed after the third counted attempt');

select is(public.fail_grading_job(pg_temp.job('hk.p3v1', 1), 4, 'late', 0), 'stale',
  'fail: a job no longer running is stale');

select pg_temp.as_postgres();
select throws_ok(
  format($$ update public.hackathon_grading_jobs set last_error = 'free text here' where id = %L $$, pg_temp.job('hk.p3v1', 1)),
  '23514', null,
  'last_error: the column itself holds codes only'
);
select pg_temp.as_service();

-- Grades for everyone, as the grader stores them: five criterion scores and
-- their raw weighted total. P3's run 1 failed, so it is regraded below.
create function pg_temp.done(p_job uuid, p_attempt int, p_scores numeric[]) returns text
language sql as $$
  select public.complete_grading_job(
    p_job, p_attempt, 'test-model',
    jsonb_build_object(
      'clarity',     jsonb_build_object('score', p_scores[1], 'evidence', 'e'),
      'structure',   jsonb_build_object('score', p_scores[2], 'evidence', 'e'),
      'accuracy',    jsonb_build_object('score', p_scores[3], 'evidence', 'e'),
      'connections', jsonb_build_object('score', p_scores[4], 'evidence', 'e'),
      'execution',   jsonb_build_object('score', p_scores[5], 'evidence', 'e')),
    round((p_scores[1] + p_scores[2] + p_scores[3] + p_scores[4] + p_scores[5]) * 2, 2),
    array['placeholder'], 'ok', 'end_turn', '{}', false);
$$;

-- Claims the version's due jobs and completes run n with p_scores[n] (the
-- last row for any run beyond them).
create function pg_temp.grade(p_version text, p_scores numeric[]) returns text
language plpgsql as $$
declare
  j     record;
  out   text := '';
  i     integer := 0;
  n     integer := array_length(p_scores, 1);
  row_s numeric[];
begin
  for j in select * from public.claim_grading_jobs(20, 200, current_setting(p_version)::uuid) order by run_no loop
    i := least(i + 1, n);
    row_s := array(select unnest(p_scores[i:i][1:5]));
    out := out || pg_temp.done(j.job_id, j.attempts, row_s);
  end loop;
  return out;
end;
$$;

-- P1's two runs disagree (96 and 64): a third follows below.
select is(pg_temp.grade('hk.p1v2', array[[10, 10, 10, 10, 8], [6, 6, 6, 6, 8]]), 'donedone', 'P1: runs 1 and 2 done at 96 and 64');
select is(pg_temp.grade('hk.p2v1', array[[9, 9, 9, 9, 9]]), 'donedone', 'P2: two runs at 90');
select is(pg_temp.grade('hk.p4v1', array[[4, 4, 4, 4, 4]]), 'donedone', 'P4: two runs at 40, regraded below');
select is(pg_temp.grade('hk.p5v1', array[[10, 10, 10, 10, 9], [10, 10, 10, 10, 8]]), 'donedone', 'P5: runs at 98 and 96');
select is(public.complete_grading_job(pg_temp.job('hk.p3v1', 2), 1, 'test-model', '{}', 80, '{}', 'ok', 'end_turn', '{}', false),
  'done', 'P3: run 2 done at 80');

select is(public.complete_grading_job(pg_temp.job('hk.p1v2', 1), 1, 'test-model', '{}', 10, '{}', 'x', 'end_turn', '{}', false),
  'stale', 'complete: a job already done is stale, and records nothing');
select is(public.complete_grading_job(pg_temp.job('hk.p1v1', 2), 1, 'test-model', '{}', 10, '{}', 'x', 'end_turn', '{}', false),
  'stale', 'complete: a superseded job is stale');

-- P1's runs disagree: a third, at 20. Median 80, mean 60.
select ok(public.enqueue_third_run(current_setting('hk.p1v2')::uuid) is not null, 'third run: queued for the current version');
select is(public.enqueue_third_run(current_setting('hk.p1v2')::uuid), null, 'third run: not twice');
select is(public.enqueue_third_run(current_setting('hk.p1v1')::uuid), null, 'third run: never for a version that is not current');

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');
select results_eq(
  $$ select jsonb_array_length(jobs),
            (select max((j ->> 'run_no')::int) from jsonb_array_elements(jobs) as j),
            complete
       from public.hackathon_grading_status('c7000000-0000-4000-8000-000000000001')
      where project_slug = 'hk-one' $$,
  $$ values (2, 2, true) $$,
  'grading status before release: runs 1 and 2 only, and complete from those two (the pending third run leaves no trace)'
);
select pg_temp.as_service();

-- Eligibility from the gate: P2 and P5 fail it.
select lives_ok(format($$ select public.set_version_eligibility(%L, '{"eligible": true, "rules": []}') $$, current_setting('hk.p1v2')), 'eligibility: P1 stored');
select public.set_version_eligibility(current_setting('hk.p2v1')::uuid, '{"eligible": false, "rules": []}');
select public.set_version_eligibility(current_setting('hk.p3v1')::uuid, '{"eligible": true, "rules": []}');
select public.set_version_eligibility(current_setting('hk.p4v1')::uuid, '{"eligible": true, "rules": []}');
select public.set_version_eligibility(current_setting('hk.p5v1')::uuid, '{"eligible": false, "rules": []}');

select throws_ok(
  format($$ select public.set_version_eligibility(%L, '{"eligible": "yes"}') $$, current_setting('hk.p1v2')),
  '22023', null,
  'eligibility: must carry a boolean eligible'
);

-- Admin calls: regrade P3 (its run 1 failed) and P4.
select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');

select is(public.regrade_submission((select submission_id from public.hackathon_submission_versions where id = current_setting('hk.p4v1')::uuid)),
  3, 'regrade: P4''s new runs start at 3');

select pg_temp.as_postgres();

select results_eq(
  format($$ select run_no::int, status from public.hackathon_grading_jobs where version_id = %L order by run_no $$,
         current_setting('hk.p4v1')),
  $$ values (1, 'superseded'::text), (2, 'superseded'::text), (3, 'pending'::text), (4, 'pending'::text) $$,
  'regrade: done runs are superseded, two new runs queued'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');
select is(public.regrade_submission((select submission_id from public.hackathon_submission_versions where id = current_setting('hk.p3v1')::uuid)),
  3, 'regrade: P3 too');

select pg_temp.as_service();
select is(pg_temp.grade('hk.p4v1', array[[10, 10, 10, 10, 8]]), 'donedone', 'P4: regraded runs at 96');

select results_eq(
  $$ select jsonb_array_length(p -> 'jobs'), jsonb_array_length(p -> 'runs'),
            (select array_agg((r ->> 'run_no')::int order by (r ->> 'run_no')::int) from jsonb_array_elements(p -> 'runs') as r)
       from (select public.hackathon_version_progress(current_setting('hk.p4v1')::uuid) as p) x $$,
  $$ values (2, 2, array[3, 4]) $$,
  'progress: a regraded version lists only its live jobs and their runs'
);

-- The late entry in H2: the grader skips both runs as ineligible.
select is(
  (select string_agg(public.skip_grading_job(c.job_id, c.attempts, 'ineligible:notes')
                     || ':' || (c.current_version_id = c.version_id
                                and c.eligibility_override is null
                                and c.eligibility is null)::text, ',' order by c.run_no)
     from public.claim_grading_jobs(2, 200, current_setting('hk.p1h2')::uuid) as c),
  'done:true,done:true',
  'claim returns current_version_id, eligibility_override and eligibility; skip settles both running jobs'
);
select is(public.skip_grading_job(pg_temp.job('hk.p1h2', 1), 1, 'again'), 'stale', 'skip: once');
select throws_ok(
  format($$ select public.skip_grading_job(%L, 1, 'Not eligible: only 2 notes') $$, pg_temp.job('hk.p1h2', 1)),
  '22023', 'reason must be a code: ^[a-z0-9_:.-]{1,80}$.',
  'skip: the reason is a code too'
);

select pg_temp.as_postgres();
select results_eq(
  format($$ select status, attempts, last_error, (select count(*)::int from public.hackathon_ai_runs r where r.version_id = j.version_id)
              from public.hackathon_grading_jobs j where version_id = %L order by run_no $$,
         current_setting('hk.p1h2')),
  $$ values ('done'::text, 1, 'ineligible:notes'::text, 0), ('done'::text, 1, 'ineligible:notes'::text, 0) $$,
  'skip: done, reason kept, no AI run recorded'
);

-- The admin lets it in: two fresh runs are queued.
select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');
select lives_ok(
  format($$ select public.set_eligibility_override((select submission_id from public.hackathon_submission_versions where id = %L), true, 'Notes were in a second workspace') $$,
         current_setting('hk.p1h2')),
  'override true on a skipped entry'
);

select pg_temp.as_postgres();
select results_eq(
  format($$ select run_no::int, status from public.hackathon_grading_jobs where version_id = %L order by run_no $$,
         current_setting('hk.p1h2')),
  $$ values (1, 'superseded'::text), (2, 'superseded'::text), (3, 'pending'::text), (4, 'pending'::text) $$,
  'override true: the skipped runs are superseded and runs 3 and 4 queued'
);

select pg_temp.as_service();
select is(
  (select f from public.claim_grading_jobs(1, 200, current_setting('hk.p1h2')::uuid) as c,
          lateral public.fail_grading_job(c.job_id, c.attempts, 'refusal', 60, true) as f),
  'failed',
  'fail: p_permanent fails on the first attempt'
);

-- false, null and true again (jobs not all done now) queue nothing more.
select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');
select public.set_eligibility_override((select submission_id from public.hackathon_submission_versions where id = current_setting('hk.p1h2')::uuid), false, 'Changed my mind');
select public.set_eligibility_override((select submission_id from public.hackathon_submission_versions where id = current_setting('hk.p1h2')::uuid), null, null);
select public.set_eligibility_override((select submission_id from public.hackathon_submission_versions where id = current_setting('hk.p1h2')::uuid), true, 'Back in');

select pg_temp.as_postgres();
select results_eq(
  format($$ select status, count(*)::int from public.hackathon_grading_jobs where version_id = %L group by status order by status $$,
         current_setting('hk.p1h2')),
  $$ values ('failed'::text, 1), ('pending'::text, 1), ('superseded'::text, 2) $$,
  'override false, null, or true on an entry with live work: the jobs are left alone'
);
select pg_temp.as_service();

-- What P2's team sees of its entry, before the admin overrides it.
create function pg_temp.p2_view() returns jsonb
language sql as $$
  select jsonb_agg(to_jsonb(x) order by x.id)
    from (select id, hackathon_id, project_id, team_name, current_version_id, created_by, created_at
            from public.hackathon_submissions) x;
$$;
grant execute on function pg_temp.p2_view() to authenticated;

select pg_temp.as_session('a7000000-0000-4000-8000-000000000006');
select ok(set_config('hk.p2view', pg_temp.p2_view()::text, true) is not null, 'P2''s team reads its entry');

-- Overrides: P2 (failed the gate) let in, P4 (passed it, top AI score) kept out.
select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');

select throws_ok(
  format($$ select public.set_eligibility_override((select submission_id from public.hackathon_submission_versions where id = %L), true, ' ') $$,
         current_setting('hk.p2v1')),
  '22023', 'Say why, in 1 to 500 characters.',
  'override: a reason is required'
);

select lives_ok(
  format($$ select public.set_eligibility_override((select submission_id from public.hackathon_submission_versions where id = %L), true, 'Gate miscounted the notes') $$,
         current_setting('hk.p2v1')),
  'override: P2 let in'
);
select lives_ok(
  format($$ select public.set_eligibility_override((select submission_id from public.hackathon_submission_versions where id = %L), false, 'Not built during the event') $$,
         current_setting('hk.p4v1')),
  'override: P4 kept out'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000021');
select throws_ok(
  format($$ select public.set_eligibility_override((select submission_id from public.hackathon_submission_versions where id = %L), null, null) $$,
         current_setting('hk.p4v1')),
  '42501', null,
  'override: not by a judge'
);

-- Teams see "Received" only (D-116): no eligibility, no override, and no
-- trace of the override on their own row.
select pg_temp.as_session('a7000000-0000-4000-8000-000000000006');

select is(pg_temp.p2_view()::text, current_setting('hk.p2view'),
  'the override leaves P2''s team view of its entry exactly as it was');
select throws_ok('select eligibility from public.hackathon_submission_versions', '42501', null,
  'a team member cannot read a version''s eligibility');
select throws_ok('select * from public.hackathon_eligibility_overrides', '42501', null,
  'a team member cannot read the overrides');
select throws_ok('select updated_at from public.hackathon_submissions', '42501', null,
  'a team member cannot read updated_at');
select throws_ok('select xmin from public.hackathon_submissions', '42501', null,
  'a team member cannot read the row''s xmin');
select throws_ok('select * from public.hackathon_submission_versions', '42501', null,
  'nor anything through select *');
select results_eq(
  $$ select s.team_name, v.version_no from public.hackathon_submissions s
       join public.hackathon_submission_versions v on v.id = s.current_version_id $$,
  $$ values ('Team Two'::text, 1) $$,
  'the team still reads its entry and version by naming the columns'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000021');
select throws_ok('select * from public.hackathon_eligibility_overrides', '42501', null,
  'a judge cannot read the overrides either');

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');
select results_eq(
  $$ select eligibility -> 'eligible', eligibility_override, override_reason
       from public.hackathon_grading_status('c7000000-0000-4000-8000-000000000001')
      where project_slug = 'hk-two' $$,
  $$ values ('false'::jsonb, true, 'Gate miscounted the notes'::text) $$,
  'the admin gets eligibility and the override through hackathon_grading_status'
);


-- ----------------------------------------------------------------------------
-- 10. Release
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');

select throws_ok(
  $$ select public.release_hackathon_grades('c7000000-0000-4000-8000-000000000001') $$,
  'QD409', 'hackathon_not_closed',
  'release: refused before closes_at'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000021');
select throws_ok(
  $$ select public.release_hackathon_grades('c7000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'release: not by a judge'
);

-- The event ends. P1 submitted before P3 (both median 80).
select pg_temp.as_postgres();
update public.hackathons set opens_at = now() - interval '2 hours', closes_at = now() - interval '1 second'
 where id = 'c7000000-0000-4000-8000-000000000001';
alter table public.hackathon_submission_versions disable trigger hackathon_submission_versions_frozen;
update public.hackathon_submission_versions set submitted_at = now() - interval '10 minutes' where id = current_setting('hk.p1v2')::uuid;
update public.hackathon_submission_versions set submitted_at = now() - interval '5 minutes' where id = current_setting('hk.p3v1')::uuid;
alter table public.hackathon_submission_versions enable trigger hackathon_submission_versions_frozen;

select pg_temp.as_session('a7000000-0000-4000-8000-000000000001');
select throws_ok(
  format($$ select public.submit_hackathon_entry('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001',
            'Team', array['a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003']::uuid[],
            array[%L]) $$, pg_temp.img(1, 1, 1)),
  'QD409', 'hackathon_closed',
  'submit: refused after closes_at'
);

-- P5's runs disagree too: its third run stays pending through release.
select pg_temp.as_service();
select ok(set_config('hk.p5third', public.enqueue_third_run(current_setting('hk.p5v1')::uuid)::text, true) is not null,
  'third run: queued for P5, and left pending');

-- What release answers, as `message: detail`.
create function pg_temp.release_answer(p_hackathon uuid) returns text
language plpgsql as $$
declare
  v_detail text;
begin
  perform public.release_hackathon_grades(p_hackathon);
  return 'released';
exception when sqlstate 'QD409' then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlerrm || ': ' || v_detail;
end;
$$;
grant execute on function pg_temp.release_answer(uuid) to authenticated;

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');

select is(
  pg_temp.release_answer('c7000000-0000-4000-8000-000000000001'),
  'grading_incomplete: 1 entries still grading.',
  'release: refused while P3''s regrade runs; P1''s and P5''s pending third runs are not counted, nor shown'
);

select pg_temp.as_service();
-- 7.6 is clamped to 8, as clampScore() does: combined 80 though each stored total is 79.2.
select is(pg_temp.grade('hk.p3v1', array[[8, 8, 8, 8, 7.6]]), 'donedone', 'P3: regraded runs at 79.2 (stored)');
select is(pg_temp.grade('hk.p1v2', array[[8, 8, 8, 8, 0]]), 'done', 'P1: third run at 64');

select results_eq(
  $$ select jsonb_array_length(p -> 'jobs'),
            (select array_agg((r ->> 'total')::numeric order by (r ->> 'run_no')::int) from jsonb_array_elements(p -> 'runs') as r)
       from (select public.hackathon_version_progress(current_setting('hk.p1v2')::uuid) as p) x $$,
  $$ values (3, array[96.00, 64.00, 64.00]::numeric[]) $$,
  'progress: three jobs and their three runs'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');

select is(public.release_hackathon_grades('c7000000-0000-4000-8000-000000000001'), 2,
  'release: proceeds with only a third run pending (P5''s), two finalists');

select pg_temp.as_postgres();
select is(
  (select status from public.hackathon_grading_jobs where id = current_setting('hk.p5third')::uuid),
  'superseded',
  'release: the pending third run is superseded, so P5 keeps its two-run mean'
);
select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');

select throws_ok(
  format($$ select public.set_eligibility_override(%L, true, 'Too late') $$, pg_temp.sub('hk.p5v1')),
  'QD409', 'already_released',
  'override: not after release'
);

select pg_temp.as_postgres();

select results_eq(
  $$ select p.slug, r.ai_rank
       from public.hackathon_finalist_ranks r
       join public.hackathon_submissions s on s.id = r.submission_id
       join public.projects p on p.id = s.project_id
      where r.hackathon_id = 'c7000000-0000-4000-8000-000000000001'
      order by r.ai_rank $$,
  $$ values ('hk-two'::text, 1), ('hk-one'::text, 2) $$,
  'finalists: P2 (override in, 90) then P1 (per-criterion median 80, tied with P3 and earlier); P5 ineligible, P4 overridden out'
);

select ok((select released_at is not null and released_by = 'a7000000-0000-4000-8000-000000000022'
             from public.hackathons where id = 'c7000000-0000-4000-8000-000000000001'),
  'release: released_at and released_by are set');

select is(
  (select array_agg(submission_id) from public.hackathon_finalists
    where hackathon_id = 'c7000000-0000-4000-8000-000000000001'),
  (select array_agg(x order by x) from unnest(array[pg_temp.sub('hk.p1v2'), pg_temp.sub('hk.p2v1')]) as x),
  'finalists are stored in submission-id order, not rank order'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');
select results_eq(
  $$ select jsonb_array_length(jobs), complete
       from public.hackathon_grading_status('c7000000-0000-4000-8000-000000000001')
      where project_slug = 'hk-one' $$,
  $$ values (3, true) $$,
  'grading status after release: every live run, complete'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');

select throws_ok(
  $$ select public.release_hackathon_grades('c7000000-0000-4000-8000-000000000001') $$,
  'QD409', 'already_released',
  'release: only once'
);

select throws_ok(
  format($$ select public.regrade_submission((select submission_id from public.hackathon_submission_versions where id = %L)) $$,
         current_setting('hk.p5v1')),
  'QD409', 'already_released',
  'regrade: not after release'
);

select results_eq(
  $$ select project_slug, eligible, run_count, ai_mean, ai_total, finalist, ai_rank
       from public.hackathon_leaderboard('c7000000-0000-4000-8000-000000000001')
      order by project_slug $$,
  $$ values ('hk-five'::text,  false, 2, 97.00::numeric, 97.00::numeric, false, null::int),
            ('hk-four'::text,  false, 2, 96.00::numeric, 96.00::numeric, false, null::int),
            ('hk-one'::text,   true,  3, 74.67::numeric, 80.00::numeric, true,  2),
            ('hk-three'::text, true,  2, 79.20::numeric, 80.00::numeric, false, null::int),
            ('hk-two'::text,   true,  2, 90.00::numeric, 90.00::numeric, true,  1) $$,
  'leaderboard (admin, after release): counted runs only, mean of totals, combined total per rubric.ts, finalists'
);

select is(
  (select ai_criteria from public.hackathon_leaderboard('c7000000-0000-4000-8000-000000000001') where project_slug = 'hk-one'),
  '{"clarity": 8.00, "structure": 8.00, "accuracy": 8.00, "connections": 8.00, "execution": 8.00}'::jsonb,
  'leaderboard: three runs combine by per-criterion median (not the median 64 or mean 74.67 of totals)'
);

select is(
  (select ai_criteria ->> 'execution' from public.hackathon_leaderboard('c7000000-0000-4000-8000-000000000001') where project_slug = 'hk-five'),
  '8.50',
  'leaderboard: two runs combine by per-criterion mean'
);

select is(
  (select jsonb_array_length(runs) from public.hackathon_leaderboard('c7000000-0000-4000-8000-000000000001') where project_slug = 'hk-four'),
  2,
  'leaderboard: a regraded entry shows only its new runs'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000021');

select throws_ok(
  $$ select * from public.hackathon_leaderboard('c7000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'leaderboard: still not for a judge after release'
);

select throws_ok('select submission_id from public.hackathon_finalists', '42501', null,
  'a judge cannot read the finalists table...');
select throws_ok('select ai_rank from public.hackathon_finalist_ranks', '42501', null,
  '... nor the ranks');

select is(
  (select array_agg(submission_id) from public.hackathon_finals_for_judge('c7000000-0000-4000-8000-000000000001')),
  (select array_agg(x order by x) from unnest(array[pg_temp.sub('hk.p1v2'), pg_temp.sub('hk.p2v1')]) as x),
  'judge finals: by submission id while no pitch order is set, never by rank'
);

-- Another hackathon's content stays closed to this judge.
select results_eq(
  format($$ select (select count(*) from public.hackathon_submissions where hackathon_id = 'c7000000-0000-4000-8000-000000000002'),
                   (select count(*) from public.hackathon_submission_versions where id = %L),
                   (select count(*) from public.hackathon_doqtri_snapshots where hackathon_id = 'c7000000-0000-4000-8000-000000000002'),
                   (select count(*) from storage.objects where bucket_id = 'hackathon-mindmaps'
                       and name like 'c7000000-0000-4000-8000-000000000002/%%') $$,
         current_setting('hk.p1h2')),
  $$ values (0::bigint, 0::bigint, 0::bigint, 0::bigint) $$,
  'cross-hackathon: an H1 judge reads no H2 entry, version, snapshot or mindmap'
);
select throws_ok(
  $$ select * from public.hackathon_finals_for_judge('c7000000-0000-4000-8000-000000000002') $$,
  '42501', null,
  'cross-hackathon: nor H2''s finalists'
);
select throws_ok(
  format($$ select public.upsert_judge_score(%L, 3, 3, 3, 3, 3, null) $$, pg_temp.sub('hk.p1h2')),
  '42501', null,
  'cross-hackathon: nor score an H2 entry'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000004');
select throws_ok('select submission_id from public.hackathon_finalists', '42501', null,
  'a team member reads no finalist row');

-- H2: one job mid-run, then an incomplete release, which stops the queue.
select pg_temp.as_service();
select ok(
  (select set_config('hk.h2job', c.job_id::text, true) is not null and c.attempts = 1
     from public.claim_grading_jobs(1, 200, current_setting('hk.p1h2')::uuid) as c),
  'H2: a worker holds the last pending job'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');
select throws_ok(
  $$ select public.release_hackathon_grades('c7000000-0000-4000-8000-000000000002') $$,
  'QD409', 'grading_incomplete',
  'release: refused with a run in progress'
);
select is(public.release_hackathon_grades('c7000000-0000-4000-8000-000000000002', true), 0,
  'release: p_allow_incomplete releases anyway (no entry has a counted run here)');

select pg_temp.as_postgres();
select results_eq(
  format($$ select status, count(*)::int from public.hackathon_grading_jobs where version_id = %L group by status order by status $$,
         current_setting('hk.p1h2')),
  $$ values ('failed'::text, 1), ('superseded'::text, 3) $$,
  'release: the running job is superseded; the failed one keeps its state'
);

select pg_temp.as_service();
select is(public.complete_grading_job(current_setting('hk.h2job')::uuid, 1, 'test-model', '{}', 50, '{}', 'x', 'end_turn', '{}', false),
  'stale', 'after release: completing the old lease records nothing');
select is((select count(*) from public.claim_grading_jobs(10, 200, current_setting('hk.p1h2')::uuid)), 0::bigint,
  'after release: nothing of the hackathon is claimed');
select is(public.enqueue_third_run(current_setting('hk.p1h2')::uuid), null,
  'after release: no third run');

-- An operator re-adds a late pass after release: storage stays closed.
select pg_temp.as_postgres();
update public.hackathon_late_passes set until = now() + interval '1 hour'
 where hackathon_id = 'c7000000-0000-4000-8000-000000000002';
select pg_temp.as_session('a7000000-0000-4000-8000-000000000001');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner) values ('hackathon-mindmaps', %L, auth.uid()) $$,
         pg_temp.img(2, 1, 61)),
  '42501', null,
  'storage: nothing is uploaded after release, late pass or not'
);


-- ----------------------------------------------------------------------------
-- 11. Judging and pitch order
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a7000000-0000-4000-8000-000000000021');

select lives_ok(
  format($$ select public.upsert_judge_score(%L, 4, 4, 5, 3, 4, 'Clear map') $$, pg_temp.sub('hk.p2v1')),
  'judge: scores a finalist after release'
);

select lives_ok(
  format($$ select public.upsert_judge_score(%L, 5, 4, 5, 3, 4, 'Clearer on a second look') $$, pg_temp.sub('hk.p2v1')),
  'judge: and changes their mind'
);

select throws_ok(
  format($$ select public.upsert_judge_score(%L, 4, 4, 4, 4, 4, null) $$, pg_temp.sub('hk.p3v1')),
  'QD409', 'not_finalist',
  'judge: not a non-finalist'
);

select throws_ok(
  format($$ select public.upsert_judge_score(%L, 6, 4, 4, 4, 4, null) $$, pg_temp.sub('hk.p2v1')),
  '22023', 'Each score is a whole number from 1 to 5.',
  'judge: no score above 5'
);

select throws_ok(
  format($$ select public.upsert_judge_score(%L, 0, 4, 4, 4, 4, null) $$, pg_temp.sub('hk.p2v1')),
  '22023', 'Each score is a whole number from 1 to 5.',
  'judge: no score below 1'
);

select throws_ok(
  format($$ select public.upsert_judge_score(%L, 4, 4, 4, 4, 4, %L) $$, pg_temp.sub('hk.p2v1'), repeat('n', 2001)),
  '22023', null,
  'judge: a note is at most 2,000 characters'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');
select lives_ok(
  format($$ select public.upsert_judge_score(%L, 2, 2, 2, 2, 2, null) $$, pg_temp.sub('hk.p2v1')),
  'an admin may judge too'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000001');
select throws_ok(
  format($$ select public.upsert_judge_score(%L, 4, 4, 4, 4, 4, null) $$, pg_temp.sub('hk.p2v1')),
  '42501', null,
  'a builder cannot judge'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000021');

select results_eq(
  $$ select judge_id, clarity::int, note from public.hackathon_judge_scores $$,
  $$ values ('a7000000-0000-4000-8000-000000000021'::uuid, 5, 'Clearer on a second look'::text) $$,
  'judge: reads only their own row, as last written'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');

select results_eq(
  $$ select judge_mean, judge_count from public.hackathon_leaderboard('c7000000-0000-4000-8000-000000000001')
      where project_slug = 'hk-two' $$,
  $$ values (15.50::numeric, 2) $$,
  'leaderboard: judges'' mean /25 (21 and 10) and count'
);

select results_eq(
  $$ select jsonb_array_length(judge_scores),
            judge_scores -> 0 ->> 'judge_id', (judge_scores -> 0 ->> 'clarity')::int, (judge_scores -> 0 ->> 'pitch')::int,
            judge_scores -> 1 ->> 'judge_id', (judge_scores -> 1 ->> 'clarity')::int,
            pg_temp.keys(judge_scores -> 0)
       from public.hackathon_leaderboard('c7000000-0000-4000-8000-000000000001')
      where project_slug = 'hk-two' $$,
  $$ values (2, 'a7000000-0000-4000-8000-000000000021'::text, 5, 4, 'a7000000-0000-4000-8000-000000000022'::text, 2,
             array['accuracy', 'clarity', 'connections', 'judge_id', 'pitch', 'structure']) $$,
  'leaderboard: every judge''s scores, by judge, for exact ranking'
);

select is(
  (select judge_scores from public.hackathon_leaderboard('c7000000-0000-4000-8000-000000000001') where project_slug = 'hk-five'),
  '[]'::jsonb,
  'leaderboard: no judge scores for a non-finalist'
);

select throws_ok(
  format($$ select public.set_pitch_order('c7000000-0000-4000-8000-000000000001', array[%L]::uuid[]) $$, pg_temp.sub('hk.p1v2')),
  '22023', 'List every finalist exactly once.',
  'pitch order: every finalist, exactly once'
);

select lives_ok(
  format($$ select public.set_pitch_order('c7000000-0000-4000-8000-000000000001', array[%L, %L]::uuid[]) $$,
         pg_temp.sub('hk.p1v2'), pg_temp.sub('hk.p2v1')),
  'pitch order: set'
);

select results_eq(
  $$ select project_slug, pitch_order from public.hackathon_leaderboard('c7000000-0000-4000-8000-000000000001')
      where finalist order by pitch_order $$,
  $$ values ('hk-one'::text, 1), ('hk-two'::text, 2) $$,
  'pitch order: as given'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000021');
select results_eq(
  $$ select project_slug, pitch_order from public.hackathon_finals_for_judge('c7000000-0000-4000-8000-000000000001') $$,
  $$ values ('hk-one'::text, 1), ('hk-two'::text, 2) $$,
  'judge finals: in pitch order once it is set'
);
select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');

select throws_ok(
  $$ select public.grant_late_pass('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000003', now() + interval '1 hour') $$,
  'QD409', 'already_released',
  'late pass: none after release'
);


-- ----------------------------------------------------------------------------
-- 12. Staff management
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a7000000-0000-4000-8000-000000000021');
select throws_ok(
  $$ select public.set_hackathon_staff('c7000000-0000-4000-8000-000000000001', 'hk_u09', 'judge') $$,
  '42501', null,
  'staff: a judge cannot change the staff'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');

select throws_ok(
  $$ select public.set_hackathon_staff('c7000000-0000-4000-8000-000000000001', 'hk_u22', 'judge') $$,
  'QD409', 'last_admin',
  'staff: the last admin cannot demote themself'
);

select throws_ok(
  $$ select public.set_hackathon_staff('c7000000-0000-4000-8000-000000000001', 'hk_u22', null) $$,
  'QD409', 'last_admin',
  'staff: nor remove themself'
);

select throws_ok(
  $$ select public.set_hackathon_staff('c7000000-0000-4000-8000-000000000001', 'hk_u11', 'judge') $$,
  'QD409', 'staff_on_team',
  'staff: not someone on a team in this hackathon'
);

select throws_ok(
  $$ select public.set_hackathon_staff('c7000000-0000-4000-8000-000000000001', 'nobody_here', 'judge') $$,
  'P0002', 'No account uses that username.',
  'staff: an unknown username is not found'
);

select is(
  public.set_hackathon_staff('c7000000-0000-4000-8000-000000000001', ' HK_U23 ', 'admin'),
  'a7000000-0000-4000-8000-000000000023'::uuid,
  'staff: a second admin added by username, case and spaces ignored'
);

select is(
  public.set_hackathon_staff('c7000000-0000-4000-8000-000000000001', 'hk_u22', 'judge'),
  'a7000000-0000-4000-8000-000000000022'::uuid,
  'staff: with another admin, the first may step down to judge'
);

select pg_temp.as_session('a7000000-0000-4000-8000-000000000023');

select results_eq(
  $$ select username, role::text from public.hackathon_staff_list('c7000000-0000-4000-8000-000000000001') order by username $$,
  $$ values ('hk_u21'::text, 'judge'::text), ('hk_u22'::text, 'judge'::text), ('hk_u23'::text, 'admin'::text) $$,
  'staff list: usernames and roles, for an admin'
);

select lives_ok(
  $$ select public.set_hackathon_staff('c7000000-0000-4000-8000-000000000001', 'hk_u21', null) $$,
  'staff: a judge removed'
);


-- ----------------------------------------------------------------------------
-- 13. OAuth apps read nothing here (D-03, D-117)
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a7000000-0000-4000-8000-000000000022');
select ok(cardinality(pg_temp.hk_visible()) >= 9, 'a first-party session of an admin sees rows in the readable tables');

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000022');
select is(pg_temp.hk_visible(), array['hackathon_eligibility_overrides:denied', 'hackathon_grading_jobs:denied',
                                     'hackathon_ai_runs:denied', 'hackathon_finalists:denied', 'hackathon_finalist_ranks:denied'],
  'the same admin''s OAuth token reads no row of any hackathon table');

select pg_temp.as_oauth_client('a7000000-0000-4000-8000-000000000001');
select is(pg_temp.hk_visible(), array['hackathon_eligibility_overrides:denied', 'hackathon_grading_jobs:denied',
                                     'hackathon_ai_runs:denied', 'hackathon_finalists:denied', 'hackathon_finalist_ranks:denied'],
  'a team owner''s OAuth token reads nothing, not even the snapshot it sent');

select throws_ok(
  $$ select * from public.hackathon_grading_status('c7000000-0000-4000-8000-000000000001') $$,
  '42501', 'Apps connected through OAuth cannot do this.',
  'an OAuth token cannot call the admin RPCs'
);


-- ----------------------------------------------------------------------------
-- 14. Chain check, insert-only snapshots, retention
-- ----------------------------------------------------------------------------

select pg_temp.as_service();

select lives_ok(
  format($$ select public.record_doqtri_chain_check(%L, '{"notes": []}') $$, current_setting('hk.push1')::jsonb ->> 'id'),
  'chain check: recorded by the service role'
);

select pg_temp.as_postgres();

select throws_ok(
  format($$ update public.hackathon_doqtri_snapshots set payload = '{"forged": true}' where id = %L $$,
         current_setting('hk.push1')::jsonb ->> 'id'),
  '42501', 'Hackathon doqtri snapshots are insert-only; only chain_check changes.',
  'a doqtri snapshot''s payload cannot change'
);

-- H4: unreleased, closed 100 days ago (kept until 180). H9: released, closed
-- 91 days ago (pruned). H10: released, 89 days (kept). H11: released, closed
-- 100 days ago but a late pass ran until 89 days ago (kept). H12:
-- unreleased, closed 181 days ago (pruned).
insert into public.hackathons (id, slug, name, opens_at, closes_at, released_at)
values
  ('c7000000-0000-4000-8000-000000000009', 'hk-r91',  'R91',  now() - interval '92 days',  now() - interval '91 days',  now() - interval '90 days'),
  ('c7000000-0000-4000-8000-000000000010', 'hk-r89',  'R89',  now() - interval '90 days',  now() - interval '89 days',  now() - interval '88 days'),
  ('c7000000-0000-4000-8000-000000000011', 'hk-rlp',  'RLP',  now() - interval '101 days', now() - interval '100 days', now() - interval '88 days'),
  ('c7000000-0000-4000-8000-000000000012', 'hk-u181', 'U181', now() - interval '182 days', now() - interval '181 days', null);
insert into public.hackathon_late_passes (hackathon_id, project_id, until)
values ('c7000000-0000-4000-8000-000000000011', 'b7000000-0000-4000-8000-000000000001', now() - interval '89 days');
insert into public.hackathon_doqtri_snapshots (id, snapshot_id, hackathon_id, project_id, workspace_id, client_id, payload, payload_sha256, note_count)
select ('f7500000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, gen_random_uuid(),
       ('c7000000-0000-4000-8000-0000000000' || lpad(h::text, 2, '0'))::uuid,
       'b7000000-0000-4000-8000-000000000001', gen_random_uuid(), '9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d', '{}', repeat('1', 64), 0
  from (values (1, 4), (2, 9), (3, 10), (4, 11), (5, 12)) as x (n, h);
insert into public.hackathon_submissions (id, hackathon_id, project_id, team_name)
values ('f7300000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000009', 'b7000000-0000-4000-8000-000000000001', 'Old');
insert into public.hackathon_submission_versions (id, submission_id, version_no, team_name, member_ids, qdit_snapshot, image_paths, doqtri_snapshot_id)
values ('f7400000-0000-4000-8000-000000000099', 'f7300000-0000-4000-8000-000000000002', 1, 'Old',
        array['a7000000-0000-4000-8000-000000000001']::uuid[], '{}', array['x'], 'f7500000-0000-4000-8000-000000000002');

select pg_temp.as_service();
select is(public.prune_hackathon_doqtri_snapshots(), 2, 'retention: two snapshots are past their keep date');

select pg_temp.as_postgres();
select results_eq(
  $$ select h.slug from public.hackathon_doqtri_snapshots d join public.hackathons h on h.id = d.hackathon_id
      where d.id::text like 'f7500000-%' order by h.slug $$,
  $$ values ('hk-old'::text), ('hk-r89'::text), ('hk-rlp'::text) $$,
  'retention: released 91 days and unreleased 181 days go; released 89 days, a recent late pass and unreleased 100 days stay'
);

select pg_temp.as_postgres();
select results_eq(
  $$ select doqtri_snapshot_id from public.hackathon_submission_versions where id = 'f7400000-0000-4000-8000-000000000099' $$,
  $$ values (null::uuid) $$,
  'retention: the version keeps a null reference'
);


-- ----------------------------------------------------------------------------
-- 15. The schedulers
-- ----------------------------------------------------------------------------

select results_eq(
  $$ select jobname::text, schedule::text, command::text from cron.job
      where jobname in ('qdit-grade-hackathon', 'qdit-prune-hackathon-snapshots') order by jobname $$,
  $$ values ('qdit-grade-hackathon'::text, '* * * * *'::text, 'select public.request_hackathon_grading()'::text),
            ('qdit-prune-hackathon-snapshots'::text, '23 3 * * *'::text, 'select public.prune_hackathon_doqtri_snapshots()'::text) $$,
  'pg_cron: grading every minute, pruning daily; no secret in either command'
);

delete from vault.secrets where name in ('qdit_grade_hackathon_url', 'qdit_cron_secret');

select is(
  public.hackathon_grading_scheduler_health(),
  '{"status": "missing", "job": true, "missing_secrets": ["qdit_grade_hackathon_url", "qdit_cron_secret"]}'::jsonb,
  'scheduler health: missing, naming both secrets'
);

select is(public.request_hackathon_grading(), null::bigint, 'with no secrets stored the job sends nothing');

select vault.create_secret('https://qdit.test/api/cron/grade-hackathon', 'qdit_grade_hackathon_url');
select vault.create_secret('test-cron-secret', 'qdit_cron_secret');
update public.hackathon_grading_jobs set status = 'done' where status in ('pending', 'running');

select is(public.request_hackathon_grading(), null::bigint, 'with an idle queue the job sends nothing');

update public.hackathon_grading_jobs set status = 'pending'
 where id = pg_temp.job('hk.p5v1', 1);

select ok(public.request_hackathon_grading() is not null, 'with a pending job it queues one request');


select * from finish();

rollback;
