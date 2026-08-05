# progress

Handoff notes. Last updated 2026-08-05, end of the gap-closing session.

Read this with [`README.md`](./README.md) (how the thing works) and
[`stellar-builder-task-hub-spec.md`](./stellar-builder-task-hub-spec.md) (what it
is meant to do). This file is only the delta between them.

[`gaps.md`](./gaps.md) is the audited list of what is still missing, checked
feature by feature against the spec. Start there when picking up work.

## Where things stand

`main` is the only branch and is in sync with `origin`.

Verified at the end of this session:

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run build` | pass, with only CI's placeholder env |
| `npm test` (Vitest, new) | **91 passed** |
| `npx playwright test` | **93 passed, 1 failed, 1 skipped, 13 did not run** |
| `cargo test` | 12 passed (unchanged, not re-run) |

**Read the Playwright line carefully before comparing it to the old 102/1.**
The one failure is `board.spec.ts` → "each column counts its own cards", and it
is *not* a regression: it was reproduced by stashing every local change and
running against unmodified `cfd75d9`. The hosted database has drifted from
`e2e/seed.ts` — `BOARD_COUNTS.todo` expects 2 todo tasks and there is 1.

That drift is also why 13 specs "did not run": `mutations` depends on `chromium`
and `edits` depends on `mutations`, so a single red test in `chromium` gates
both write projects. Those 13 were run separately and **12 of 13 pass**; the
thirteenth passes in isolation and fails only when `--no-deps` strips the
ordering that stops two write specs racing on one database. Fix the seed and the
suite should read 106/1.

| Layer | State |
|---|---|
| Database | **Still not one migration.** 7 tables, 6 enums, 28 RLS policies. |
| Web | Full CRUD, role-gated, plus member management, error boundaries, board paging and a proof rollup. |
| Contract | Built, 12 tests, **still never deployed.** No SDK in `web/`. |

## What this session built

Closing [`gaps.md`](./gaps.md). Everything except contract integration.

- **Member management** (spec §10) — roster at `/projects/[slug]/members`, with
  add / change-role / remove, admin-gated. Two guards live in the actions rather
  than the database: an admin cannot touch the owner's row, and cannot change
  their own role. Either would lock a project's administration out for good,
  since the bootstrap trigger only fires at project creation.
- **A validation bypass fixed.** `createProof` validated with `proofSchema` but
  left `walletAddress` out of the parse and inserted it anyway, while
  `updateProof` validated it. The column has no CHECK behind it, so unvalidated
  strkeys were reaching the database.
- **Error boundaries** — six files. Next 16 renamed `reset` to
  `unstable_retry`; they are not equivalent.
- **Vitest**, 91 tests over the milestone state machine, the filter round trip
  and the strkey validators. **In CI**, unlike Playwright, because it needs
  neither secrets nor a database.
- **Board paging and touch drag**, dashboard proof panel, docs URL, proof signer
  and avatars — the remaining display and interaction gaps.

The milestone rules in `constants.ts` were **cross-checked against the Rust
contract by hand** and agree. One nuance: on-chain, re-submitting an already
`Submitted` milestone is legal and overwrites the proof hash; in the app it is a
no-op. Harmless until the app starts attaching a hash on transition.

## What the previous session built

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

### 0. Restore the e2e seed — small, and currently hiding 13 specs

`e2e/seed.ts` says the board has 2 todo tasks; the hosted database has 1. One
red test in `chromium` gates both write projects through the `mutations` →
`edits` dependency chain, so 13 write specs never run in a normal invocation.
Either restore the missing task or correct `seed.ts`. Do this before trusting
any future suite number.

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
- **Next 16 renamed the error boundary's `reset` prop to `unstable_retry`**, and
  they are not interchangeable: `unstable_retry` re-fetches and re-renders the
  segment, `reset` only clears the boundary — which, for a failed read, renders
  the same failure again. Also `error.tsx` does *not* wrap the layout in its own
  segment, so a throw in `(app)/layout.tsx` skips `(app)/error.tsx` and lands in
  the root one.
- **`npx playwright test --no-deps` is not a shortcut, it is a footgun.** The
  `edits`-depends-on-`mutations` chain is the *only* thing serialising two write
  specs against one shared database. Stripping it made them interleave, left
  rows behind, and turned a dozen count-based assertions red across specs that
  had nothing to do with the change. If it happens, `npx playwright test
  --project=cleanup` puts it right.
- **A Playwright locator keyed to a control whose label changes stops resolving
  the moment the test acts on it.** `HashLink`'s copy button relabels itself to
  "Copied", so a chip located by `filter({ has: … "Copy transaction" })` matched
  nothing immediately after the click. Anchor on something static — the explorer
  link's `aria-label` is a good handle.
- **Adding a `<Section href>` adds a "View all" link**, and `dashboard.spec.ts`
  counts them. Panels are cheap to add and each one moves that number.

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
