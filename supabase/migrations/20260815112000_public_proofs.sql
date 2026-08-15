-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260815112000_public_proofs.sql
--
-- A milestone's proof, readable without an account.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FIXES
-- ---------------------------------------------------------------------------
-- One tester put the whole product's problem back on it: they verified a hash
-- in /proofs, said that part was genuinely good, and then said they still could
-- not send their grant contact a link that person could open — everything needs
-- a login, so they were back to sending screenshots, which is the exact thing
-- qdit exists to kill. An auditor in the same round said the same from the
-- other side: publishing the hash alone is the right call, and they still
-- cannot be given anything that is not behind a sign-in.
--
-- ---------------------------------------------------------------------------
-- HOW IT STAYS SAFE
-- ---------------------------------------------------------------------------
-- Three rules, in order of importance:
--
--   1. **Opt in, per project, off by default.** Public by accident is a leak;
--      public by a deliberate toggle is a feature. Only an owner or admin can
--      flip it, enforced by the policy already on public.projects.
--   2. **No table is exposed to `anon`.** RLS on every table stays exactly as
--      it was, and anon holds no membership row, so a direct PostgREST read
--      returns nothing. The only way in is the function below.
--   3. **The function returns a fixed, hand-listed shape.** Title, status,
--      anchor and decision fields — and nothing else. Not the description, not
--      the tasks, not who is on the project, not the internal ids. Adding a
--      column to a table must never widen what the public page shows, which is
--      why the select list here is spelled out rather than `row_to_json`.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The switch
-- ----------------------------------------------------------------------------

alter table public.projects
  add column public_proofs boolean not null default false;

comment on column public.projects.public_proofs is
  'When true, this project''s milestone proofs are readable by anyone through public.public_milestone_proof(). Off by default; only an owner or admin can change it.';


-- ----------------------------------------------------------------------------
-- 2. The reader
--
-- SECURITY DEFINER, because the whole point is to answer a caller who has no
-- membership row and therefore fails every policy involved. Same discipline as
-- the helpers in 20260731133313_rls.sql: empty search_path, every identifier
-- schema-qualified, and the arguments cannot widen the result — `p_slug` and
-- `p_milestone_id` only ever narrow it, and the `public_proofs` check is not
-- expressed in terms of either.
--
-- Returns jsonb rather than a table so the shape can gain a field without a
-- composite type migration, and null rather than raising when there is nothing
-- to show: "this project does not publish" and "no such milestone" are the same
-- answer to an anonymous caller, and telling them apart would confirm the
-- existence of private work.
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
  from public.milestones m
  join public.projects p on p.id = m.project_id
  where p.slug = p_slug
    and m.id = p_milestone_id
    and p.public_proofs;
$$;

comment on function public.public_milestone_proof(text, uuid) is
  'The published view of one milestone, for callers with no account. Returns null unless projects.public_proofs is true. Hand-listed fields only — never row_to_json.';

-- Callable by everybody, including the signed-out. That is the feature.
grant execute on function public.public_milestone_proof(text, uuid) to anon, authenticated, service_role;
