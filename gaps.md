# What is still missing

Audited 2026-08-05 against `main` at `cfd75d9`, then re-audited after the gap
session that closed most of it. Companion to [`progress.md`](./progress.md),
which covers where things stand; this file is only what is absent.

Each item says how it was checked, so a stale entry can be re-verified rather
than trusted.

## Spec compliance

| Spec section | State |
|---|---|
| §1 Project management | **Complete** — create, edit, delete, overview, status |
| §2 Task board | **Complete** — create, edit, assign, due date, move by menu or drag, paged |
| §3 Milestone tracking | **Complete** — create, edit, link tasks, approval flow |
| §4 Stellar proof fields | **Complete** — all fields captured *and* displayed |
| §5 Deployment tracking | **Complete** — status ladder, release notes, append-only history |
| §6 Dashboard | **Complete** — proof rollup added |
| §7 Search / filter | **Complete** — status, network, milestone, assignee, all in URL state |
| §8 Transaction verification | **Complete** — Horizon REST, behind the auth gate |
| §9 Contract link helper | **Complete** — `stellar.ts`, explorer URLs, `HashLink` |
| §10 Team workspace | **Partial** — roster and role management ship; onboarding a stranger does not (see 2.1) |

Every off-chain gap from the previous audit is closed except §10's bootstrap
problem. The blocker below was never off-chain work in the first place.

---

## 1. The blocker

### 1.1 Contract integration

The product's differentiator, and still entirely unwired. `milestone_proof` is
built and tested and has never been deployed; `@stellar/stellar-sdk` is not in
`web/package.json`; nothing in the app talks to a chain.

*Checked: `grep stellar-sdk web/package.json` → absent; no `MILESTONE_PROOF_CONTRACT_ID` in `.env.example`.*

The groundwork is done and has now been locked in by tests.
`updateMilestoneStatus` in `src/lib/actions.ts` validates every rule the
contract enforces, in the order it enforces them, and `constants.test.ts`
asserts those rules directly. The chain call goes inside that function, after
the checks pass and before the row is written.

**The TypeScript rules and the Rust contract were cross-checked by hand this
session and agree.** One nuance is worth carrying forward: on-chain,
`submit_milestone_proof` only rejects a milestone that is already `Approved`, so
re-submitting an already-`Submitted` milestone is legal and overwrites the proof
hash. In the app, `submitted → submitted` short-circuits to a no-op. Harmless
today because the app attaches no hash on transition — it stops being harmless
the moment it does.

Decide custodial vs. wallet-signed first — it changes everything downstream.

Steps are in [`contracts/README.md`](./contracts/README.md) under "Deploy to
testnet".

---

## 2. Gaps found in this audit

### 2.1 Members can be managed, but nobody new can be onboarded

**Mostly resolved.** There is now a roster at
`/projects/[slug]/members`, admin-gated add / change-role / remove actions, and
guards the database does not encode: the owner's row cannot be demoted or
removed, and an admin cannot change their own role (both would lock a project's
administration out permanently, since the bootstrap trigger only fires at
project creation).

**What remains is a real hole.** `profiles` is readable only for yourself plus
whoever `shares_project_with()` matches, so the picker can only offer people you
*already* share a project with. There is no query that turns an arbitrary email
or wallet address into a user id. Consequences:

- A brand-new user cannot be added to any project by anyone. They can only get
  in by creating their own project, at which point the trigger makes them its
  owner — and they still cannot be added to anyone else's.
- Invite-by-email is not a UI change. It needs a `SECURITY DEFINER` lookup
  function, i.e. a migration, written with the same care as the existing helpers
  in `20260731000002_rls.sql` (derive from arguments narrowly, return the
  minimum, revoke from `PUBLIC`).

*Checked: read the `profiles` policies and `shares_project_with()` in `supabase/migrations/20260731000002_rls.sql`; `listAddableMembers()` in `queries.ts` is `listMembers()` minus current members, and `listMembers()` is itself RLS-capped.*

This also means the add path **cannot be end-to-end tested** with the current
seed: all three seeded users already belong to the one seeded project, so the
candidate set is empty. Same class of problem as the skipped
`stellar-proof.spec.ts`. Fixing it is seed data, not test code.

### 2.2 `docs_url` never displayed — **resolved**

Docs button now renders on the project overview beside Repo and Demo. Demo was
missing too and was added in the same pass.

*Checked: `src/app/(app)/projects/[slug]/page.tsx` renders all three, each conditional.*

### 2.3 No error boundaries — **resolved**

Six files, placed by what actually catches what rather than by mirroring the
`loading.tsx` layout:

| File | Catches |
|---|---|
| `app/global-error.tsx` | the root layout itself; renders its own document |
| `app/error.tsx` | landing, login, **and throws from `(app)/layout.tsx`** |
| `app/(app)/error.tsx` | every signed-in route, shell preserved |
| `app/(app)/projects/[slug]/error.tsx` | one project's five routes |
| `app/not-found.tsx` | 404 outside the shell |
| `app/(app)/not-found.tsx` | 404 inside it — the `notFound()` calls in six files |

Two things worth not rediscovering. **Next 16 renamed the error boundary's
`reset` prop to `unstable_retry`**, and the two differ in kind: `unstable_retry`
re-fetches and re-renders, `reset` only clears the boundary — which for a failed
read just renders the same failure again. And `error.tsx` does *not* wrap the
layout in its own segment, which is why the root file matters: `(app)/layout.tsx`
awaits `getUser()` and `listProjectOptions()` before the shell exists, so a
throw there skips `(app)/error.tsx` entirely.

The in-app 404 names both reasons a slug fails, because RLS makes them
indistinguishable: a project you are not a member of returns no rows, exactly
like one that was never created.

*Checked: read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`; `project-routes.spec.ts` asserts the new copy.*

### 2.4 Dashboard proof surface — **resolved**

A "Recent proof" panel, capped at 4, linking to `/proofs`. Read-only like every
other row on that page.

### 2.5 Board columns capped with no way past — **resolved**

`+N more` was a `<p>`. It is now a "Load N more" control that raises `limit` in
the URL, matching what `data-list.tsx` already did for the lists — so a board
opened two pages deep is shareable and the back button pages out of it. Cards
past the cap were also undraggable, since they were never rendered.

### 2.6 Drag and drop wrong on touch — **resolved**

`PointerSensor` was split into `MouseSensor` (6px distance) plus `TouchSensor`
(250ms delay, 8px tolerance). A distance threshold cannot work for touch:
"moved six pixels" is also how a scroll starts, so the drag and the scroll
fought over every swipe. Hold-to-drag, swipe-to-scroll now.

The guard that stops a press on a card's menu starting a drag had to grow to
cover `mousedown` and `touchstart`, because dnd-kit binds those directly rather
than `pointerdown`.

**Still untested.** The `mobile` Playwright project covers only
`mobile-nav.spec.ts`, and touch drag is awkward to assert. This is better by
construction, not by verification.

### 2.7 `avatar_url` captured and never used — **resolved**

Selected in `listMembers()`, carried on `Member` and `TaskRow`, rendered by a
new `MemberAvatar` that degrades to the existing initials chip. Radix only swaps
the image in once it loads, so a broken URL shows initials rather than a torn
image.

### 2.8 `createProof` skipped wallet-address validation — **resolved**

Found in this audit, and the only one of these that was writing bad data rather
than omitting a feature. `createProof` parsed with `proofSchema` but left
`walletAddress` out of the object it validated, then inserted it anyway;
`updateProof` validated it correctly. `stellar_proofs.wallet_address` is plain
`text` with no CHECK, so nothing downstream caught it either.

The structural cause is still present and worth knowing: **every action
validates `parsed.data` but writes `orNull(formData.get(...))`**. The two are
decoupled by convention, so a field can pass validation and be written
unvalidated with nothing failing. All ten actions were checked; this was the
only mismatch. A wholesale move to `parsed.data` would remove the class of bug
and was judged out of scope for a fix this size.

---

## 3. Known and deferred

Decided, not overlooked.

- **Scale UX** — bulk actions, inline create, command palette, keyboard
  navigation. Deferred by decision.
- **Priority field** — still the only planned item that needs a migration.
  Invite-by-email (2.1) would be a second if it is wanted.
- **Playwright in CI** — still deliberately excluded; it needs secrets and a
  database two concurrent runs would fight over. Vitest *is* now in CI, because
  it is pure logic with neither constraint.
- **Dashboard rows are read-only** — a capped rollup; every entity is editable
  from its own list.
- **Deployment rows cannot be edited** — the log is append-only by design.
- **Two skipped/uncoverable specs** — `stellar-proof.spec.ts` needs a seeded
  project with no contract; the member *add* path needs a seeded user who is not
  already in the project.

---

## 4. Risks rather than gaps

- **The e2e seed has drifted from `seed.ts`.** `BOARD_COUNTS.todo` says 2; the
  hosted database returns 1. This is **pre-existing** — reproduced by stashing
  all local work and running `board.spec.ts` against unmodified `cfd75d9`.
  It matters more than one red test: `mutations` depends on `chromium` and
  `edits` depends on `mutations`, so one failure there leaves **13 write specs
  unrun**. Either restore the missing todo task or correct `seed.ts`.
- **`/api/verify-tx` has no rate limit.** Auth-gated, so not an open Horizon
  proxy, but any signed-in user can drive unlimited upstream requests.
- **`moveTask` writes the destination column one row at a time.** N round trips,
  not transactional; a partial failure leaves positions inconsistent, which the
  code notes and tolerates.
- **`password123` in git history**, in `fe93996`. Rotated, repo is private, so
  low priority. The standing rule is never to apply `seed.sql` to a hosted
  project.
- **No unit tests for the server actions themselves.** Vitest now covers the
  pure logic they depend on — the milestone state machine, the filter round
  trip, the strkey validators — but the actions need a mocked Supabase client
  and remain uncovered except through Playwright.

---

## Suggested order

1. **Restore the e2e seed** (§4). It is small and it is currently hiding the
   results of 13 write specs.
2. **§1.1 contract integration** — the largest piece and the one that makes the
   product what it claims to be.
3. **§2.1 invite-by-email**, if onboarding anyone outside the existing circle
   matters before launch. It needs a migration; treat it as such.
4. Scale UX, when it is wanted.
