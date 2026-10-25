-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261026120000_doqtri_origin_doc_url_check.sql
--
-- What integration_settings.doqtri_origin is for (WP-2.14, D-95), on top of
-- 20261026100200_public_proof_doc_source_hardening.sql and
-- 20261025130100_doc_links_from_apps_only.sql.
--
-- ---------------------------------------------------------------------------
-- 1. NO docUrl IN THE ANON ANSWER
-- ---------------------------------------------------------------------------
-- 20261026100200 sent docSource.docUrl to anyone when the stored doc_url
-- started with doqtri_origin || '/'. Nothing reads it: the public page builds
-- its doqtri link from DOQTRI_ORIGIN and the doc id (contract section 12),
-- and web/src/lib/queries.ts never passed it on. The origin check is a prefix
-- check, so whatever path an app with the role stored after the origin was
-- served to anyone with nothing using it. public_milestone_proof() now sends
-- no doc URL at all, as 20261025140000 did; the contract (v1.1.2, section 12)
-- says so.
--
-- The rest is the body from 20261026100200, key for key: no nodeId (D-77,
-- the page server reads it with public_milestone_node_id(), which is
-- unchanged), nodeLabel, docVersion, projectId for a registered project, and
-- no docSource at all for an unlinked milestone. The joins on
-- project_doc_links and integration_settings were there only for docUrl and
-- go with it: milestone_external_links' composite foreign key already makes
-- every link row's doc link exist, so the rows that get a docSource are the
-- same.
--
-- ---------------------------------------------------------------------------
-- 2. THE D-72 CHECK IN THE DATABASE TOO
-- ---------------------------------------------------------------------------
-- doqtri_origin stays, for what SQL can do with it: link_project_doc() now
-- refuses a doc_url that does not start with doqtri_origin || '/' (the strict
-- rule of D-72, the same one the API applies with DOQTRI_ORIGIN), with 22023
-- and hint 'doc_url'. That holds for an app calling the function over
-- /rest/v1/rpc, which never meets the API's check, and for a deployment
-- whose DOQTRI_ORIGIN has drifted from the database's. /api/v1 answers it as
-- 400 invalid_request on doc_url (contract section 8) and logs that the two
-- origins differ.
--
-- While doqtri_origin is unset the database check does not run, and
-- link_project_doc() behaves exactly as before: the API's DOQTRI_ORIGIN
-- check is the only one, and a call over /rest/v1/rpc stores any https URL
-- the column's own CHECK allows. A fresh environment starts unset, so this
-- migration says so where the operator applying it sees it.
--
-- ---------------------------------------------------------------------------
-- 3. SAYING WHEN THE TWO ORIGINS DIFFER
-- ---------------------------------------------------------------------------
-- SQL cannot read the web app's env, so the comparison is the web app's:
-- doqtri_origin_setting() hands it the stored origin, service_role only, as
-- webhook_scheduler_health() does for the scheduler. The webhook cron route
-- calls it on every run and logs a warning when the value is unset or is
-- not DOQTRI_ORIGIN (web/src/lib/doqtri-origin-health.ts), which is where an
-- operator already reads the scheduler's.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. public_milestone_proof(): no docUrl
--
-- Signature and grants are unchanged.
-- ----------------------------------------------------------------------------

create or replace function public.public_milestone_proof(
  p_slug         text,
  p_milestone_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
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

    -- Every anchor, oldest first: the sequence is the story a funder is being
    -- shown — submitted, rejected, resubmitted, approved — and each entry names
    -- the transaction that proves it.
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

    -- Decisions carry their reason. A rejection published without one is the
    -- complaint this feature and public.milestone_reviews both answer; the
    -- reviewer's identity is deliberately absent, because a public page is not
    -- the place to name a person who never chose to be on one.
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
  -- WP-3.2: the doqtri doc this milestone is linked to. No row, no key. Never
  -- the doc's title, the node id (WP-2.12) or the doc URL (WP-2.14, D-95).
  || coalesce((
    select jsonb_build_object(
      'docSource', jsonb_build_object(
        'docId',      l.doc_id,
        'nodeLabel',  l.node_label,
        'docVersion', l.doc_version,
        'projectId',  case when p.chain_contract_id is not null then p.id end
      )
    )
    from public.milestone_external_links l
    where l.milestone_id = m.id
  ), '{}'::jsonb)
  from public.milestones m
  join public.projects p on p.id = m.project_id
  where p.slug = p_slug
    and m.id = p_milestone_id
    and p.public_proofs;
$$;

comment on function public.public_milestone_proof(text, uuid) is
  'The published view of one milestone, for callers with no account. Returns null unless projects.public_proofs is true. Hand-listed fields only — never row_to_json. A milestone linked to a doqtri heading adds docSource (doc id, node label, doc version, and the project id once the project is registered on chain; never the doc title, the doc URL (D-95) or the node id, which the page server reads with public_milestone_node_id()).';

-- Unchanged: callable by everybody, including the signed-out.
grant execute on function public.public_milestone_proof(text, uuid) to anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2. link_project_doc(): doc_url on doqtri_origin (D-95)
--
-- The body from 20261025130100_doc_links_from_apps_only.sql with step (1)
-- added after the role check, so a caller without the role learns nothing
-- about the setting. The revoke check of 20261026100000 stays where it is,
-- in assert_project_role(). Signature and grants are unchanged.
-- ----------------------------------------------------------------------------

create or replace function public.link_project_doc(
  p_project_id uuid,
  p_doc_id     uuid,
  p_doc_title  text,
  p_doc_url    text
)
returns table (
  id         uuid,
  project_id uuid,
  doc_id     uuid,
  doc_title  text,
  doc_url    text,
  created_at timestamptz,
  updated_at timestamptz,
  created    boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_origin text;
begin
  -- (0) Only through an app (D-60), before anything about the project.
  perform public.assert_oauth_client_session();

  perform public.assert_project_role(p_project_id, 'admin');

  -- (1) D-72 in the database (D-95): the URL starts with doqtri's origin and
  -- a slash, compared byte for byte, so a look-alike host, another of
  -- doqtri's hosts or the origin straight into a query is refused. Unset:
  -- no check here, as before; the API's is the only one.
  select s.doqtri_origin
    into v_origin
    from public.integration_settings s;

  if v_origin is not null
     and left(p_doc_url, char_length(v_origin) + 1) is distinct from v_origin || '/' then
    raise exception 'must be a doqtri URL starting with %/', v_origin
      using errcode = '22023',
            hint = 'doc_url';
  end if;

  -- One statement, so two concurrent posts of the same doc cannot both
  -- insert. The WHERE makes the conflict branch a no-op for a doc linked to
  -- another project, which then returns no row. `xmax = 0` is true only for
  -- a row this statement inserted, which is how 201 is told from 200.
  return query
    insert into public.project_doc_links as d (project_id, doc_id, doc_title, doc_url, linked_by)
    values (p_project_id, p_doc_id, btrim(p_doc_title), p_doc_url, auth.uid())
    on conflict on constraint project_doc_links_doc_id_key do update
      set doc_title = excluded.doc_title,
          doc_url   = excluded.doc_url
      where d.project_id = excluded.project_id
    returning d.id, d.project_id, d.doc_id, d.doc_title, d.doc_url,
              d.created_at, d.updated_at, (d.xmax = 0);

  if not found then
    raise exception 'doc_linked_elsewhere' using errcode = 'QD409';
  end if;
end;
$$;

comment on function public.link_project_doc(uuid, uuid, text, text) is
  'SECURITY DEFINER, OAuth clients only (D-60). POST /api/v1/projects/{id}/docs: links a doqtri doc to a project the caller administers, or refreshes title and URL when it is already linked there. 22023 (hint doc_url) when integration_settings.doqtri_origin is set and doc_url does not start with it and a slash (D-95); no such check while it is unset. QD409 doc_linked_elsewhere when another project holds it.';

comment on column public.integration_settings.doqtri_origin is
  'doqtri''s origin here (CONTRACT.md: DOQTRI_ORIGIN): https, lower case, no path, no trailing slash. link_project_doc() refuses a doc_url that does not start with this origin followed by / (D-95); while null it does not check. The web app warns when this differs from its DOQTRI_ORIGIN. Null until the operator sets it.';

comment on table public.integration_settings is
  'One row of per-environment integration config, set by an operator in the SQL editor. doqtri_oauth_client_id pins which OAuth client counts as doqtri (D-61); doqtri_origin is doqtri''s origin, for link_project_doc()''s doc URL check (D-95).';


-- ----------------------------------------------------------------------------
-- 3. doqtri_origin_setting(): the stored origin, for the web app's warning
-- ----------------------------------------------------------------------------

create or replace function public.doqtri_origin_setting()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.doqtri_origin from public.integration_settings s;
$$;

comment on function public.doqtri_origin_setting() is
  'SECURITY DEFINER, service_role only. integration_settings.doqtri_origin, or null while unset, for the web app to compare with its DOQTRI_ORIGIN and warn when they differ (D-95).';

revoke all on function public.doqtri_origin_setting() from public, anon, authenticated;
grant execute on function public.doqtri_origin_setting() to service_role;


-- Every fresh environment starts without doqtri's origin. Say so where the
-- operator applying migrations sees it.
do $warn$
begin
  if not exists (
    select 1 from public.integration_settings s where s.doqtri_origin is not null
  ) then
    raise warning 'integration_settings.doqtri_origin is not set: link_project_doc() does not check doc_url against doqtri''s origin, only the API''s DOQTRI_ORIGIN check runs'
      using hint = 'Set it to the same value as DOQTRI_ORIGIN: update public.integration_settings set doqtri_origin = ''https://<doqtri host>''; see docs/integration/qdit-oauth-setup.md.';
  end if;
end;
$warn$;
