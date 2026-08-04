# progress

Handoff notes. Written 2026-08-05, with `main` at `a7a8ca7`.

Read this with [`README.md`](./README.md) (how the thing works) and
[`stellar-builder-task-hub-spec.md`](./stellar-builder-task-hub-spec.md) (what it
is meant to do). This file is only the delta between them.

## Where things stand

`feat/live-backend-and-brand-assets` was fast-forwarded into `main`. **Nothing is
pushed** — `origin/main` is still at `fe93996`, 16 commits behind local.

Verified this session: `npm run typecheck` and `npm run lint` both pass clean.
The Playwright suite and `cargo test` were **not** run — the suite needs
`E2E_EMAIL` / `E2E_PASSWORD` against the hosted project.

| Layer | State |
|---|---|
| Database | Ahead of the app. 7 tables, 6 enums, 28 RLS policies **including UPDATE and DELETE on every table**. Applied to a hosted project. |
| Web | Reads are complete. Writes are create-only, plus task status. |
| Contract | Built, 12 tests, never deployed. No SDK in `web/`, no link to the app. |

The important discovery for planning: **the schema does not block anything below
except priority.** Edit, delete, deployment logging, wallet address and docs URL
all have their columns and their policies already. What is missing is UI and
server actions.

## The plan

Ordered by dependency, then by spec weight. Each phase is independently
shippable and independently testable.

### 1. Edit and delete — spec §1, §2, §3

`src/lib/actions.ts` has four `create*` functions and `updateTaskStatus`. That is
the whole mutation surface. Nothing in the app can be changed after creation
except a task's status, and nothing can be deleted at all.

- Add `updateTask`, `updateProject`, `updateMilestone`, `updateProof` and the
  four matching `delete*` actions, in that file, following the shape already
  there: zod parse → `orNull` for empties → `friendly(error.message, error.code)`
  → `revalidatePath("/", "layout")` → `{ ok: true }`.
- Reuse the existing schemas in `src/lib/schemas.ts` — the create and edit
  payloads are the same fields.
- `FormDialog` (`src/components/form-dialog.tsx`) already says it is the shell
  for "every create/edit form". Edit dialogs are the same call with
  `defaultValue` on each control. Do not write a second dialog component.
- Milestone status has no control at all — `TaskStatusMenu`
  (`src/components/task-status-menu.tsx`) is the pattern to copy.

  **Read this before building that control.** The milestone enum is
  `proposed → submitted → approved → rejected` — the contract's state machine,
  named identically to `MilestoneStatus` in `contracts/milestone_proof/src/lib.rs`.
  These two are meant to be one thing: approving a milestone in the UI is the
  off-chain shadow of `approve_milestone` on-chain, and the contract enforces
  rules Postgres does not (approve only from `submitted`, approver must be the
  project owner, approved is terminal, rejected may be re-submitted).

  So a free-form milestone status dropdown is the wrong shape — it would let the
  database drift out of a state the contract will later refuse to reproduce.
  Either build the control to respect the contract's transitions from the start,
  or defer milestone status to phase 4 and ship only title/description/due-date
  editing here. The second is smaller and does not paint you into a corner.
- Delete needs a confirm step. There is no `AlertDialog` in `components/ui/` yet.

RLS to be aware of, from `20260731000002_rls.sql`: tasks and milestones are
member-editable, **projects and deployments are admin-only, proofs are own-or-admin**.
A non-admin will get `42501`, which `friendly()` already turns into "You do not
have permission to do that in this project." Prefer hiding the control over
letting it fail — `listMembers()` can tell you the caller's role.

### 2. Deployment logging — spec §5

The largest spec gap after the contract. `/deployments` and
`/projects/[slug]/deployments` render history, but there is no
`createDeployment` action and no dialog, so rows can only arrive by SQL.

Everything needed is already in the table: `status`, `network`, `contract_id`,
`tx_hash`, `release_notes`, `deployed_by`, `deployed_at`. **No migration.**

- `deploymentSchema` in `schemas.ts`, `createDeployment` in `actions.ts`,
  `CreateDeploymentDialog` in `create-dialogs.tsx`.
- Enforce the table's own rule in the schema so the failure is inline rather
  than a 23514 from Postgres: anything past `not_started` **must** carry a
  network (`deployments_network_required`).
- The status ladder is Not Started → Deployed to Testnet → Ready for Mainnet →
  Mainnet Live. The log is append-only by design; the latest row per project is
  the current state, which is what `/deployments` already assumes.

### 3. Two proof fields that can be read but never written

`stellar_proofs.wallet_address` and `projects.docs_url` are selected in
`queries.ts` (`:569`) and rendered, but they are absent from `schemas.ts`, from
the create actions and from the dialogs. Spec §4 lists both as required proof
fields. Two-line fix in each of the three places; worth doing alongside phase 1
while those files are open.

### 4. Contract integration — the differentiator

Nothing connects `contracts/milestone_proof` to the app. This is the feature
that makes the product what it claims to be, and it is entirely unbuilt.

1. Deploy to Testnet — the full command sequence is already written out in
   [`contracts/README.md`](./contracts/README.md) under "Deploy to testnet".
2. Add `MILESTONE_PROOF_CONTRACT_ID` to `web/.env.example` and `.env.local`.
3. Add `@stellar/stellar-sdk` to `web/package.json`. It is not there today.
4. Wire submit / approve / reject from the milestone UI.

`src/lib/stellar.ts` is deliberately dependency-free — strkey validation and
explorer links only, no network calls — and its header says on-chain work
belongs in a server route. Keep it that way; put the SDK behind a route handler.
`HORIZON_URL` and `SOROBAN_RPC_URL` are already exported there and currently
unused.

The DB is already shaped for this: `milestone_status` is the contract's state
machine verbatim (see phase 1), so the app's job is to keep the two in step, not
to translate between them.

Note the identity problem before starting: the contract authenticates a Stellar
`Address`, the app authenticates a Supabase user. `profiles.wallet_address`
exists (see phase 3) and is the intended join. Decide custodial vs. wallet-signed
early — it changes the whole shape of this phase.

### 5. Board drag and drop

Status moves go through a menu today. `tasks.order_index` exists and is unused,
so ordering within a column is possible in the same pass.

### 6. Scale UX

Bulk actions, inline create, command palette, keyboard navigation. The `.row`,
`.stagger` and `.focus-ring` primitives in `globals.css` exist for these.

A priority field is the **only** item in this document that needs a migration —
new enum, new column, new index, plus `filters.ts` and the filter bar.

### 7. Nice-to-have: transaction verification — spec §8

Paste a tx hash, confirm it exists, show basic info. `isTxHash()` and
`HORIZON_URL` are already in `stellar.ts`; this is a server route over Horizon.
Do it after phase 4, which will have introduced the SDK anyway.

## Repo hygiene, independent of the above

- **`password123` is in git history.** `supabase/seed.sql` carries it and the
  file was applied to the hosted project, where the accounts were reachable with
  only the publishable key. Passwords were rotated; the history rewrite
  (`git filter-repo` / BFG) has **not** been done. Doing it after pushing means
  a force-push, so **rewrite before the first push to `origin/main`** if it is
  going to happen at all.
- **No CI.** There is no `.github/`. `lint`, `typecheck`, `cargo test` and
  Playwright only ever run locally. A workflow running the first three is cheap;
  Playwright needs secrets and a hosted database, so gate it separately.
- **One skipped e2e spec**, `web/e2e/stellar-proof.spec.ts:88` — it needs a
  seeded project with no contract, which does not exist. Reason is inline.
- Write specs mutate the shared database and run after the read-only ones by
  Playwright project dependency. Adding a spec that writes outside the
  `mutations` project will move counts the read specs assert.

## Conventions worth not rediscovering

- `web/AGENTS.md`: this is Next.js 16 and it has breaking changes. Read
  `node_modules/next/dist/docs/` before writing routing or caching code.
- Radix `Select` submits nothing in a native form post. `NativeSelect` in
  `form-dialog.tsx` exists for exactly that reason — see its comment.
- `FormDialog` closes on success from inside the action, not from an effect on
  `state.ok`, because `revalidatePath` re-renders the subtree and an effect can
  miss the transition.
- Every page names exactly one primary object via `<Section priority>`. A second
  one on the same page cancels the first out.
- Icons come from `src/lib/icons.ts`, never picked inline.
- Density is settled: Linear over whitespace, 13px base, single-line rows. The
  landing page is exempt.
