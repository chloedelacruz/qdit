-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260809000005_chain_anchors.sql
--
-- On-chain anchoring for the `milestone_proof` Soroban contract.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS RECORDS, AND WHAT IT DOES NOT
-- ---------------------------------------------------------------------------
-- The ledger is the source of truth for what was anchored. Nothing here is
-- authoritative: every row is a local, verifiable pointer at a transaction
-- anyone can look up, kept so the app can render anchor state without an RPC
-- round trip per row.
--
-- That is why the shape splits in two:
--
--   * Registering a project on chain happens once and is a property of the
--     project, so it is columns on public.projects.
--   * Submitting, approving and rejecting happen repeatedly and each produces
--     a transaction, so they are rows in public.milestone_anchors — append
--     only, like public.deployments.
--
-- `milestones.status` is deliberately NOT touched by anchoring. Moving a
-- milestone through the approval flow and anchoring it are separate acts; the
-- two can legitimately disagree (a milestone approved in the app but not yet
-- anchored, or anchored under an older proof hash), and the UI shows both.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Enum
-- ----------------------------------------------------------------------------

-- The three milestone_proof entry points that write. Named for the contract
-- function, not the resulting status, because that is what the tx invoked.
-- `register` is absent on purpose: it is a project-level act, recorded on
-- public.projects rather than as an anchor row.
create type public.anchor_action as enum (
  'submit',
  'approve',
  'reject'
);


-- ----------------------------------------------------------------------------
-- 2. Project registration
--
-- A project must be registered on chain before any of its milestones can be
-- anchored: submit_milestone_proof errors with ProjectNotFound (2) otherwise.
-- ----------------------------------------------------------------------------

alter table public.projects
  add column chain_contract_id     text,
  add column chain_network         public.stellar_network,
  add column chain_owner_address   text,
  add column chain_registered_tx   text,
  add column chain_registered_at   timestamptz,
  -- Registration is all-or-nothing: a contract id without the tx that proves
  -- it was written is a claim, not a record.
  add constraint projects_chain_registration_complete check (
    (chain_contract_id is null
      and chain_network is null
      and chain_owner_address is null
      and chain_registered_tx is null
      and chain_registered_at is null)
    or
    (chain_contract_id is not null
      and chain_network is not null
      and chain_owner_address is not null
      and chain_registered_tx is not null
      and chain_registered_at is not null)
  );

comment on column public.projects.chain_contract_id is
  'milestone_proof contract this project is registered against. Stored per project, not read from env, so an anchor stays verifiable after the app is repointed at a new deployment.';
comment on column public.projects.chain_owner_address is
  'Stellar account that called create_project_ref. Only this address can approve or reject on chain, whatever public.project_members says.';


-- ----------------------------------------------------------------------------
-- 3. milestone_anchors
-- ----------------------------------------------------------------------------

create table public.milestone_anchors (
  id             uuid primary key default gen_random_uuid(),
  milestone_id   uuid not null references public.milestones (id) on delete cascade,
  -- Denormalized from the milestone so every RLS policy and filter can reach
  -- the project without a join, matching stellar_proofs and deployments.
  project_id     uuid not null references public.projects (id) on delete cascade,
  action         public.anchor_action not null,
  -- SHA-256 of the canonical milestone content, as passed to the contract.
  -- Only `submit` carries one: approve and reject attest to a hash that is
  -- already on chain rather than supplying a new one.
  proof_hash     text,
  -- MilestoneRecord.version as reported by the contract after the call.
  version        integer not null check (version >= 1),
  contract_id    text not null,
  network        public.stellar_network not null default 'testnet',
  tx_hash        text not null,
  -- Read from the submitted transaction, never from profiles.wallet_address:
  -- the signature is the proof, the profile is a convenience field.
  signer_address text not null,
  ledger         bigint,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint milestone_anchors_proof_hash_shape check (
    proof_hash is null or proof_hash ~ '^[0-9a-f]{64}$'
  ),
  -- A submission without its hash records nothing worth keeping; an approval
  -- with one implies the contract stored it, and it does not.
  constraint milestone_anchors_hash_matches_action check (
    (action = 'submit' and proof_hash is not null)
    or (action <> 'submit' and proof_hash is null)
  ),
  constraint milestone_anchors_tx_hash_shape check (tx_hash ~ '^[0-9a-f]{64}$'),
  -- Replaying one transaction into two rows would double-count the history.
  constraint milestone_anchors_tx_hash_unique unique (tx_hash)
);

comment on table public.milestone_anchors is
  'Append-only log of milestone_proof transactions. Each row points at a ledger entry; the ledger, not this table, is authoritative.';


-- ----------------------------------------------------------------------------
-- 4. Indexes
-- ----------------------------------------------------------------------------

create index milestone_anchors_milestone_id_idx on public.milestone_anchors (milestone_id);
create index milestone_anchors_project_id_idx   on public.milestone_anchors (project_id);
create index milestone_anchors_created_by_idx   on public.milestone_anchors (created_by);
-- Backs "latest anchor for this milestone", which is what every row renders.
create index milestone_anchors_latest_idx
  on public.milestone_anchors (milestone_id, created_at desc);
-- tx_hash needs no index of its own: the unique constraint already built one.

-- Only registered projects are ever queried by contract id.
create index projects_chain_contract_id_idx on public.projects (chain_contract_id)
  where chain_contract_id is not null;


-- ----------------------------------------------------------------------------
-- 5. Row Level Security
--
-- Same derivation as every other table: membership via the SECURITY DEFINER
-- helpers in 20260731000002_rls.sql.
--
-- There is no UPDATE policy and no DELETE policy, and that is the point. A row
-- here asserts "this transaction happened". Editing one makes it lie, and
-- deleting one does not delete the ledger entry it names.
-- ----------------------------------------------------------------------------

alter table public.milestone_anchors enable row level security;

create policy "milestone_anchors: read as member"
  on public.milestone_anchors
  for select
  to authenticated
  using (public.is_project_member(project_id, 'viewer'));

-- Contributor-level, matching who may move a milestone in the app. The chain
-- enforces the rule that actually matters — approve and reject require the
-- registered owner's signature — so this policy does not restate it. A member
-- who forged an approve row would be pointing at a transaction that either
-- does not exist or failed, and the tx hash is checkable.
create policy "milestone_anchors: insert as member"
  on public.milestone_anchors
  for insert
  to authenticated
  with check (
    public.is_project_member(project_id, 'member')
    and created_by = (select auth.uid())
  );
