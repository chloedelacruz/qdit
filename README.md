# qdit

Builder operations for Stellar teams — a lightweight task hub that keeps project
management and on-chain proof of work in the same record.

Tasks, milestones and deployment status live in Postgres. Milestone approval and
proof records can be committed on-chain through a small Soroban contract.

- Product spec: [`stellar-builder-task-hub-spec.md`](./stellar-builder-task-hub-spec.md)
- Design language: [`qdit-design-language-spec.md`](./qdit-design-language-spec.md)

## Layout

```
web/         Next.js 16 app (App Router, TypeScript, Tailwind v4, shadcn/ui)
contracts/   Rust workspace — the milestone_proof Soroban contract
supabase/    SQL migrations, RLS policies, local config
materials/   Brand source material
```

## Status

All three layers are **joined**. The UI reads and writes a hosted Postgres with
RLS enforced, and it signs Soroban transactions against a contract deployed on
Testnet.

| Layer | State |
|---|---|
| Database | 8 tables, 7 enums, triggers, indexes, 30 RLS policies. **Applied to a hosted project and seeded.** |
| Contract | All 5 spec'd functions plus events, 17 tests + snapshots. **Deployed to Testnet** and called from the app. |
| Web UI | Full CRUD, role-gated, over real Postgres, plus wallet-signed anchoring. **115 Playwright specs pass**, 1 skipped; 111 Vitest unit tests. |

Working end to end: sign in / sign up / sign out and the auth gate; every read;
create, edit and delete for **projects, tasks, milestones and proofs**; the
milestone approval flow; deployment logging; profile and wallet address;
drag-and-drop on the board; transaction verification against Horizon; and
**anchoring a milestone's proof hash on chain with a connected wallet**.

Every create and edit form is built on `src/components/form-dialog.tsx` — one
shell, so pending state, error placement and the close-only-on-success rule
cannot drift between them. Create and edit share one field set per entity in
`entity-dialogs.tsx`. Add a new entity by writing fields, not another dialog.

Which controls appear is decided by the caller's role in that project, because
the RLS policies are not uniform: tasks and milestones are open to any member,
projects and deployments to an admin, proofs to their author or an admin. The
server actions re-check — a hidden button is courtesy, not the boundary.

Milestone status is **not** a dropdown. `milestone_status` is the contract's
state machine, so the app enforces the contract's transitions (`proposed →
submitted → approved | rejected`, approve/reject reserved to the project owner,
approved terminal). Otherwise the database could reach a state the contract
refuses to reproduce — and now that the on-chain call exists, that is not a
hypothetical: the transaction would fail at simulation.

Not started:

1. **Invite-by-email** — `profiles` is RLS-scoped to people you already share a
   project with, so nobody outside that circle can be added. Needs a
   `SECURITY DEFINER` lookup function, i.e. a migration.
2. **Scale UX** — bulk actions, inline create, command palette and keyboard
   navigation. The `.row`, `.stagger` and `.focus-ring` primitives exist for
   these. A `tasks.priority` column already exists in the database and is
   unused, so wiring it up is front-end work rather than a migration.

See [`gaps.md`](./gaps.md) for the audited list, and [`progress.md`](./progress.md)
for handoff notes.

> **Security note.** `supabase/seed.sql` contains `password123` in plaintext and
> its header says it is for the local stack only. It was nonetheless applied to
> the hosted project, where those accounts were reachable from the public
> internet using only the publishable key. The passwords have been rotated and
> the repo is private, but **`password123` remains in git history** — removing it
> needs a history rewrite (`git filter-repo` / BFG). Never apply `seed.sql` to a
> hosted project.

The density question is settled: **Linear over whitespace.** The spec's "large
whitespace" principle is gone, replaced by §Density — 13px base, single-line
32–36px rows, hierarchy from weight and colour rather than size. Marketing
surfaces (the landing page) are exempt.

## Web app

```bash
cd web
cp .env.example .env.local     # fill in your Supabase project values
npm install
npm run dev
```

Other commands: `npm run build`, `npm run lint`, `npm run typecheck`.

### Routes

The app is **project-scoped**: every working view belongs to one project, and
cross-project views are explicitly labelled. At workspace scale an unscoped
board is unusable, so scoping is the default rather than a filter.

```
/                              Landing page
/dashboard                     Workspace rollup — every panel capped
/projects                      Project index (filterable)
/projects/[slug]               Project overview
/projects/[slug]/board         Todo → In Progress → Done, this project only
/projects/[slug]/milestones
/projects/[slug]/deployments   Full append-only release history
/projects/[slug]/proofs
/tasks                         All tasks — a list, not a board
/milestones                    All milestones
/deployments                   Current state per project
/proofs                        Proof registry + identifier lookup
/settings
```

### Data layer

`src/lib/queries.ts` is the only module that talks to Supabase for reads. Every
function is `async` and returns a `Page<T>` (`rows` / `total` / `matched`).
Filtering, sorting and limiting all happen there — a page cannot render an
unbounded list by accident.

Writes go through `src/lib/actions.ts`. Every action re-validates with the same
zod schema the client used, returns `{ ok, error, fieldErrors }` instead of
throwing so forms can render failures inline, and revalidates `/` at `layout`
scope — a row shows up on the board, the project overview, the dashboard and the
cross-project list at once.

`src/lib/filters.ts` holds typed URL state. Filters live in the query string so
a filtered view is shareable, bookmarkable and survives a refresh; multi-value
facets are comma-separated (`?status=todo,in_progress`).

### End-to-end tests

```bash
cd web
npx playwright install chromium   # once
npm run test:e2e                  # headless
npm run test:e2e:ui               # watch mode
```

Playwright builds and serves the app itself on port 3100 — no dev server needed
first. Two projects run: `chromium` at desktop width, and `mobile` (Pixel 7),
which covers only `e2e/mobile-nav.spec.ts` because the sidebar becomes a sheet
below `lg`.

The suite runs against the **real Supabase project** with RLS enforced — there
are no fixtures. It needs `E2E_EMAIL` and `E2E_PASSWORD` in `.env.local` (see
`.env.example`). Credentials are never written into a spec file.

> **The account must *own* the seeded project, not merely belong to it.**
> `board.spec.ts` asserts the owner's name on the card for the in-progress task,
> and `dashboard.spec.ts` asserts that same task appears under "My open tasks" —
> which only holds for tasks assigned to whoever is signed in. Both pass only if
> the signed-in user *is* the owner persona. An account with no membership at
> all fails 64 specs with an empty dashboard and 404s on every project route,
> which reads like an auth bug and is not one.
>
> On 2026-08-09 the real account took over the seeded "Ada Builder" role in the
> hosted database — memberships, assignments, proofs and deployments all moved
> across. `supabase/seed.sql` still creates Ada, because it seeds a *local*
> stack where there is no real account to hand anything to. `e2e/seed.ts`
> records which is which.

Playwright projects, in order:

| Project | Session | Covers |
|---|---|---|
| `setup` | — | Signs in once, saves `e2e/.auth/user.json` |
| `anon` | none | The auth gate, login form, sign-out |
| `chromium` | shared | Every read-only spec |
| `mutations` | shared | Creating a task — runs *after* `chromium` |
| `edits` | shared | Edit, delete, approval, deployments — runs after `mutations` |
| `cleanup` | — | Deletes rows prefixed `e2e <noun> …` |

`cleanup` needs `SUPABASE_SECRET_KEY` and **no-ops without it**, printing a
warning rather than failing. `reseed.setup.ts` sweeps stray tasks before each
run so the board counts stay right, but milestones and deployments created by
the write specs then accumulate until someone deletes them by hand.

Seeded values live in `e2e/seed.ts` rather than being repeated across specs.
Where a value is generated rather than authored (contract IDs, tx hashes) the
specs read it out of the DOM instead of hardcoding it.

Four behaviours are worth knowing before editing the suite:

- **Write specs run last, by project dependency**, and are ordered against each
  other the same way. They insert real rows, which moves the counts the
  read-only specs assert. One shared database means ordering — not isolation —
  is what keeps both honest. `fullyParallel` puts separate *files* on separate
  workers even when each is internally serial, so a new write spec needs its own
  project (chained after the last one) or a home in an existing write file — and
  it must be added to `chromium`'s `testIgnore`, or it runs twice.
- **Never sign out from a spec that uses the shared session.** It is in the
  `anon` project with its own login for that reason.
- **Assertions wait 15s, not the 5s default**, because every page makes real
  network round trips. The tight default surfaced as flakes that passed on
  re-run.
- One spec is `test.skip`ped with its reason inline: no contract-less project is
  seeded, so that branch has no coverage.

- **An unknown project slug renders not-found but responds `200`.** Next returns
  200 for *streamed* responses even when `notFound()` is thrown, and injects
  `noindex` itself. Assert the rendered result, not the status line.
- The `mobile` project exists because the sidebar becomes a sheet below `lg` —
  it is a different navigation path, not the same one at a smaller size.

### Design tokens

`web/src/app/globals.css` is the single source of truth for colour, radius,
motion, elevation and shadow, derived from the design spec: one accent
(`#6D5EF8`) over neutrals tinted toward the brand hue (285°), 10px buttons, 12px
cards, 180–220ms ease-out motion. Gradients are branding-only and never appear
on UI controls.

Depth comes from a light source, never from blur or translucency. Four surface
rungs (`--surface-sunken` → `--background` → `--card` → `--surface-raised`), each
a real luminance step; layered tinted shadows; a 1px top highlight on raised
surfaces. The utilities that apply this are `.surface`, `.surface-raised`,
`.well`, `.lift`, `.row` and `.focus-ring` — prefer them over hand-rolled
`bg-card` + ring combinations, which read as flat cut-outs.

Icons come from `src/lib/icons.ts` — one glyph per concept, imported from there
and never picked inline, so a milestone looks the same in the sidebar, a section
heading and an empty state. They ride inline with headings at 14px and stay
`muted-foreground` unless they mark the page's primary object.

Elevation is an attention ranking, not decoration. Each page names exactly one
primary object (`.surface-primary`, accent heading icon); everything else steps
down, and containers recede below their contents. `<Section priority>` is how a
page declares it — a second one on the same page cancels the first out.

List rows shed optional columns using **container** variants (`@2xl:`, `@4xl:`),
not viewport breakpoints, because the same row renders full-width on `/tasks`
and inside a half-width dashboard panel.

The `text-*` scale is redefined in `@theme` rather than applied per element, so
`text-sm` is 13px app-wide and the whole scale shifts together. `text-3xl` and
above are untouched — that is what keeps the landing page exempt. List rows are
single-line by construction; trailing badge clusters sit in fixed-width,
right-aligned slots so progress bars and status columns line up vertically down
a list.

## Contracts

```bash
cd contracts
cargo test
stellar contract build
```

`milestone_proof` is **deployed to Testnet**; the contract id, WASM hash and
both transaction hashes are published in
[`contracts/README.md`](./contracts/README.md), along with the deploy flow and
the command that regenerates the TypeScript bindings.

### On-chain anchoring

The chain never sees a milestone's content — only a SHA-256 of it, so anyone can
verify a milestone was in a given state at a given time without being handed the
data. `src/lib/milestone-hash.ts` defines exactly what that digest covers.

Anchoring is **additive**: it never writes `milestones.status`. Moving a
milestone through the approval flow and proving it on chain are separate acts,
and they may disagree — a milestone can be approved in the app and not yet
anchored, or anchored under a hash that no longer matches. The UI shows both,
and marks a mismatch `stale` rather than hiding it.

Because the wallet signs in the browser, the flow is three steps rather than one
server action: the server builds and simulates the transaction, the wallet signs
the resulting XDR string, and the server verifies that envelope before
submitting it. **That verification is not optional** — without it a user could
sign any transaction and have the server record it as an anchor. See
`assertInvocation` in `src/lib/chain/client.ts`.

The wallet is an **attestation key, not a login.** Sessions stay with Supabase;
connecting a wallet only decides which account signs. `profiles.wallet_address`
is a convenience field, and the signer written to `milestone_anchors` is read
back out of the verified transaction instead.

Set `NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID` to switch it on. **Leave it empty
and the feature is absent rather than broken** — the controls simply do not
render, which is how CI builds it.

## Database

Migrations are plain SQL under `supabase/migrations/`. Apply them with the
Supabase CLI:

```bash
supabase start           # local stack
supabase db reset        # apply migrations + seed
```

Both migrations are applied to a hosted project, which is what the app and the
Playwright suite run against. `seed.sql` is for the local stack only — see the
security note above.
