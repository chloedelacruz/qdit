# Plan: the app on `milestone_proof_v2` (WP-4.5, D-124)

Status: **proposal, not started.** Nothing here is built. It is written so the
owner of WP-4.5 can accept, cut or reorder it before any code lands.

## Why

`milestone_proof_v2` is deployed on testnet (`CAIBMWYD…FNB`, see
[`contracts/milestone_proof_v2/DEPLOYMENTS.md`](./DEPLOYMENTS.md)),
has 14 calls covered by the harness, a Merkle batch benchmark and a verify
library (`@qdit/verify`). The app still anchors every milestone through v1
(`CBP3NKXC…OHVG`), so none of what v2 adds reaches a user:

- **Team roles on chain.** v1 knows one owner address per project; v2 keeps a
  roster of Submitters and Approvers (up to 20).
- **M-of-N approval.** A milestone reaches Approved only when `threshold`
  approvers have signed the same proof hash (D-108).
- **Batch anchoring.** One `anchor_batch` call commits a Merkle root over many
  milestones, which the benchmark shows is far cheaper per milestone than one
  call each.

The [v2 README](./README.md) currently says *"the app and doqtri stay on v1"*. This plan is
the proposal to change that for the app. doqtri stays on v1 until its own
WP says otherwise.

## Principles

1. **v1 records stay readable forever.** Nothing migrates an anchor between
   contracts. A v1 anchor is checked against v1, a v2 anchor against v2.
2. **A project picks its contract once.** New projects register on v2; existing
   projects stay on v1 unless their owner opts in (step 5). There is no
   project anchored on both.
3. **Anchoring stays additive** (the README's existing rule): the app status
   and the chain can disagree, and the chain is authoritative for what it holds.
4. **Every step ships alone** behind `NEXT_PUBLIC_MILESTONE_PROOF_V2_CONTRACT_ID`.
   Unset, the app behaves exactly as today.

## Steps

Each step is one PR to `main` (which deploys), with its own migration where
noted. Migrations are pushed with the Supabase CLI so [`gaps.md`](../../gaps.md) §2 stays true.

### 1. Read v2 (no writes)

- Add the v2 contract id env var and a `chain_version` column on `projects`
  (`1` default, `2` for v2 projects). Migration: one column, no backfill.
- `lib/chain/v2.ts`: read-only wrappers over `@qdit/milestone-proof-v2-bindings`
  (`get_project`, `get_members`, `get_milestone_status`).
- The public proof page (`/p/[slug]/[milestone]`) shows, for a v2 project,
  the approvers and threshold read from chain via `verifyMilestone` from
  `@qdit/verify`.

### 2. Register projects on v2

- `prepareProjectRegistration` / `submitProjectRegistration` gain a v2 path:
  `create_project(project_id, owner, threshold)`, then `add_member` for the
  owner with the role they choose. The browser signs each, as today.
- Threshold defaults to 1, so a one-person team works exactly like v1.
- Roster sync: when a workspace member links a wallet and holds an app role
  that maps to Submitter or Approver, the project page offers the owner an
  **Add to chain roster** action (`add_member`). The database role and the
  chain role can differ; the UI shows both and the chain wins for anchoring.

### 3. Submit, approve and reject through v2

- `prepareMilestoneAnchor` picks the method set by `projects.chain_version`.
  v2 calls carry the approver's address and the proof hash they reviewed
  (`approve_milestone(project_id, milestone_id, approver, proof_hash)`).
- `milestone_anchors` gains `approvals_needed` and `approvals_count`, read
  back after each approval so the row shows "2 of 3 approvals".
- The milestone row shows who on the roster still needs to sign.

### 4. Batch anchoring

- A project action **Anchor approved milestones as a batch** builds the tree
  with `@qdit/merkle`, calls `anchor_batch`, stores one `milestone_batches` row
  (root, leaf count, tx hash) and one inclusion proof per milestone.
- Each milestone's public page links its `qdit-inclusion-proof/v2` file, and
  `/verify` accepts that file next to a tx hash (`verifyInclusion`,
  `onChain: true`).

### 5. Opt-in move for existing projects

- The owner of a v1 project can **Start a v2 roster**: register the same
  project id on v2 and flip `chain_version` to 2. Earlier anchors stay v1 and
  keep verifying against v1; the milestone page labels each anchor's contract.
- No automatic move. A project whose owner key is lost stays on v1 (gaps.md §3).

## Open decisions for the WP owner

1. **Mainnet.** v2 is testnet only. Does the app turn v2 on for testnet
   projects first and wait for a mainnet deploy, or wait for both?
2. **Default threshold** for new projects: 1, or the number of approvers on
   the team at registration (capped by D-104)?
3. **Who may batch.** Any Submitter (what the contract allows), or only the
   owner in the UI?
4. **Owner transfer.** v2's `transfer_project_owner` needs both signatures,
   the same two-signer shape gaps.md §1 describes for v1. In scope here, or
   still CLI only?
5. **Fees.** Does qdit sponsor any v2 call (fee bump), or does every signer
   pay, as today?

## Testing

- Vitest for each new action with the mocked RPC the v1 client tests use
  (`client.submit.test.ts`), plus `@qdit/verify`'s fake RPC for reads.
- The v2 harness (`packages/v2-harness`) re-run against the app's contract id
  before step 3 ships.
- Playwright cannot drive a wallet (gaps.md §4), so each step adds a manual
  testnet walkthrough to `docs/evidence/`, like the 2026-11-19 batch evidence.

## Out of scope

- doqtri's own move to v2.
- Any change to v1 or its deployed contract.
- Deleting or rewriting existing `milestone_anchors` rows.
