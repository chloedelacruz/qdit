# What is still missing

Audited 2026-08-05 against `main` at `a5d7b8d`, feature by feature, by reading
the code rather than from memory. Companion to [`progress.md`](./progress.md),
which covers where things stand; this file is only what is absent.

Each item says how it was checked, so a stale entry can be re-verified rather
than trusted.

## Spec compliance

| Spec section | State |
|---|---|
| §1 Project management | **Complete** — create, edit, delete, overview, status |
| §2 Task board | **Complete** — create, edit, assign, due date, move by menu or drag |
| §3 Milestone tracking | **Complete** — create, edit, link tasks, approval flow |
| §4 Stellar proof fields | **Complete** — contract ID, tx hash, network, wallet address, repo/demo/docs URLs, proof link |
| §5 Deployment tracking | **Complete** — status ladder, release notes, append-only history |
| §6 Dashboard | **Partial** — no proof surface (see 2.4) |
| §7 Search / filter | **Complete** — status, network, milestone, assignee, all in URL state |
| §8 Transaction verification | **Complete** — Horizon REST, behind the auth gate |
| §9 Contract link helper | **Complete** — `stellar.ts`, explorer URLs, `HashLink` |
| §10 Team workspace | **Partial** — assignment works, there is no members list (see 2.1) |

So the MVP is functionally built except for the two partials below and the one
thing that was never off-chain work in the first place.

---

## 1. The blocker

### 1.1 Contract integration

The product's differentiator, and still entirely unwired. `milestone_proof` is
built and tested and has never been deployed; `@stellar/stellar-sdk` is not in
`web/package.json`; nothing in the app talks to a chain.

*Checked: `grep stellar-sdk web/package.json` → absent; no `MILESTONE_PROOF_CONTRACT_ID` in `.env.example`.*

The groundwork is done. `updateMilestoneStatus` in `src/lib/actions.ts` already
validates every rule the contract enforces, in the order it enforces them, and
`profiles.wallet_address` is now capturable so accounts can be linked before
this starts. The chain call goes inside that function, after the checks pass and
before the row is written.

Decide custodial vs. wallet-signed first — it changes everything downstream.

Steps are in [`contracts/README.md`](./contracts/README.md) under "Deploy to
testnet".

---

## 2. Gaps found in this audit

These were not previously tracked anywhere.

### 2.1 No member management at all

`project_members` is **read** by the app — `getProjectRole`, `listProjectRoles`
— and never written. There is no members list, no invite, no way to change or
revoke a role. A project's team is whatever the database says, editable only by
SQL.

*Checked: `grep -rn "project_members" web/src` → only queries.ts reads and generated types. No "invite"/"add member" strings anywhere in `src`.*

This is spec §10's "simple members list", and the RLS policies for it already
exist (`project_members: insert/update/delete as admin`). No migration needed.
The gap is a settings surface and three actions.

Worth noting the consequence: role gating shipped in the last session, so the
app now *depends* on roles it gives no way to assign. A project owner cannot
grant anyone else admin without opening the database.

### 2.2 `docs_url` is writable but never displayed

A loose end from the last session. The field was added to the project create and
edit forms and to `updateProject`, and `ProjectRow.docsUrl` is selected and
mapped — but nothing renders it. The project overview shows Repo and Demo
buttons and no Docs button.

*Checked: `grep -rn "docsUrl" web/src --include=*.tsx` → only the dialog and the row-actions wrapper. No read site.*

Small fix, in `src/app/(app)/projects/[slug]/page.tsx` beside the existing Repo
button.

### 2.3 No error boundaries anywhere

There is no `error.tsx`, no `global-error.tsx`, and no custom `not-found.tsx` in
the entire app. An unhandled server error in any route shows Next's default
error page rather than anything belonging to this product.

*Checked: `find web/src/app -name "error.tsx" -o -name "global-error.tsx" -o -name "not-found.tsx"` → no results.*

This matters more now than it did a session ago: every mutation returns errors
as state rather than throwing, but a failed *read* — an expired session hitting
a server component, Supabase unreachable — has nowhere to land. Route-level
`loading.tsx` files exist; their error counterparts do not.

### 2.4 Dashboard has no proof surface

Spec §6 lists "Linked Stellar proof" among the dashboard's contents. The four
tiles are Assigned to me, Tasks complete, Open milestones and Live on Mainnet;
the panels are My open tasks, Awaiting approval and Active projects. Proofs
appear nowhere.

*Checked: read `src/app/(app)/dashboard/page.tsx` — no `ProofListRow`, no proof query.*

Given the product's whole claim is proof-of-work, its absence from the rollup is
a real omission rather than a nitpick.

### 2.5 Board columns cap with no way past it

Each board column renders `+N more` as plain text when its rows exceed the
limit. The list views solved this — `data-list.tsx` has a Show more control that
raises `limit` in the URL — but the board never got one, so cards past the cap
are unreachable there. They also cannot be dragged, since they are not rendered.

*Checked: `grep -n "more" src/components/task-board.tsx` → line 266, a `<p>`, no link.*

### 2.6 Drag and drop is untested and probably wrong on touch

The board uses `PointerSensor` with a 6px distance activation. On a touch
screen that will start a drag on any small finger movement, which is also how
scrolling starts — the two will fight. dnd-kit's usual answer is `TouchSensor`
with a delay, so a long-press drags and a swipe scrolls.

The `mobile` Playwright project only covers `mobile-nav.spec.ts`, so nothing
tests this either way.

*Checked: read the `useSensors` call in `task-board.tsx`; read the `mobile` project's `testMatch` in `playwright.config.ts`.*

The status menu still works on touch, so the board is usable — this degrades
rather than breaks.

### 2.7 `avatar_url` is captured and never used

`handle_new_user` populates `profiles.avatar_url` from OAuth metadata, an
`avatar.tsx` primitive exists in `components/ui`, and `MemberChip` renders
initials. Nothing ever reads the column.

*Checked: `grep -rn "avatarUrl\|avatar_url" web/src --include=*.tsx` → no results.*

Cosmetic. Listed because the data is already there.

---

## 3. Known and deferred

Decided, not overlooked.

- **Scale UX** — bulk actions, inline create, command palette, keyboard
  navigation. Deferred by decision.
- **Priority field** — still the only remaining item in the project that needs a
  migration.
- **Playwright in CI** — deliberately excluded; it needs secrets and a database
  two concurrent runs would fight over. The reasoning is inline in
  `.github/workflows/ci.yml`.
- **Dashboard rows are read-only** — a capped rollup; every entity is editable
  from its own list.
- **Deployment rows cannot be edited** — the log is append-only by design.
- **One skipped spec** — `e2e/stellar-proof.spec.ts` needs a seeded project with
  no contract.

---

## 4. Risks rather than gaps

Nothing here is a missing feature, but each would hurt later.

- **No unit tests.** Playwright is the entire safety net. Pure logic that
  deserves direct tests: `MILESTONE_TRANSITIONS` and the rules in
  `updateMilestoneStatus`, `filters.ts` round-tripping, the strkey validators in
  `stellar.ts`. All are testable without a browser or a database, and the
  milestone rules are about to become the contract's mirror — the one place
  where a silent divergence would be expensive.
  *Checked: no `*.test.*` anywhere under `web/src`.*
- **`/api/verify-tx` has no rate limit.** It is auth-gated, so it is not an open
  Horizon proxy, but any signed-in user can drive unlimited upstream requests.
- **`moveTask` writes the destination column one row at a time.** Fine at the
  current cap; it is N round trips, and it is not transactional — a partial
  failure leaves positions inconsistent, which the code notes and tolerates.
- **`password123` in git history**, in `fe93996`. Rotated, repo is private, so
  low priority. The standing rule is never to apply `seed.sql` to a hosted
  project.

---

## Suggested order

1. **§2.3 error boundaries** and **§2.2 docs URL** — an hour, and 2.3 is the
   only item here with a production-incident shape.
2. **§2.1 member management** — the app depends on roles it cannot assign.
3. **§1.1 contract integration** — the largest piece and the one that makes the
   product what it claims to be. Do §4's unit tests for the milestone rules
   alongside it, not after.
4. **§2.4 dashboard proofs**, **§2.5 board paging**, **§2.6 touch drag**.
5. Scale UX, when it is wanted.
