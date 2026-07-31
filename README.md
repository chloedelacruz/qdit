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

## Web app

```bash
cd web
cp .env.example .env.local     # fill in your Supabase project values
npm install
npm run dev
```

Other commands: `npm run build`, `npm run lint`, `npm run typecheck`.

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

The specs assert against the fixtures in `src/lib/placeholder-data.ts`, so
swapping in real queries will break them by design — rewrite those assertions
against seeded database rows at the same time.

The dashboard, board and milestone pages currently render from
`web/src/lib/placeholder-data.ts`. That module is scaffolding — replace each
usage with a Supabase query and delete it.

### Design tokens

`web/src/app/globals.css` is the single source of truth for colour, radius,
motion and shadow, derived from the design spec: one accent (`#6D5EF8`) over
neutral slate surfaces, 10px buttons, 12px cards, 180–220ms ease-out motion.
Gradients are branding-only and never appear on UI controls.

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

Nothing has been applied to a hosted Supabase project yet — no project is linked.
