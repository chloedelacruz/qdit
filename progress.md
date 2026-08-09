# progress

Handoff notes. Last updated 2026-08-09, end of the contract-integration session.

Read this with [`README.md`](./README.md) (how the thing works),
[`stellar-builder-task-hub-spec.md`](./stellar-builder-task-hub-spec.md) (what
it is meant to do) and
[`SMART_CONTRACT_SPEC.md`](./SMART_CONTRACT_SPEC.md) (the anchoring methodology
this session followed). This file is only the delta between them.

[`gaps.md`](./gaps.md) is the audited list of what is still missing. Start there
when picking up work.

## Where things stand

`main` is the only branch and is in sync with `origin`.

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run build` | pass, both with and without a contract id in env |
| `npm test` (Vitest) | **111 passed** (was 91) |
| `npx playwright test` | **115 passed, 1 skipped** |
| `cargo test` | **17 passed** (was 12) |
| `cargo clippy --all-targets -- -D warnings`, `cargo fmt --all --check` | clean |
| `stellar contract build` | 8835 bytes, hash `18e77bec…2a8a` |

| Layer | State |
|---|---|
| Database | 8 tables, 7 enums, 30 RLS policies. **Five migrations now**, two of them backfilled — see "The drift" below. |
| Web | Full CRUD, role-gated, member management, error boundaries, board paging, proof rollup, **and wallet-signed on-chain anchoring**. |
| Contract | **Deployed to Testnet**, 17 tests, wired to the app. |

## What this session built

**The one thing `gaps.md` called the blocker: contract integration.** Following
`SMART_CONTRACT_SPEC.md`, with three deliberate deviations noted below.

### The contract was revised before the first deploy

The last moment it could be. `Symbol` → `String` for ids (a 36-character UUID
does not fit a 32-character `Symbol`, and only fitted at all by stripping
hyphens); a `version` counter so a re-submission cannot silently overwrite an
earlier proof hash; events on every write via `#[contractevent]`; an
`IdTooLong` guard; TTL 30/90.

Deployed at `CAZYR4UI…JRH6`. Full record, including the WASM hash a third party
needs to verify the deployed bytes, is in
[`contracts/README.md`](./contracts/README.md).

### The app anchors, additively

`updateMilestoneStatus` is **untouched**. Anchoring is a separate act with its
own control, so the app's status and the ledger's are allowed to disagree — and
the UI shows both, including a `stale` marker when the milestone has changed
since its hash was written.

The flow has to be three steps because the signature happens in the browser:

```
prepareMilestoneAnchor   server: authorize, hash, build + simulate → XDR
  ↓
signTransaction          browser: the wallet signs that string, nothing else
  ↓
submitMilestoneAnchor    server: verify the envelope, submit, poll, record
```

Simulating in step 1 is what surfaces a contract error *before* the user is
asked to sign, rather than after they paid for a failed transaction.

### Three deviations from `SMART_CONTRACT_SPEC.md`

1. **§8.2 skipped entirely.** The spec maps a wallet address onto a Supabase
   user and flags it as its own biggest gap (§10.1), because it authenticates
   *possession of an address*, not control of the key. qdit already has Supabase
   auth and a role system, so the wallet is an **attestation key, not a login**.
   There is nothing to bridge, and the signature on the transaction is what
   proves control.
2. **soroban-sdk 27, not 22.** The spec's raw `env.events().publish` is
   deprecated in 27 in favour of `#[contractevent]`, which is better: the events
   land in the contract spec, so the generated TypeScript bindings carry their
   types.
3. **Length-prefixed digest encoding**, not a separator byte. The spec's
   approach relies on a character that "cannot appear in the data"; prefixing
   each field with its length is unambiguous without that assumption. Pinned by
   `milestone-hash.test.ts`.

## The drift, which cost more time than the contract did

Three separate cases of the repository not describing reality. All resolved,
all documented in [`gaps.md`](./gaps.md) §4.

- **Two migrations existed only on the hosted database.** `function_grants`
  (revokes on the SECURITY DEFINER helpers) and `task_priority` (a live
  `tasks.priority` column). Recovered from
  `supabase_migrations.schema_migrations` and backfilled verbatim. `gaps.md` had
  been calling the priority field "the only remaining item that needs a
  migration" while it was already in production.
- **The e2e account owned nothing.** `E2E_EMAIL` pointed at an account with no
  project membership, so RLS returned nothing and 64 specs failed with an empty
  dashboard and 404s. The seeded owner persona was handed to the real account;
  `e2e/seed.ts` explains why the two specs involved force that.
- **PostgREST caches its schema.** See below.

## Things that bit, and will bite again

Each of these cost real debugging time. They are all still true.

- **PostgREST does not see a new column until its schema cache reloads.** Every
  query naming one returns *nothing* — no error, no 400. It surfaces as an empty
  dashboard and "Not found" on every project route, which reads exactly like an
  RLS or auth problem and is not. Fix: `notify pgrst, 'reload schema'`.
- **`env.events().all()` in Soroban tests is scoped to the last invocation.**
  Collecting events and asserting once at the end silently checks only the final
  write. Assert after each call.
- **`server-only` throws under Vitest.** It picks its entry point with the
  `react-server` export condition, which Next sets and Vitest does not. Aliased
  to a stub in `vitest.config.mts` — the import stays in the source, because it
  is what keeps `node:crypto` out of the browser bundle.
- **The wallet kit reads `localStorage` during module evaluation.** `"use
  client"` does not mean browser-only — Next still renders client components on
  the server for the initial HTML — so a top-level import crashes every route
  that reaches the module. Import inside each function; see `src/lib/wallet.ts`.
- **React bubbles portal events along the React tree, not the DOM tree.** A
  dialog rendered inside a row that intercepts clicks will have its form submits
  cancelled by that row's `preventDefault`. `row-actions.tsx` carries the
  explanation.
- **dnd-kit sets `role="button"` on every draggable**, replacing whatever
  semantic role the element had. Override via `useSortable({ attributes: { role } })`.
- **Playwright's `fullyParallel` puts separate files on separate workers.** Two
  write specs against one shared database will interleave. Cross-file ordering
  is only available through project `dependencies`. **Any new write spec needs
  its own project, or it must go in an existing write file** — and it needs
  adding to `chromium`'s `testIgnore`, or it runs twice.
- **`npx playwright test --no-deps` is a footgun.** The `edits`-depends-on-
  `mutations` chain is the only thing serialising two write specs against one
  database. `npx playwright test --project=cleanup` puts it right.
- **A modal makes the rest of the page `aria-hidden`**, so `getByRole` cannot
  see anything behind an open dialog.
- **A Playwright locator keyed to a control whose label changes stops
  resolving.** `HashLink`'s copy button relabels itself to "Copied". Anchor on
  the explorer link's `aria-label` instead.
- **Next 16 renamed the error boundary's `reset` prop to `unstable_retry`**, and
  they are not interchangeable. Also `error.tsx` does *not* wrap the layout in
  its own segment.
- `npm install` from the repo root appears to work because Node resolves upward.
  Install from `web/`.
- **Adding a `<Section href>` adds a "View all" link**, and `dashboard.spec.ts`
  counts them.

## Conventions worth not rediscovering

- `web/AGENTS.md`: this is Next.js 16 and it has breaking changes. Read
  `node_modules/next/dist/docs/` before writing routing or caching code.
- **`src/lib/chain/bindings.ts` is generated**, ESLint-ignored, and must be
  replaced wholesale rather than edited. The command is in `contracts/README.md`.
- **`src/lib/types/database.ts` is hand-written.** Change it in the same commit
  as any migration; nothing regenerates it.
- Radix `Select` submits nothing in a native form post. `NativeSelect` in
  `form-dialog.tsx` exists for exactly that reason.
- `FormDialog` closes on success from inside the action, not from an effect on
  `state.ok`, because `revalidatePath` re-renders the subtree.
- Create and edit share one field set per entity in `entity-dialogs.tsx`.
- Server components cannot pass a render prop to a client component, which is
  why `entity-row-actions.tsx` exists between `rows.tsx` and `row-actions.tsx`.
- Every page names exactly one primary object via `<Section priority>`.
- Icons come from `src/lib/icons.ts`, never picked inline.
- Density is settled: Linear over whitespace, 13px base, single-line rows.

## What is left

Nothing blocks the pitch any more. In order:

1. **Invite-by-email** (`gaps.md` §3.1) — needs a `SECURITY DEFINER` lookup
   migration. The seed data required to test it now exists.
2. **Migration alignment** (`gaps.md` §4) — decide whether the repo should be
   able to rebuild the hosted schema.
3. **Priority UI** (`gaps.md` §3.2) — the column is live and unused; this is
   pure front-end work now.
4. **Scale UX**, when it is wanted.

Before mainnet, and not before then: the contract has **no upgrade path** — no
admin address, no `upgrade`. A bug means a new contract id and migrating
`projects.chain_contract_id`.

## Security note

`password123` is in git history, in `fe93996`, via `supabase/seed.sql`. The
passwords have been rotated and **the repo is private**, which is what makes
this low priority rather than urgent. Do not re-raise it as a blocker. The live
rule that still matters: **never apply `seed.sql` to a hosted project.**
