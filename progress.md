# progress

Handoff notes. Last updated 2026-08-05, end of the write-path session.

Read this with [`README.md`](./README.md) (how the thing works) and
[`stellar-builder-task-hub-spec.md`](./stellar-builder-task-hub-spec.md) (what it
is meant to do). This file is only the delta between them.

## Where things stand

`main` is the only branch and is in sync with `origin`.

Verified at the end of this session, all four run locally and clean:

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run build` | pass, also with `.env` removed and only CI's placeholders |
| `npx playwright test` | **102 passed, 1 skipped** |
| `cargo test` | 12 passed |

The Playwright number is now a *reproduced* baseline, not an inherited claim.
The earlier "93 pass" figure had never been re-run; treat 102/1 as the number to
compare against.

| Layer | State |
|---|---|
| Database | Unchanged this session — **not one migration was needed.** 7 tables, 6 enums, 28 RLS policies. |
| Web | Full CRUD on every entity, role-gated. Deployment logging, profile editing, board drag-and-drop, tx verification. |
| Contract | Built, 12 tests, **still never deployed.** No SDK in `web/`. |

## What this session built

All of it on the existing schema. The database was already ahead of the app.

- **Edit and delete** for tasks, projects, milestones and proofs. `actions.ts`
  went from four `create*` plus a status change to the full set.
- **Role gating.** `project_members.role` was read by nothing before;
  `getProjectRole` / `listProjectRoles` now drive which controls render, because
  the policies are not uniform (tasks and milestones: any member; projects and
  deployments: admin; proofs: author or admin).
- **Milestone approval flow** enforcing the contract's state machine —
  `proposed → submitted → approved|rejected`, approve/reject reserved to the
  project owner, approved terminal. Not a dropdown, deliberately; see below.
- **Deployment logging**, append-only, with the network-required rule mirrored
  from the CHECK constraint so it fails inline rather than as a 23514.
- **`wallet_address` and `docs_url`**, which were readable but unwritable.
- **Profile editing** — display name and wallet address, on `/settings`.
- **Board drag and drop** with `@dnd-kit`, writing `order_index` for the whole
  destination column.
- **Transaction verification** (spec §8) — a Horizon REST call behind the auth
  gate, no SDK.
- **CI** at `.github/workflows/ci.yml`: lint, typecheck, build, and
  fmt/clippy/test for the contract.
- **E2E coverage** for all of the above in `e2e/edit-delete.spec.ts`.

## What is left

### 1. Contract integration — the only thing that still blocks the pitch

Everything else in the spec is built. This is not, and it is the differentiator.

1. Deploy `milestone_proof` to Testnet. The commands are already written out in
   [`contracts/README.md`](./contracts/README.md).
2. Add `MILESTONE_PROOF_CONTRACT_ID` to `.env.example` and `.env`.
3. Add `@stellar/stellar-sdk` to `web/package.json` — still absent.
4. Wire submit/approve/reject to the chain.

**The groundwork is done.** `updateMilestoneStatus` in `actions.ts` already
validates every rule the contract enforces, in the order the contract enforces
them. The on-chain call goes inside that function, after the checks pass and
before the row is written. `profiles.wallet_address` is now capturable, so
accounts can be linked before this starts rather than backfilled after.

Decide custodial vs. wallet-signed first — it changes the shape of everything
else here.

### 2. Scale UX — deferred by decision, not blocked

Bulk actions, inline create, command palette, keyboard navigation, and a
priority field. **The priority field is the only remaining item in the whole
project that needs a migration.** The `.row`, `.stagger` and `.focus-ring`
primitives exist for the rest.

### 3. Smaller things

- The **dashboard** rows are deliberately read-only. It is a capped rollup and
  every entity is editable from its own list; adding menus there was judged
  noise on a scanning surface. Revisit if it feels inconsistent in use.
- **Deployment rows cannot be edited**, only deleted, because the log is
  append-only. Recording a correction is the intended path.
- One spec is still skipped: `e2e/stellar-proof.spec.ts` needs a seeded project
  with no contract, which does not exist.
- Playwright is still **not** in CI, for the reasons written inline in the
  workflow: it needs secrets and a database two concurrent runs would fight over.

## Things that bit, and will bite again

Each of these cost real debugging time this session. They are all still true.

- **React bubbles portal events along the React tree, not the DOM tree.** A
  dialog rendered inside a row that intercepts clicks will have its form submits
  cancelled by that row's `preventDefault`. This silently produced a dialog that
  never wrote anything. `row-actions.tsx` carries the explanation; the rule is
  `stopPropagation` on the wrapper, `preventDefault` only on the trigger that is
  genuinely inside the anchor.
- **dnd-kit sets `role="button"` on every draggable**, replacing whatever
  semantic role the element had. It broke five specs by making board cards stop
  being `article`s. Override via `useSortable({ attributes: { role } })`.
- **Playwright's `fullyParallel` puts separate files on separate workers** even
  when each file is internally serial. Two write specs against one shared
  database will interleave. Cross-file ordering is only available through
  project `dependencies` — hence the `edits` project depending on `mutations`.
  **Any new write spec needs its own project, or it must go in an existing write
  file.** It also needs adding to `chromium`'s `testIgnore`, or it runs twice.
- **A modal makes the rest of the page `aria-hidden`**, so `getByRole` cannot
  see anything behind an open dialog. Use a CSS locator to assert on what is
  underneath.
- `npm install` run from the repo root instead of `web/` still appears to work,
  because Node resolves upward. CI and a clean checkout will not have the
  package. Install from `web/`.

## Conventions worth not rediscovering

- `web/AGENTS.md`: this is Next.js 16 and it has breaking changes. Read
  `node_modules/next/dist/docs/` before writing routing or caching code.
- Radix `Select` submits nothing in a native form post. `NativeSelect` in
  `form-dialog.tsx` exists for exactly that reason.
- `FormDialog` closes on success from inside the action, not from an effect on
  `state.ok`, because `revalidatePath` re-renders the subtree and an effect can
  miss the transition. It takes optional `open`/`onOpenChange` for dialogs
  driven from a row menu.
- Create and edit share one field set per entity in `entity-dialogs.tsx`. A
  field added to one and forgotten in the other is the drift that file prevents.
- Server components cannot pass a render prop to a client component, which is
  why `entity-row-actions.tsx` exists between `rows.tsx` and `row-actions.tsx`.
- Every page names exactly one primary object via `<Section priority>`. A second
  on the same page cancels the first out.
- Icons come from `src/lib/icons.ts`, never picked inline.
- Density is settled: Linear over whitespace, 13px base, single-line rows. The
  landing page is exempt.

## Security note

`password123` is in git history, in `fe93996`, via `supabase/seed.sql`. The
passwords have been rotated and **the repo is private**, which is what makes
this low priority rather than urgent. The history rewrite has not been done and
would now need a force-push. Judgement call whether it is worth it; do not
re-raise it as a blocker. The live rule that still matters: **never apply
`seed.sql` to a hosted project.**
