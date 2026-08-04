# Session plan — completing the write path

Started 2026-08-05, from `main` at `5114a13`.

Standing context is in [`progress.md`](../../progress.md); this file is only the
scope and order for this session's work.

## Scope

In:

1. Edit and delete for tasks, projects, milestones, proofs
2. The two write-only-missing fields — `stellar_proofs.wallet_address`,
   `projects.docs_url`
3. Milestone status, built to the contract's state machine
4. Deployment logging
5. Profile editor — display name, wallet address
6. Transaction verification (spec §8)
7. Board drag and drop
8. CI for lint, typecheck and `cargo test`

Out, by decision:

- **Scale UX** — bulk actions, inline create, command palette, keyboard
  navigation, the priority field and its migration. Deferred to a later session.
- **On-chain calls.** `milestone_proof` is not deployed to Testnet yet, so
  nothing in this session invokes a contract. Item 3 encodes the contract's
  rules in the app; wiring those rules to actual Soroban calls is the follow-up.

Only one item in this scope needs a migration: none. Every column and every RLS
policy already exists.

## Order

**A. Mutation foundation (items 1 + 2)** — first, because everything below
reuses its shapes.
**B. Milestone status (3)** — needs A's update action.
**C. Deployment logging (4)** — independent; reuses A's dialog patterns.
**D. Profile editor (5)** — small, and it backfills wallet addresses before the
contract session needs them.
**E. Transaction verification (6)** — independent server route.
**F. Drag and drop (7)** — self-contained, board only.
**G. CI (8)** — any time; last so it isn't rewritten as files move.

## A. Mutation foundation — building first

Four `create*` actions and `updateTaskStatus` are the entire write surface
today. This item makes every entity editable and deletable, and establishes the
patterns B–F copy.

### A1. `getProjectRole` — do this before any UI

`project_members.role` is **never read anywhere in the app.** `listMembers()`
selects from `profiles` and returns id / display name / wallet address; no query
joins `project_members`. So nothing can currently tell whether the caller may
edit a project.

This matters because the RLS layer is not uniform:

| Entity | Update / delete permitted to |
|---|---|
| tasks, milestones | any member |
| projects, deployments | **admin or owner only** |
| stellar_proofs | creator, or admin |

Without the role, an ordinary member sees an Edit control on a project, and
gets "You do not have permission to do that in this project." — `friendly()`
already maps 42501 to that string, so it fails correctly, just late and badly.

Add to `queries.ts`: `getProjectRole(projectId): Promise<MemberRole | null>`,
selecting `role` from `project_members` for the current user. Gate controls on
it. Server actions still re-check — the UI gate is courtesy, RLS is the boundary.

### A2. `AlertDialog` primitive

Not in `components/ui/` — the 21 files there don't include it. Add via shadcn so
it matches the rest; it wraps the same `radix-ui` package already in
`package.json`. Destructive confirm for every delete, naming the entity in the
prompt.

### A3. Actions

In `actions.ts`, following the existing shape exactly — zod parse → `orNull` for
empties → `friendly(error.message, error.code)` → `revalidatePath("/", "layout")`
→ `{ ok: true }`:

- `updateTask`, `updateProject`, `updateMilestone`, `updateProof`
- `deleteTask`, `deleteProject`, `deleteMilestone`, `deleteProof`

Deletes take an id and return `ActionState`, like `updateTaskStatus` — they are
not form actions.

Reuse the existing schemas; create and edit take the same fields. Two additions
while in `schemas.ts`: `walletAddress` on the proof schema, `docsUrl` on the
project schema. Both columns exist, both are already selected and rendered by
`queries.ts`, and both are absent from every form — spec §4 requires them.

`updateProject` must not accept `owner_id`, and **must not accept `slug`** —
decided: the slug is fixed after creation. It is `unique` and appears in every
project URL, so an edit would break existing links. Omit it from the edit form
and from the update payload, not merely disable the input.

### A4. Dialogs and row controls

Edit dialogs are `FormDialog` with `defaultValue` on each control — no second
dialog component. The shell's own comment says it is for "every create/edit
form"; honour that.

Radix `Dialog` unmounts its content when closed, so a reopened edit dialog
remounts and picks up fresh `defaultValue` after a revalidate. The
`formRef.reset()` on success is harmless here for that reason.

`create-dialogs.tsx` stops being an accurate name once it holds edit dialogs —
rename to `entity-dialogs.tsx` in the same commit that adds the first one.

Edit and delete hang off a row overflow menu in `rows.tsx` and the board card in
`projects/[slug]/board/page.tsx`, next to the existing `TaskStatusMenu`.

### Done when

- Every entity can be edited and deleted from its list row and its detail view
- Admin-only controls are hidden, not merely rejected, for ordinary members
- Wallet address and docs URL are writable and round-trip to their pages
- `npm run lint` and `npm run typecheck` clean
- New Playwright specs live in the **`mutations` project**, never `chromium` —
  write specs run last by project dependency because they move the counts the
  read-only specs assert

**Extend `cleanup.teardown.ts` in the same commit.** It currently deletes rows
titled `e2e task …` only. Specs that create projects, milestones, proofs or
deployments will otherwise accumulate in the shared hosted database and drift
every count assertion in the read-only suite.

## B–G, in brief

**B. Milestone status.** The enum is `proposed → submitted → approved →
rejected` — the contract's state machine, named identically to `MilestoneStatus`
in `contracts/milestone_proof/src/lib.rs`. Build the control to enforce the
contract's rules, not a free dropdown: approve or reject only from `submitted`,
approver must be the project owner, `approved` is terminal, `rejected` may be
re-submitted. Encoded in the app now, mirrored by a Soroban call later. A
permissive dropdown here lets the database reach states the contract will refuse
to reproduce.

**C. Deployment logging.** No migration: `status`, `network`, `contract_id`,
`tx_hash`, `release_notes`, `deployed_by`, `deployed_at` all exist, and
`DEPLOYMENT_STATUS` / `DEPLOYMENT_STATUS_ORDER` in `constants.ts` already carry
the labels, tones and pipeline order. Mirror the table's
`deployments_network_required` constraint in the zod schema so "anything past
`not_started` needs a network" fails inline rather than as a Postgres 23514.
Append-only; the latest row per project is the current state, which
`/deployments` already assumes.

**D. Profile editor.** No profile editing exists — `actions.ts` has no
`updateProfile` and `/settings` is a static roles legend. `profiles` has
`display_name`, `avatar_url`, `wallet_address` and an `update own` RLS policy.
Display name and wallet address only; validate the address with
`isWalletAddress()` from `stellar.ts`. This is the Supabase-user ↔ Stellar
`Address` join the contract session depends on, so capturing addresses now
avoids a backfill later.

**E. Transaction verification.** Server route over Horizon:
`GET {HORIZON_URL[network]}/transactions/{hash}`, plain REST returning JSON —
**no SDK required**, and nothing here waits on the contract deploy. `HORIZON_URL`
and `isTxHash()` are already exported from `stellar.ts` and currently unused.
Keep the fetch in a route handler; `stellar.ts` is deliberately dependency-free
and its header says on-chain work belongs server-side.

**F. Drag and drop.** Board only, using **`@dnd-kit`** — decided.
`tasks.order_index` exists and is unused, so ordering within a column comes
along with it. Reuse `updateTaskStatus` for the cross-column case rather than
writing a second path.

**G. CI.** No `.github/` exists. A workflow running `npm run lint`,
`npm run typecheck` and `cargo test` needs no secrets. Playwright needs
`E2E_EMAIL` / `E2E_PASSWORD` and the hosted database — gate it separately, do
not put it in the default PR check.

## Decisions

- **The project slug is fixed after creation.** Not in the edit form, not in the
  update payload (A3).
- **`@dnd-kit`** for the board (F).

Everything else in this plan is settled by the schema or the existing code.

## Watch out for

- This is Next.js 16 with breaking changes — `web/AGENTS.md` says read
  `node_modules/next/dist/docs/` before writing routing or caching code.
- Radix `Select` submits nothing in a native form post. Use `NativeSelect` from
  `form-dialog.tsx`; its comment explains why.
- Every page names exactly one primary object via `<Section priority>`. A second
  on the same page cancels the first out.
- Icons come from `src/lib/icons.ts`, never picked inline.
- The e2e suite runs against the real hosted database with RLS on. There are no
  fixtures, and the baseline "93 specs pass" is inherited from an earlier
  session — it has not been reproduced. Confirm it before trusting a red run.
