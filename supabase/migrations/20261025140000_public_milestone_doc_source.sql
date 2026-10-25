-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261025140000_public_milestone_doc_source.sql
--
-- The doqtri plan a published milestone came from, on its public page
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
--   docUrl       project_doc_links.doc_url, where "Open in doqtri" goes
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
-- page names the plan by its heading and version, not by its title.
--
-- Nor who linked it, the link ids, the project id, or whether a doqtri
-- connection still keeps the doc link alive (doc_link_connections). Those are
-- for project members; the WP-2.6 doc card shows them inside the app.
--
-- `docUrl` is held to the column's CHECK (a plain https URL). Whether it is
-- on doqtri's origin (D-45, D-72) is deployment config (DOQTRI_ORIGIN) that
-- the database does not have, so the public page drops a URL that is not
-- (getPublicProof() in web/src/lib/queries.ts) and shows no link for it. The
-- URL is written only through link_project_doc(), by a project admin (D-48),
-- and published only once an owner or admin turned public_proofs on, so the
-- function sends no more than the project chose to publish.
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
  -- WP-3.2: the doqtri heading this milestone came from. No row, no key.
  -- The doc link always exists for a link row (its composite foreign key);
  -- the inner join only reads its URL. Never its title (see the header).
  || coalesce((
    select jsonb_build_object(
      'docSource', jsonb_build_object(
        'docId',      l.doc_id,
        'nodeId',     l.node_id,
        'nodeLabel',  l.node_label,
        'docVersion', l.doc_version,
        'docUrl',     d.doc_url
      )
    )
    from public.milestone_external_links l
    join public.project_doc_links d
      on d.project_id = l.project_id
     and d.doc_id = l.doc_id
    where l.milestone_id = m.id
  ), '{}'::jsonb)
  from public.milestones m
  join public.projects p on p.id = m.project_id
  where p.slug = p_slug
    and m.id = p_milestone_id
    and p.public_proofs;
$$;

comment on function public.public_milestone_proof(text, uuid) is
  'The published view of one milestone, for callers with no account. Returns null unless projects.public_proofs is true. Hand-listed fields only — never row_to_json. A milestone linked to a doqtri heading adds docSource (doc id, node id and label, doc version, doc URL; never the doc title).';

-- Unchanged: callable by everybody, including the signed-out.
grant execute on function public.public_milestone_proof(text, uuid) to anon, authenticated, service_role;
