# Masterplan

This repo is half of the doqtri x qdit suite; doqtri is the other half.
Before any work, read the masterplan at https://claude.ai/artifact/FnsDQiVqnwBqToZjXHFCWf
with the Artifact tool's `read` action. Never web-fetch it.
Cite its work package and decision ids (`WP-x.y`, `D-xx`) in branch names and commit messages.
App-specific rules for `web/` live in `web/AGENTS.md`.

# End-to-end tests

The Playwright suite (`npm run test:e2e`) runs only on a local machine, never on CI.
Do not add a workflow, a CI job or a hook that runs it: it would waste CI time.

It runs against production, through `web/.env.local`. There is no staging environment
until there is budget for an always-on staging branch, so do not create a Supabase branch
for a run. A full run writes to production (see README.md). Never apply `supabase/seed.sql`
to a hosted project. This repository is public: no real email address or password goes in
that file.

# Pull requests

Every pull request targets `main`. Merging to `main` deploys to production.
