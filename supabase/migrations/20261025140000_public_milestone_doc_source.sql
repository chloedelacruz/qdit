-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261025140000_public_milestone_doc_source.sql
--
-- The doqtri plan a published milestone is linked to, on its public page
-- (WP-3.2), on top of 20260815051120_public_proofs.sql and
-- 20261024120000_integration_links.sql.
--
-- ---------------------------------------------------------------------------
-- WHAT IS ADDED
-- ---------------------------------------------------------------------------
-- public_milestone_proof() gains one key, `docSource`, for a milestone that
-- has a milestone_external_links row, and only for such a milestone:
--
--   docId        doqtri's documents.id, the DoqtriRegistry key the public
--                page checks the version against
--   nodeId       the heading's positional id (`h4`)
--   nodeLabel    the heading text. Always equal to the milestone title
--                (D-12, kept equal by trigger), which the page already
--                publishes, so it says nothing new
--   docVersion   DoqtriRegistry Document.version the link was last written
--                against, or null when the doc was not anchored then
--   projectId    projects.id, but only for a project registered on chain
--                (chain_contract_id set), else null. Not shown on the page:
--                the page needs it to check that the heading's on-chain
--                artifact_ref names this project as well as this milestone
--                (contract section 12), and to read the milestone's record
--                with get_milestone_status(project_id, milestone_id). For a
--                registered project the id is already public on chain: it
--                keys every milestone_proof record and is in every submit,
--                approve and reject event and every artifact_ref. A project
--                that never registered has nothing on chain to check, so its
--                id stays off the page. Contract v1.1.0 section 12 names
--                doc_id, node_id and doc_version as what WP-3.2 adds; this
--                key is for the page's check only and is raised with the
--                contract owner for a v1.1.x line.
--
-- An unlinked milestone gets no `docSource` key at all, not a null one: the
-- function's answer for it is the same jsonb as before, key for key, so the
-- public page for a milestone that never came from doqtri does not change.
--
-- ---------------------------------------------------------------------------
-- WHAT IS NOT
-- ---------------------------------------------------------------------------
-- The doc's title. project_doc_links.doc_title (and the copy of it on the
-- link row) is doqtri's private note title: doqtri publishes a doc's
-- headings only when its owner opts in, and never through qdit. The public
-- page names the plan by its doc id, not by its title.
--
-- Nor the stored doc_url (contract section 12). It passed only the D-72
-- prefix check, and whoever may write the link (an OAuth client with the
-- role, or a project admin through link_project_doc(), section 2) may point
-- it at any doqtri page. The public page builds its doqtri link itself, from
-- DOQTRI_ORIGIN and docId (publicDocLink() in web/src/lib/doqtri-origin.ts),
-- so the URL has no reason to leave the database.
--
-- Nor who linked it, the link ids, an unregistered project's id, or whether
-- a doqtri connection still keeps the doc link alive (doc_link_connections).
-- Those are for project members; the WP-2.6 doc card shows them inside the
-- app.
--
-- Everything sent is the link row's, and a link row is not evidence of what
-- doqtri planned (contract sections 1 and 12): a project member's own
-- session may write it. The page uses it only to know which DoqtriRegistry
-- records to read, and shows the node id only when the node's on-chain
-- record names this project and milestone.
--
-- Same rules as the original: SECURITY DEFINER with an empty search_path,
-- hand-listed fields, null for every "nothing to show". OAuth clients need no
-- guard here: an app can already read both link tables (D-03), and anon gets
-- the same answer (20261024110000_oauth_client_guards.sql's list of definer
-- functions).
-- ============================================================================


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
  -- WP-3.2: the doqtri heading this milestone is linked to. No row, no key.
  -- Never the doc's title or URL (see the header).
  || coalesce((
    select jsonb_build_object(
      'docSource', jsonb_build_object(
        'docId',      l.doc_id,
        'nodeId',     l.node_id,
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
  'The published view of one milestone, for callers with no account. Returns null unless projects.public_proofs is true. Hand-listed fields only — never row_to_json. A milestone linked to a doqtri heading adds docSource (doc id, node id and label, doc version, and the project id once the project is registered on chain; never the doc title or the stored doc URL).';

-- Unchanged: callable by everybody, including the signed-out.
grant execute on function public.public_milestone_proof(text, uuid) to anon, authenticated, service_role;
