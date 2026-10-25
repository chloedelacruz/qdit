-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/public_milestone_doc_source.test.sql
--
-- Covers 20261025140000_public_milestone_doc_source.sql: the doqtri reference
-- public_milestone_proof() adds for a linked milestone (WP-3.2). A linked
-- milestone of a publishing project gets `docSource` with exactly the doc id,
-- node id, node label, doc version and project id (null until the project
-- is registered on chain), never the stored doc URL; an unlinked one gets the
-- function's previous answer, unchanged; the doc title is never sent; a
-- project that does not publish still answers null; and anon, which the
-- function is for, still reads none of the tables behind it.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back. Callers are
-- simulated as in integration_links.test.sql: the JWT's role and claims.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(28);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a3200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'src-owner@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Owner","username":"src_owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a3200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'src-stranger@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Stranger","username":"src_stranger"}', now(), now());

-- P1 publishes, P2 does not, P3 publishes and is registered on chain.
insert into public.projects (id, owner_id, name, slug, public_proofs)
values
  ('b3200000-0000-4000-8000-000000000001', 'a3200000-0000-4000-8000-000000000001', 'Published', 'src-published', true),
  ('b3200000-0000-4000-8000-000000000002', 'a3200000-0000-4000-8000-000000000001', 'Private', 'src-private', false);

insert into public.projects (id, owner_id, name, slug, public_proofs,
                             chain_contract_id, chain_network, chain_owner_address, chain_registered_tx,
                             chain_registered_at)
values
  ('b3200000-0000-4000-8000-000000000003', 'a3200000-0000-4000-8000-000000000001', 'On chain', 'src-onchain', true,
   'CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG', 'testnet',
   'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', repeat('a', 64), now());

-- M1 linked, M2 unlinked, M3 linked with no doc version, M4 linked in P2,
-- M5 linked in P3.
insert into public.milestones (id, project_id, title, status, order_index)
values
  ('c3200000-0000-4000-8000-000000000001', 'b3200000-0000-4000-8000-000000000001', 'Escrow contract', 'submitted', 0),
  ('c3200000-0000-4000-8000-000000000002', 'b3200000-0000-4000-8000-000000000001', 'Unlinked work', 'approved', 1),
  ('c3200000-0000-4000-8000-000000000003', 'b3200000-0000-4000-8000-000000000001', 'Payroll UI', 'proposed', 2),
  ('c3200000-0000-4000-8000-000000000004', 'b3200000-0000-4000-8000-000000000002', 'Private heading', 'proposed', 0),
  ('c3200000-0000-4000-8000-000000000005', 'b3200000-0000-4000-8000-000000000003', 'Chain heading', 'proposed', 0);

insert into public.milestone_anchors (milestone_id, project_id, action, proof_hash, version, contract_id, tx_hash, signer_address, created_by)
values
  ('c3200000-0000-4000-8000-000000000001', 'b3200000-0000-4000-8000-000000000001', 'submit',
   repeat('c', 64), 1, 'CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG', repeat('d', 64),
   'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', 'a3200000-0000-4000-8000-000000000001'),
  ('c3200000-0000-4000-8000-000000000002', 'b3200000-0000-4000-8000-000000000001', 'submit',
   repeat('e', 64), 1, 'CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG', repeat('f', 64),
   'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7', 'a3200000-0000-4000-8000-000000000001');

insert into public.milestone_reviews (milestone_id, project_id, from_status, to_status, reason, reviewer_id)
values ('c3200000-0000-4000-8000-000000000002', 'b3200000-0000-4000-8000-000000000001',
        'submitted', 'approved', 'Looks right.', 'a3200000-0000-4000-8000-000000000001');

-- The doc titles are private doqtri note titles, and the stored doc_url is
-- not the page's link (P1's names another doqtri page); nothing below may send
-- either.
insert into public.project_doc_links (id, project_id, doc_id, doc_title, doc_url, linked_by)
values
  ('e3200000-0000-4000-8000-000000000001', 'b3200000-0000-4000-8000-000000000001',
   'd3200000-0000-4000-8000-000000000001', 'Secret payroll plan',
   'https://www.doqtri.xyz/d/another-doc?x=1', 'a3200000-0000-4000-8000-000000000001'),
  ('e3200000-0000-4000-8000-000000000002', 'b3200000-0000-4000-8000-000000000002',
   'd3200000-0000-4000-8000-000000000002', 'Secret private plan',
   'https://www.doqtri.xyz/d/d3200000-0000-4000-8000-000000000002', 'a3200000-0000-4000-8000-000000000001'),
  ('e3200000-0000-4000-8000-000000000003', 'b3200000-0000-4000-8000-000000000003',
   'd3200000-0000-4000-8000-000000000003', 'Secret chain plan',
   'https://www.doqtri.xyz/d/d3200000-0000-4000-8000-000000000003', 'a3200000-0000-4000-8000-000000000001');

insert into public.milestone_external_links (id, milestone_id, project_id, doc_id, node_id, node_label, doc_version, created_by)
values
  ('f3200000-0000-4000-8000-000000000001', 'c3200000-0000-4000-8000-000000000001',
   'b3200000-0000-4000-8000-000000000001', 'd3200000-0000-4000-8000-000000000001',
   'h4', 'Escrow contract', 7, 'a3200000-0000-4000-8000-000000000001'),
  ('f3200000-0000-4000-8000-000000000003', 'c3200000-0000-4000-8000-000000000003',
   'b3200000-0000-4000-8000-000000000001', 'd3200000-0000-4000-8000-000000000001',
   'h6', 'Payroll UI', null, 'a3200000-0000-4000-8000-000000000001'),
  ('f3200000-0000-4000-8000-000000000004', 'c3200000-0000-4000-8000-000000000004',
   'b3200000-0000-4000-8000-000000000002', 'd3200000-0000-4000-8000-000000000002',
   'h1', 'Private heading', 3, 'a3200000-0000-4000-8000-000000000001'),
  ('f3200000-0000-4000-8000-000000000005', 'c3200000-0000-4000-8000-000000000005',
   'b3200000-0000-4000-8000-000000000003', 'd3200000-0000-4000-8000-000000000003',
   'h2', 'Chain heading', 2, 'a3200000-0000-4000-8000-000000000001');


-- ----------------------------------------------------------------------------
-- The function as 20260815051120_public_proofs.sql defined it, verbatim
-- (comments aside), to compare the new answer against. Called as postgres,
-- which reads every table, so it needs no SECURITY DEFINER.
-- ----------------------------------------------------------------------------

create function pg_temp.previous_proof(p_slug text, p_milestone_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'projectName',  p.name,
    'projectSlug',  p.slug,
    'milestoneId',  m.id,
    'title',        m.title,
    'status',       m.status,
    'dueDate',      m.due_date,
    'network',      p.chain_network,
    'contractId',   p.chain_contract_id,
    'registeredTx', p.chain_registered_tx,
    'ownerAddress', p.chain_owner_address,
    'anchors', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'action',        a.action,
          'proofHash',     a.proof_hash,
          'version',       a.version,
          'txHash',        a.tx_hash,
          'network',       a.network,
          'signerAddress', a.signer_address,
          'ledger',        a.ledger,
          'createdAt',     a.created_at
        )
        order by a.created_at
      )
      from public.milestone_anchors a
      where a.milestone_id = m.id
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fromStatus', r.from_status,
          'toStatus',   r.to_status,
          'reason',     r.reason,
          'createdAt',  r.created_at
        )
        order by r.created_at
      )
      from public.milestone_reviews r
      where r.milestone_id = m.id
    ), '[]'::jsonb)
  )
  from public.milestones m
  join public.projects p on p.id = m.project_id
  where p.slug = p_slug
    and m.id = p_milestone_id
    and p.public_proofs;
$$;


-- ----------------------------------------------------------------------------
-- Caller switches
-- ----------------------------------------------------------------------------

create function pg_temp.as_anon() returns void
language sql as $$
  select set_config('role', 'anon', true);
  select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
$$;

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

create function pg_temp.as_postgres() returns void
language sql as $$
  select set_config('role', 'postgres', true);
  select set_config('request.jwt.claims', '', true);
$$;

-- Every answer below is computed as postgres first, then compared with what
-- anon gets: the caller must not change it.
create temp table answers on commit drop as
select 'linked'::text as k,
       public.public_milestone_proof('src-published', 'c3200000-0000-4000-8000-000000000001') as proof,
       pg_temp.previous_proof('src-published', 'c3200000-0000-4000-8000-000000000001') as previous
union all
select 'unlinked',
       public.public_milestone_proof('src-published', 'c3200000-0000-4000-8000-000000000002'),
       pg_temp.previous_proof('src-published', 'c3200000-0000-4000-8000-000000000002')
union all
select 'unversioned',
       public.public_milestone_proof('src-published', 'c3200000-0000-4000-8000-000000000003'),
       pg_temp.previous_proof('src-published', 'c3200000-0000-4000-8000-000000000003')
union all
select 'onchain',
       public.public_milestone_proof('src-onchain', 'c3200000-0000-4000-8000-000000000005'),
       pg_temp.previous_proof('src-onchain', 'c3200000-0000-4000-8000-000000000005');
grant select on answers to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 1. Shape of the function
-- ----------------------------------------------------------------------------

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_catalog.pg_proc p
    where p.oid = 'public.public_milestone_proof(text, uuid)'::regprocedure),
  'public_milestone_proof is SECURITY DEFINER with an empty search_path'
);

select ok(
  has_function_privilege('anon', 'public.public_milestone_proof(text, uuid)', 'execute'),
  'anon may still call public_milestone_proof'
);


-- ----------------------------------------------------------------------------
-- 2. An unlinked milestone: the answer it always had
-- ----------------------------------------------------------------------------

select is(
  (select proof from answers where k = 'unlinked'),
  (select previous from answers where k = 'unlinked'),
  'unlinked: the answer is exactly the previous function''s'
);

select ok(
  not ((select proof from answers where k = 'unlinked') ? 'docSource'),
  'unlinked: no docSource key, not even a null one'
);


-- ----------------------------------------------------------------------------
-- 3. A linked milestone: docSource, and nothing else new
-- ----------------------------------------------------------------------------

select is(
  (select proof - 'docSource' from answers where k = 'linked'),
  (select previous from answers where k = 'linked'),
  'linked: every other field is the previous function''s answer'
);

select is(
  (select proof -> 'docSource' from answers where k = 'linked'),
  jsonb_build_object(
    'docId',      'd3200000-0000-4000-8000-000000000001',
    'nodeId',     'h4',
    'nodeLabel',  'Escrow contract',
    'docVersion', 7,
    'projectId',  null
  ),
  'linked: docSource is the doc id, node id, node label and doc version, and no project id off chain'
);

select is(
  (select array_agg(key order by key) from answers a, jsonb_object_keys(a.proof -> 'docSource') as key where a.k = 'linked'),
  array['docId', 'docVersion', 'nodeId', 'nodeLabel', 'projectId'],
  'linked: docSource has exactly those five keys'
);

-- Contract section 12: the page builds its doqtri link from DOQTRI_ORIGIN and
-- the doc id; the stored doc_url may name another doqtri page and is never
-- sent. P1's doc_url below names another doc, with a query.
select ok(
  not ((select proof -> 'docSource' from answers where k = 'linked') ? 'docUrl'),
  'linked: no docUrl key'
);

select is(
  (select position('another-doc' in proof::text) from answers where k = 'linked'),
  0,
  'linked: the stored doc_url is not sent anywhere in the answer'
);

select is(
  (select proof #>> '{docSource,nodeLabel}' from answers where k = 'linked'),
  (select proof ->> 'title' from answers where k = 'linked'),
  'linked: the node label is the milestone title the page already shows (D-12)'
);

select is(
  (select position('Secret payroll plan' in proof::text) from answers where k = 'linked'),
  0,
  'linked: the doc title is not sent'
);

-- The project id is already public on chain once the project is registered:
-- it keys the milestone_proof records the heading's artifact_ref names.
select is(
  (select proof #>> '{docSource,projectId}' from answers where k = 'onchain'),
  'b3200000-0000-4000-8000-000000000003',
  'linked, project registered on chain: docSource carries the project id'
);

select is(
  (select proof - 'docSource' from answers where k = 'onchain'),
  (select previous from answers where k = 'onchain'),
  'linked, project registered on chain: every other field is the previous function''s answer'
);

select is(
  (select position('Secret chain plan' in proof::text) from answers where k = 'onchain'),
  0,
  'linked, project registered on chain: the doc title is not sent'
);

select is(
  (select proof #> '{docSource,docVersion}' from answers where k = 'unversioned'),
  'null'::jsonb,
  'linked before the doc was anchored: docVersion is null'
);

select is(
  (select proof #>> '{docSource,nodeId}' from answers where k = 'unversioned'),
  'h6',
  'linked before the doc was anchored: the node id is still sent'
);


-- ----------------------------------------------------------------------------
-- 4. As anon, the caller the function is for
-- ----------------------------------------------------------------------------

select pg_temp.as_anon();

select is(
  public.public_milestone_proof('src-published', 'c3200000-0000-4000-8000-000000000001'),
  (select proof from answers where k = 'linked'),
  'anon: the same answer for a linked milestone'
);

select is(
  public.public_milestone_proof('src-published', 'c3200000-0000-4000-8000-000000000002'),
  (select proof from answers where k = 'unlinked'),
  'anon: the same answer for an unlinked milestone'
);

select is(
  public.public_milestone_proof('src-onchain', 'c3200000-0000-4000-8000-000000000005'),
  (select proof from answers where k = 'onchain'),
  'anon: the same answer for a linked milestone of a project on chain'
);

select is(
  public.public_milestone_proof('src-private', 'c3200000-0000-4000-8000-000000000004'),
  null,
  'anon: a linked milestone of a project that does not publish is null'
);

select is(
  public.public_milestone_proof('src-published', 'c3200000-0000-4000-8000-000000000004'),
  null,
  'anon: a linked milestone named under another project''s slug is null'
);

select throws_ok(
  $$ select count(*) from public.milestone_external_links $$,
  '42501', null,
  'anon: milestone_external_links stays unreadable directly'
);

select throws_ok(
  $$ select count(*) from public.project_doc_links $$,
  '42501', null,
  'anon: project_doc_links (and the doc titles in it) stays unreadable directly'
);

select is(
  (select count(*)::int from public.milestones),
  0,
  'anon: milestones stay unreadable directly'
);


-- ----------------------------------------------------------------------------
-- 5. As an OAuth client: nothing an anonymous visitor would not get
-- ----------------------------------------------------------------------------

select pg_temp.as_oauth_client('a3200000-0000-4000-8000-000000000002');

select is(
  public.public_milestone_proof('src-published', 'c3200000-0000-4000-8000-000000000001'),
  (select proof from answers where k = 'linked'),
  'oauth client of a stranger: the same answer anon gets'
);

select is(
  public.public_milestone_proof('src-private', 'c3200000-0000-4000-8000-000000000004'),
  null,
  'oauth client of a stranger: nothing for a project that does not publish'
);


-- ----------------------------------------------------------------------------
-- 6. Unlinking takes it off the page
-- ----------------------------------------------------------------------------

select pg_temp.as_postgres();

delete from public.project_doc_links where id = 'e3200000-0000-4000-8000-000000000001';

select is(
  public.public_milestone_proof('src-published', 'c3200000-0000-4000-8000-000000000001'),
  (select previous from answers where k = 'linked'),
  'after the doc is unlinked (D-22): the previous answer, with no docSource'
);

select is(
  public.public_milestone_proof('src-published', 'c3200000-0000-4000-8000-000000000003'),
  (select previous from answers where k = 'unversioned'),
  'after the doc is unlinked: its other milestone loses docSource too'
);


select * from finish();

rollback;
