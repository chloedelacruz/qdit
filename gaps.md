# What is still missing

Audited 2026-08-05 against `main` at `cfd75d9`, re-audited after the gap session
that closed most of it, and again on 2026-08-09 after the contract was wired up.
Companion to [`progress.md`](./progress.md), which covers where things stand;
this file is only what is absent.

Each item says how it was checked, so a stale entry can be re-verified rather
than trusted.

## Spec compliance

| Spec section | State |
|---|---|
| §1 Project management | **Complete** — create, edit, delete, overview, status |
| §2 Task board | **Complete** — create, edit, assign, due date, move by menu or drag, paged, and a card opens a detail panel |
| §3 Milestone tracking | **Complete** — create, edit, link tasks, approval flow |
| §4 Stellar proof fields | **Complete** — all fields captured *and* displayed |
| §5 Deployment tracking | **Complete** — status ladder, release notes, append-only history |
| §6 Dashboard | **Complete** — proof rollup added |
| §7 Search / filter | **Complete** — status, network, milestone, assignee, all in URL state |
| §8 Transaction verification | **Complete** — Horizon REST, behind the auth gate |
| §9 Contract link helper | **Complete** — `stellar.ts`, explorer URLs, `HashLink` |
| §10 Team workspace | **Complete** — roster, role management, and onboarding is now testable (see 3.1) |

**The blocker that headed this file is gone.** `milestone_proof` is deployed to
Testnet, the app signs against it with a real wallet, and anchors are recorded
and rendered. What remains is smaller than what was closed.

---

## 1. On-chain: what is done and what is not

### 1.1 Contract integration — **resolved**

Deployed at
[`CAZYR4UI…JRH6`](https://stellar.expert/explorer/testnet/contract/CAZYR4UI5EYAIUDNXYAYDVHGMUOELJHQNETOAPN3SMR5BMH6XV2FJRH6),
WASM hash `18e77bec…2a8a`. Full deploy record in
[`contracts/README.md`](./contracts/README.md).

The contract was **revised before the first deploy**, which was the last moment
it could be:

- `Symbol` → `String` for ids. `Symbol` caps at 32 characters and forbids `-`;
  the app's ids are 36-character UUIDs, which only fitted by stripping hyphens
  to land on exactly 32. No headroom, and a lossy conversion at every call.
- A `version` counter on `MilestoneRecord`, incremented per submission. This
  closes the nuance the previous audit flagged: a re-submission overwrites
  `proof_hash`, so without a counter the ledger showed the latest hash with no
  evidence an earlier one existed.
- Events on every write, via `#[contractevent]` so they land in the contract
  spec and the generated bindings. `IdTooLong` guard. TTL 30/90 rather than
  29/30.

17 Rust tests, up from 12 — including the two that carry the most weight and
were missing: an auth test that does **not** call `mock_all_auths` (so deleting
`require_auth()` goes red) and an event test that pins topics, field names and
version per write.

*Checked: `cargo test` 17 passed; live `create_project_ref` → `submit` → `reject` → `submit` on Testnet returned `version: 2` and emitted the expected events.*

### 1.2 Anchoring is additive, and that is a decision

Anchoring never writes `milestones.status`. Moving a milestone through the
approval flow and proving it on chain are separate acts, so the two **can
legitimately disagree** — approved in the app, not yet anchored; anchored under
a hash that no longer matches. The UI shows both, and a mismatched hash renders
as `stale` rather than being hidden.

The alternative — making the chain write a precondition for the transition —
was rejected: it would mean nobody without a funded wallet could move a
milestone at all.

### 1.3 What is deliberately not on chain

No mainnet. No escrow, no multi-party approval. **No upgrade path**: there is no
admin address and no `upgrade` entry point, so a contract bug means a new
contract id and migrating `projects.chain_contract_id`. Decide that before
mainnet, not after.

---

## 2. Risks introduced by the on-chain work

- **`submitMilestoneAnchor` takes a signed transaction from the browser.** It is
  the one genuinely new attack surface, and it is defended: `assertInvocation`
  in `web/src/lib/chain/client.ts` parses the envelope and refuses anything that
  is not exactly one `invokeHostFunction` against the expected contract and
  function. `signer_address` is read from the verified transaction, never from
  `profiles.wallet_address`. Without both, a user could sign an arbitrary
  transaction and have the server write an authentic-looking anchor row.
- **`milestone_anchors` insert is member-level, not owner-level.** The chain
  enforces the rule that matters (approve/reject need the registering address's
  signature), so the policy does not restate it. A forged row would point at a
  transaction that does not exist, and the hash is checkable — but nothing in
  the app currently re-checks it.
- **The proof digest is a cross-system contract.** Changing
  `canonicalMilestone` invalidates every anchor already on the ledger, silently:
  no build breaks, every anchor just starts reading `stale`.
  `milestone-hash.test.ts` pins the encoding itself for that reason.
- **`chain_owner_address` is set once and cannot be changed.** Registering a
  project with the wrong wallet is not recoverable through the app — the
  contract will only ever accept approvals from that address.

---

## 3. Remaining gaps

### 3.1 Invite-by-email — still absent, but now testable

`profiles` is readable only for yourself plus whoever `shares_project_with()`
matches, so the member picker can only offer people you *already* share a
project with. There is still no query turning an arbitrary email or wallet
address into a user id; that needs a `SECURITY DEFINER` lookup function, i.e. a
migration written with the same care as the helpers in
`20260731000002_rls.sql`.

**What changed:** the previous audit noted the add path could not be end-to-end
tested because all three seeded users already belonged to the one seeded
project. After the 2026-08-09 owner handover (§4), `ada@qdit.test` exists and is
*not* on the project — so `listAddableMembers()` finally returns someone, and
the add path is coverable.

*Checked: `profiles` policies and `shares_project_with()` in the RLS migration; `listAddableMembers()` is `listMembers()` minus current members, and `listMembers()` is RLS-capped.*

### 3.2 `tasks.priority` exists and the app ignores it

**Corrected from the previous audit, which was wrong.** That audit said the
priority field was "the only planned item that needs a migration". It had
already been applied to the hosted database on 2026-07-31 and never committed —
see §4. The column is live, `not null default 'medium'`, and nothing in `web/`
reads or writes it, so every row carries the default.

This is deferred **UI** work, not deferred schema work: add it to
`constants.ts` beside `TASK_STATUS`, to the shared field set in
`entity-dialogs.tsx`, to a chip in `rows.tsx`, and to the board/task facets.
`database.ts` already describes it.

### 3.3 Untested by construction

- **Touch drag.** The `mobile` Playwright project covers only `mobile-nav`, and
  touch drag is awkward to assert. Better by construction, not by verification.
- **The anchoring flow end to end.** It needs a funded Testnet wallet and a
  browser extension, neither of which Playwright can drive here. The contract
  side is covered by 17 Rust tests and a live CLI walkthrough; the hash is
  covered by Vitest; the middle — wallet signature to ledger — is manual.
- **The server actions themselves.** Vitest covers the pure logic they depend
  on (milestone state machine, filter round trip, strkey validators, proof
  digest) but the actions need a mocked Supabase client.

---

## 4. Repository / hosted-database drift

Found on 2026-08-09 while adding the anchor migration, and worth its own
section because two entries in this file were wrong because of it.

**Two migrations existed on the hosted project and not in the repo.** Recovered
from `supabase_migrations.schema_migrations` and backfilled verbatim as
`20260731000003_function_grants.sql` and `20260731000004_task_priority.sql`.
Their headers say so; do not re-run them against that project.

**The version numbers do not match.** The repo names `20260731000001_init.sql`;
the hosted ledger records init as `20260731133219`. So `supabase db push` from a
clean checkout will not line up with what is deployed. It would fail loudly
("type already exists") rather than corrupt anything, but it is not a usable
path today.

**PostgREST caches its schema.** After applying a migration, `notify pgrst,
'reload schema'` is needed or every query naming a new column returns nothing —
which surfaces as an empty dashboard and 404s on project routes, not as an
error. This cost a full suite run.

**The e2e account owned nothing.** `E2E_EMAIL` pointed at an account with no
project membership, so RLS returned nothing and 64 specs failed. Resolved by
handing the seeded owner persona to the real account (§ `e2e/seed.ts`, which
explains why the two specs involved force this). `supabase/seed.sql` still
creates Ada, because it seeds a local stack where there is no real account.

---

## 5. Known and deferred

Decided, not overlooked.

- **Scale UX** — bulk actions, inline create, command palette, keyboard
  navigation. Deferred by decision.
- **Playwright in CI** — still deliberately excluded; it needs secrets and a
  database two concurrent runs would fight over. Vitest and the WASM build *are*
  in CI.
- **`SUPABASE_SECRET_KEY` is not set locally**, so `cleanup.teardown.ts` no-ops
  and each write-spec run leaves `e2e ` rows behind. `reseed.setup.ts` sweeps
  tasks, so the board stays correct, but milestones and deployments accumulate
  until someone deletes them by hand.
- **Dashboard rows are read-only** — a capped rollup; every entity is editable
  from its own list.
- **Deployment rows cannot be edited** — the log is append-only by design.
- **One skipped spec** — `stellar-proof.spec.ts` needs a seeded project with no
  contract.

---

## 6. Older risks, still true

- **`/api/verify-tx` has no rate limit.** Auth-gated, so not an open Horizon
  proxy, but any signed-in user can drive unlimited upstream requests.
- **`moveTask` writes the destination column one row at a time.** N round trips,
  not transactional; a partial failure leaves positions inconsistent, which the
  code notes and tolerates.
- **`password123` in git history**, in `fe93996`. Rotated, repo is private, so
  low priority. The standing rule is never to apply `seed.sql` to a hosted
  project.

---

## Suggested order

1. **§3.1 invite-by-email**, if onboarding anyone outside the existing circle
   matters before launch. It needs a migration; treat it as such. The seed data
   it needed for testing now exists.
2. **§4 migration alignment** — decide whether the repo should be able to
   rebuild the hosted schema, and if so reconcile the version numbers.
3. **§3.2 priority UI**, which is now pure front-end work.
4. Scale UX, when it is wanted.
