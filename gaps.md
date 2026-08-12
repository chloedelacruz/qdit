# What is still missing

Companion to [`README.md`](./README.md), which covers how the system works. This
file is only what is absent, deferred or risky.

Each item says how it was checked, so a stale entry can be re-verified rather
than trusted.

## Spec compliance

Every section of
[`stellar-builder-task-hub-spec.md`](./stellar-builder-task-hub-spec.md) is
built:

| Spec section | Notes |
|---|---|
| §1 Project management | create, edit, delete, overview, status |
| §2 Task board | create, edit, assign, due date, priority, move by menu or drag, paged, card opens a detail panel |
| §3 Milestone tracking | create, edit, link tasks, approval flow |
| §4 Stellar proof fields | all fields captured *and* displayed |
| §5 Deployment tracking | status ladder, release notes, append-only history |
| §6 Dashboard | rollup tiles and capped panels, including proofs |
| §7 Search / filter | status, priority, network, milestone, assignee, all in URL state |
| §8 Transaction verification | Horizon REST, behind the auth gate |
| §9 Contract link helper | `stellar.ts`, explorer URLs, `HashLink` |
| §10 Team workspace | roster and role management |

What follows is everything beyond that.

---

## 1. The app cannot drive `transfer_project_owner`

The contract is deployed with it and the generated bindings expose it, so the
capability exists — but nothing in `web/` calls it, and wiring it is not small.
The anchor flow (`prepare` → browser signs → `submit`) assembles **one**
signature. A transfer needs two, from two people who are not at the same
keyboard, which means holding a partially-authorized transaction somewhere while
the incoming owner signs it. The app has no precedent for that shape.

Until it does, a transfer is a CLI operation and `contracts/README.md` documents
the invocation. That is a fair place to leave it: the function exists so a
project cannot get permanently stuck, not because handovers are routine.

## 2. Repository / hosted-database drift

**Migration versions match the hosted ledger.** Each filename in
`supabase/migrations/` carries the version
`supabase_migrations.schema_migrations` records for it, so a clean checkout sees
all eight as applied rather than trying to re-run them:

| Version | Name |
|---|---|
| `20260731133219` | `init` |
| `20260731133313` | `rls` |
| `20260731133429` | `function_grants` |
| `20260731135342` | `task_priority` |
| `20260809010655` | `chain_anchors` |
| `20260810034700` | `member_invite_by_email` |
| `20260812130728` | `wallet_identity` |
| `20260812130752` | `member_invite_by_wallet` |

The last two were applied through the Supabase MCP, which stamps its own
version rather than taking one from a filename — so the files were **renamed to
match the ledger afterwards**, not the other way round. They were authored as
`…043000` and `…043100`. If you apply a migration that way again, expect to do
the same rename, and check `schema_migrations` rather than assuming.

**Keep it that way**, and note what it costs when you don't. A migration
authored in the repo has to be applied by something that writes that ledger —
`supabase db push`, not a paste into the dashboard SQL editor. Applying by hand
means remembering two extra statements every time:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('<version>', '<name>') on conflict (version) do nothing;
notify pgrst, 'reload schema';   -- or PostgREST serves a 404 with no other symptom
```

Three of the six above were applied by hand. Two had to be transcribed back out
of the ledger afterwards because the repo had no copy at all; their headers say
so, and they must not be re-run.

**Two things still cannot live in the repo.** `web/src/lib/types/database.ts` is
hand-written, so nothing regenerates it from a migration — change both in the
same commit or the types will confidently describe columns that do not exist.
And `.env` is git-ignored, so a fresh checkout starts from `.env.example` and can
point `E2E_EMAIL` at an account that does not own the seeded project, which fails
~50 specs on their empty states and looks like an app bug. `.env.example` states
the constraint and the symptom; that is the only durable guard short of
committing a service account. See the e2e section of
[`README.md`](./README.md).

## 3. On-chain

**No mainnet.** No escrow, no multi-party approval.

**No upgrade path.** There is no admin address and no `upgrade` entry point, so a
contract bug means deploying a new contract id and migrating
`projects.chain_contract_id`. Decide this before mainnet, not after.

**A lost owner key is still unrecoverable.** `transfer_project_owner` exists in
the contract (§1), and it fixes the *wrong-but-controlled* address, planned
handovers and key rotation. It cannot fix a genuinely lost key, because a lost
key cannot sign as `current_owner`. Nothing in this contract can — that is the
cost of having no admin address, and it is deliberate.

The transfer requires **both** parties to sign. Requiring only the outgoing
owner would let the recovery path recreate the exact failure it exists to undo:
a project pinned to an address nobody controls, with no way back. That makes the
app-side flow a two-signature transaction, which the current three-step anchor
flow does not handle — it assembles one signer. Wiring it is work beyond the
redeploy.

**Anchoring is additive by decision**, so the app's status and the ledger's can
legitimately disagree. See [`README.md`](./README.md); the alternative was
rejected because it would lock out anyone without a funded wallet.

**Testnet data is wiped periodically.** For a proof registry that is not a
detail: proofs anchored on Testnet are not durable evidence, even though
`stellar_proofs.network` faithfully records which chain they were on.

### Risks the on-chain path carries

- **`submitMilestoneAnchor` takes a signed transaction from the browser.** It is
  the one genuinely new attack surface, and it is defended by `assertInvocation`.
  Without that check a user could sign an arbitrary transaction and have the
  server write an authentic-looking anchor row.
- **`milestone_anchors` insert is member-level, not owner-level.** The chain
  enforces the rule that matters — approve/reject need the registering address's
  signature — so the policy does not restate it. A forged row would point at a
  transaction that does not exist, and the hash is checkable, but nothing in the
  app currently re-checks it.
- **The proof digest is a cross-system contract.** Changing `canonicalMilestone`
  invalidates every anchor already on the ledger, silently.

## 4. Untested by construction

- **Touch drag.** The `mobile` Playwright project covers only `mobile-nav`, and
  touch drag is awkward to assert. Better by construction than by verification.
- **The anchoring flow end to end.** It needs a funded Testnet wallet and a
  browser extension, neither of which Playwright can drive. The contract side has
  26 Rust tests and a live CLI walkthrough; the digest has Vitest coverage; the
  middle — wallet signature to ledger — is manual.
- **The server actions themselves.** Vitest covers the pure logic they depend on
  (milestone state machine, filter round trip, strkey validators, proof digest),
  but the actions need a mocked Supabase client.

## 5. Deferred by decision

Not oversights.

- **Playwright in CI** — excluded deliberately; it needs secrets and a database
  two concurrent runs would fight over. Vitest and the WASM build are in CI.
- **Dashboard rows are read-only** — a capped rollup; every entity is editable
  from its own list.
- **Deployment rows cannot be edited** — the log is append-only by design.
- **One skipped spec** — `stellar-proof.spec.ts` needs a seeded project with no
  contract, and there isn't one.
- **The e2e database is a fixture, not a workspace.** `TASK_TOTAL`,
  `MILESTONE_TOTAL` and `PROOF_TOTAL` in `e2e/seed.ts` are constants, and they
  are asserted against the *cross-project* views and the dashboard rollup — so
  a task, milestone or proof created by hand **anywhere** in that Supabase
  project fails those specs, not only one created in the seeded project. An
  empty project on its own is fine; the project index spec is size-independent.

  Worse than a failing spec: `reseed.setup.ts` deletes any task in the seeded
  project whose title is not one of the five it knows, so **work added there by
  hand is gone at the start of the next run**. It logs what it removed; it does
  not ask.

  Use a second Supabase project for real work and keep `E2E_*` pointed at the
  fixture. Making the suite tolerant instead means deriving the totals at
  runtime and loosening the dashboard tiles from exact values to relative ones,
  which costs real precision — `Open milestones` asserting `2` catches a
  regression that "some number" would not.

  Note the config header's claim that "anything that must hold at any data size
  is written to be size-independent" is true of paging and filtering, and not of
  these totals.

## 6. Older risks, still true

- **`/api/verify-tx` has no rate limit.** Auth-gated, so not an open Horizon
  proxy, but any signed-in user can drive unlimited upstream requests.
- **`moveTask` writes the destination column one row at a time.** N round trips,
  not transactional; a partial failure leaves positions inconsistent, which the
  code notes and tolerates.
- **`password123` is in git history**, in `fe93996`, via `supabase/seed.sql`.
  Rotated, and the repo is private, so this is low priority rather than urgent.
  The standing rule is never to apply `seed.sql` to a hosted project.

---

## Suggested order

Nothing here is blocking. Every item is a decision about scope rather than a
task waiting to be done, so the order is whatever the next goal makes relevant:

- **Before mainnet**, settle §3 — the upgrade path, and whether a handover ever
  needs to be possible from the app rather than the CLI (§1).
- **Before onboarding at any scale**, §6's rate limit on `/api/verify-tx`.
- **Before trusting the repo to rebuild the database**, keep §2 true by pushing
  migrations with the CLI rather than pasting them.
