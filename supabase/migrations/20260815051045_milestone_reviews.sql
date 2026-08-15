-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260815051045_milestone_reviews.sql
--
-- Why a decision was made, kept next to the record that it was made.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FIXES
-- ---------------------------------------------------------------------------
-- Four of twenty testers said the same thing in different words: a rejection
-- arrives as a red chip and nothing else. One of them had to message the
-- project owner to find out what was wrong; another pointed out the sharper
-- version of the problem — an anchored rejection is a permanent, public record
-- that someone failed, paid for with a fee, with nothing anywhere saying why.
--
-- ---------------------------------------------------------------------------
-- WHY OFF CHAIN, AND WHAT THAT COSTS
-- ---------------------------------------------------------------------------
-- `reject_milestone` takes no memo. Adding one means a new WASM, a new contract
-- id, and re-registering every project that has already anchored — a migration
-- whose price rises with every anchor written. So the split is deliberate and
-- must be stated plainly wherever it shows: **the ledger records that a
-- decision happened and which key signed it; this table records why.** The
-- reason is as trustworthy as the database, which is exactly as trustworthy as
-- the milestone content the proof hash covers.
--
-- If the reason ever needs to be tamper-evident, the cheap upgrade is to fold
-- it into the canonical content the next submission hashes — no redeploy, no
-- contract change. It is not folded in today because doing so retroactively
-- would invalidate hashes already on chain.
--
-- ---------------------------------------------------------------------------
-- WHY A TABLE AND NOT A COLUMN
-- ---------------------------------------------------------------------------
-- Append-only, one row per decision, like public.milestone_anchors. A column on
-- public.milestones would be overwritten by the next decision, and the sequence
-- is the part with value: a tester described wanting to show a funder that v1
-- was rejected on one date and v2 approved on another. That story is a list.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------

create table public.milestone_reviews (
  id           uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones (id) on delete cascade,
  -- Denormalized so RLS reaches the project without a join, matching
  -- public.milestone_anchors and public.stellar_proofs.
  project_id   uuid not null references public.projects (id) on delete cascade,

  -- Both ends of the move. `from_status` makes the row readable on its own
  -- ("submitted → rejected") without replaying every earlier row.
  from_status  public.milestone_status not null,
  to_status    public.milestone_status not null,

  -- Free text, written by whoever made the call. Required for a rejection and
  -- optional otherwise — enforced below rather than by the client, because the
  -- client is not the boundary.
  reason       text,

  -- auth.users, not profiles: a reviewer whose profile row is gone is still the
  -- person who decided, and losing the attribution would be losing the point.
  reviewer_id  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),

  -- A decision that does not move anything is not a decision.
  constraint milestone_reviews_is_a_transition check (from_status <> to_status),

  -- The whole reason this table exists. A rejection without a reason is the
  -- thing testers complained about, so the database refuses to store one.
  constraint milestone_reviews_rejection_has_reason check (
    to_status <> 'rejected'
    or coalesce(btrim(reason), '') <> ''
  ),

  -- Long enough for a real explanation, short enough not to be a document.
  constraint milestone_reviews_reason_length check (
    reason is null or char_length(btrim(reason)) between 1 and 2000
  )
);

comment on table public.milestone_reviews is
  'Append-only log of milestone status decisions and the reason given. The ledger records that a decision happened; this records why.';
comment on column public.milestone_reviews.reason is
  'Required when to_status is rejected. Off chain by design — see the migration header.';


-- ----------------------------------------------------------------------------
-- 2. Indexes
-- ----------------------------------------------------------------------------

-- Backs "the decisions on this milestone, newest first", which is how every
-- milestone view reads it.
create index milestone_reviews_milestone_idx
  on public.milestone_reviews (milestone_id, created_at desc);
create index milestone_reviews_project_id_idx on public.milestone_reviews (project_id);
create index milestone_reviews_reviewer_id_idx on public.milestone_reviews (reviewer_id);


-- ----------------------------------------------------------------------------
-- 3. Row Level Security
--
-- No UPDATE and no DELETE policy, for the same reason public.milestone_anchors
-- has none: the row is a record of something that happened. Editing a reason
-- after the fact makes it a different reason, and the person it was addressed
-- to has already read the first one.
-- ----------------------------------------------------------------------------

alter table public.milestone_reviews enable row level security;

create policy "milestone_reviews: read as member"
  on public.milestone_reviews
  for select
  to authenticated
  using (public.is_project_member(project_id, 'viewer'));

-- Contributor-level, matching who may move a milestone at all. Approve and
-- reject are the owner's — the app enforces that on the transition itself and
-- the contract enforces it on the signature, so restating it here would put the
-- same rule in a third place to drift out of step with.
create policy "milestone_reviews: insert as member"
  on public.milestone_reviews
  for insert
  to authenticated
  with check (
    public.is_project_member(project_id, 'member')
    and reviewer_id = (select auth.uid())
  );
