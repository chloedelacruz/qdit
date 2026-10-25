-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261026100200_public_proof_doc_source_hardening.sql
--
-- What public_milestone_proof() tells a signed-out caller about a linked
-- milestone's doqtri source (WP-2.12, D-77), on top of
-- 20261025140000_public_milestone_doc_source.sql and
-- 20261025130000_oauth_revocations.sql.
--
-- ---------------------------------------------------------------------------
-- 1. THE NODE ID LEAVES THE ANON ANSWER
-- ---------------------------------------------------------------------------
-- Contract section 12 lets qdit's page show a linked heading's node id only
-- under the node-evidence rule: the heading's own DoqtriRegistry record has
-- tool "qdit" and an artifact_ref naming this project and milestone on the
-- project's own chain (D-73, D-74). The page applies that rule, but the
-- function under it is anon-callable over PostgREST, and it sent
-- docSource.nodeId for every linked milestone, evidence or not (G3 note).
-- SQL cannot read the chain, so the function cannot apply the rule itself.
--
-- So the anon answer no longer carries it. The page's server still needs the
-- node id, to know which record to read, and now gets it from
-- public_milestone_node_id() below: same publishing rule, granted to
-- service_role only, so no browser and no OAuth token can call it. The web
-- app reaches it with its server-side secret key (web/src/lib/queries.ts,
-- readPublicNodeId), reads get_node with it, and shows it only on evidence,
-- as before. Without the secret key the page says it could not check the
-- heading, never that it is unsigned.
--
-- nodeLabel stays: it always equals the milestone title (D-12), which the
-- answer already carries. projectId stays (registered projects only, already
-- on chain); contract section 12 lists it from v1.1.1.
--
-- ---------------------------------------------------------------------------
-- 2. docUrl ONLY ON DOQTRI'S ORIGIN
-- ---------------------------------------------------------------------------
-- integration_settings gains doqtri_origin, doqtri's origin in this
-- environment (the contract's DOQTRI_ORIGIN, the same value as the web app's
-- env var of that name): https, lower case, a host and optional port, no
-- path and no trailing slash. The CHECK holds it to that shape, so a typo
-- fails the UPDATE. The operator sets it next to doqtri_oauth_client_id
-- (docs/integration/qdit-oauth-setup.md, step 4).
--
-- docSource.docUrl is the stored doc_url only when it starts with
-- doqtri_origin || '/', the D-72 rule; null when the origin is unset or the
-- URL is anywhere else. The stored doc_url passed only the API's prefix check
-- (or none at all, if an app called link_project_doc() over PostgREST), so
-- this is the copy of that rule an anonymous caller cannot get around. The
-- public page still does not render it: section 12 has it build its doqtri
-- link from DOQTRI_ORIGIN and the doc id, and web/src/lib/queries.ts does not
-- pass docUrl on.
--
-- Everything else in the answer is unchanged, key for key, and an unlinked
-- milestone still gets no docSource at all.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. integration_settings.doqtri_origin
-- ----------------------------------------------------------------------------

alter table public.integration_settings
  add column doqtri_origin text
    constraint integration_settings_doqtri_origin_check
    check (
      char_length(doqtri_origin) <= 255
      and doqtri_origin ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$'
    );

comment on column public.integration_settings.doqtri_origin is
  'doqtri''s origin here (CONTRACT.md: DOQTRI_ORIGIN): https, lower case, no path, no trailing slash. public_milestone_proof() returns a doc link''s doc_url only when it starts with this origin followed by / (D-77). Null until the operator sets it.';

comment on table public.integration_settings is
  'One row of per-environment integration config, set by an operator in the SQL editor. doqtri_oauth_client_id pins which OAuth client counts as doqtri (D-61); doqtri_origin is doqtri''s origin, for the public doc URL check (D-77).';


-- ----------------------------------------------------------------------------
-- 2. public_milestone_proof(): no nodeId, docUrl on the origin only
--
-- The body from 20261025140000 with the docSource object changed as the
-- header says. Signature and grants are unchanged.
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
  -- the doc's title; never the node id (WP-2.12, see the header); the doc URL
  -- only on doqtri's origin.
  || coalesce((
    select jsonb_build_object(
      'docSource', jsonb_build_object(
        'docId',      l.doc_id,
        'nodeLabel',  l.node_label,
        'docVersion', l.doc_version,
        'projectId',  case when p.chain_contract_id is not null then p.id end,
        'docUrl',     case
                        when s.doqtri_origin is not null
                         and left(d.doc_url, char_length(s.doqtri_origin) + 1) = s.doqtri_origin || '/'
                        then d.doc_url
                      end
      )
    )
    from public.milestone_external_links l
    join public.project_doc_links d
      on d.project_id = l.project_id
     and d.doc_id = l.doc_id
    left join public.integration_settings s on true
    where l.milestone_id = m.id
  ), '{}'::jsonb)
  from public.milestones m
  join public.projects p on p.id = m.project_id
  where p.slug = p_slug
    and m.id = p_milestone_id
    and p.public_proofs;
$$;

comment on function public.public_milestone_proof(text, uuid) is
  'The published view of one milestone, for callers with no account. Returns null unless projects.public_proofs is true. Hand-listed fields only — never row_to_json. A milestone linked to a doqtri heading adds docSource (doc id, node label, doc version, the project id once the project is registered on chain, and the doc URL only when it is on integration_settings.doqtri_origin; never the doc title or the node id, which the page server reads with public_milestone_node_id()).';

-- Unchanged: callable by everybody, including the signed-out.
grant execute on function public.public_milestone_proof(text, uuid) to anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3. public_milestone_node_id(): the node id, for the page's server only
-- ----------------------------------------------------------------------------

-- The linked heading's positional id, under the same rule as
-- public_milestone_proof(): only for a project that publishes, and only for
-- a linked milestone; null otherwise, whatever the reason. Granted to
-- service_role alone: it is the page server's pointer to which DoqtriRegistry
-- record to read, and the page shows it only on node evidence.
create or replace function public.public_milestone_node_id(
  p_slug         text,
  p_milestone_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select l.node_id
    from public.milestone_external_links l
    join public.milestones m on m.id = l.milestone_id
    join public.projects p on p.id = m.project_id
   where p.slug = p_slug
     and m.id = p_milestone_id
     and p.public_proofs;
$$;

comment on function public.public_milestone_node_id(text, uuid) is
  'SECURITY DEFINER, service_role only. The node id of a published, linked milestone''s doqtri heading, for the public page''s server to read its DoqtriRegistry record (D-77). Null when the project does not publish or the milestone is not linked.';

revoke all on function public.public_milestone_node_id(text, uuid) from public, anon, authenticated;
grant execute on function public.public_milestone_node_id(text, uuid) to service_role;
