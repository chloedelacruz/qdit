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

The database and the web app are **joined**: the UI reads and writes a hosted
Postgres with RLS enforced. The contract is the layer still standing alone —
built and tested, but never deployed and not reachable from the app.

| Layer | State |
|---|---|
| Database | 7 tables, 6 enums, triggers, indexes, 28 RLS policies. **Applied to a hosted project and seeded.** |
| Contract | All 5 spec'd functions, 12 tests + snapshots. Not deployed; no Stellar SDK in `web/`. |
| Web UI | Auth, project-scoped routing, filtering with URL state, dense lists, elevation system. **Reads and writes real Postgres**; 93 Playwright specs pass against it. |

Working end to end: sign in / sign up / sign out, the auth gate, every read,
creating **projects, tasks, milestones and proofs**, and moving a task between
statuses from either the board or a list row.

Every create form is built on `src/components/form-dialog.tsx` — one shell, so
pending state, error placement and the close-only-on-success rule cannot drift
between them. Add a new entity by writing fields, not another dialog.

Not started, roughly in dependency order:

1. **Editing beyond status** — a task's title, assignee, milestone and due date
   cannot be changed after creation, and nothing can be deleted. The status
   control (`src/components/task-status-menu.tsx`) is the pattern to follow.
2. **Drag and drop on the board** — status changes go through a menu today.
3. **Contract integration** — deploy `milestone_proof` to Testnet, add
   `@stellar/stellar-sdk`, wire submit/approve from the milestone UI.
4. **Scale UX still open** — bulk actions, inline create, command palette and
   keyboard navigation, and a priority field (needs a migration). The `.row`,
   `.stagger` and `.focus-ring` primitives exist for these.

> **Security note.** `supabase/seed.sql` contains `qdit-local-dev` in plaintext and
> its header says it is for the local stack only. It was nonetheless applied to
> the hosted project, where those accounts were reachable from the public
> internet using only the publishable key. The passwords have been rotated, but
> **`qdit-local-dev` remains in git history** — removing it needs a history rewrite
> (`git filter-repo` / BFG). Never apply `seed.sql` to a hosted project.

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
`.env.example`) for an account that belongs to at least one project. Credentials
are never written into a spec file.

Playwright projects, in order:

| Project | Session | Covers |
|---|---|---|
| `setup` | — | Signs in once, saves `e2e/.auth/user.json` |
| `anon` | none | The auth gate, login form, sign-out |
| `chromium` | shared | Every read-only spec |
| `mutations` | shared | The write path — runs *after* `chromium` |
| `cleanup` | — | Deletes rows titled `e2e task …` |

Seeded values live in `e2e/seed.ts` rather than being repeated across specs.
Where a value is generated rather than authored (contract IDs, tx hashes) the
specs read it out of the DOM instead of hardcoding it.

Four behaviours are worth knowing before editing the suite:

- **Write specs run last, by project dependency.** They insert real rows, which
  moves the counts the read-only specs assert. One shared database means
  ordering — not isolation — is what keeps both honest.
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

See [`contracts/README.md`](./contracts/README.md) for the deploy flow.

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
