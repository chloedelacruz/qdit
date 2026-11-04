# qdit against a real doqtri

`npm run test:doqtri` (from `web/`) runs qdit and doqtri together: two
deployed apps, two Supabase projects, qdit's real OAuth server, real webhook
delivery and doqtri's real DoqtriRegistry reads on testnet. Nothing is
stubbed. Each of qdit's other suites stands in for doqtri: Vitest mocks it,
and doqtri's e2e suite uses a contract stub of qdit (DOQ-16). Issue: QDIT-1.

It is not part of `npm test` or `npm run test:e2e`, and CI does not run it.
It writes to both apps, so it runs only when someone asks for it, and only
against a pair that is not production.

## What it covers

The six connections in the masterplan's architecture section, one spec each:

| Spec | Connection | Checks |
| --- | --- | --- |
| `01-oauth-connect` | OAuth connect (WP-2.2, WP-2.3) | Deny connects nothing. Allow goes doqtri → qdit's `/oauth/authorize` with PKCE → `/oauth/consent` → doqtri's callback, and doqtri stores the qdit subject. The token is doqtri's UUID client (D-77). `/api/v1` refuses a tampered token and a first-party session token. |
| `02-api` | API calls (WP-2.1, WP-2.4) | doqtri lists the project (`can_link`). Linking writes qdit's doc link on `<doqtri origin>/d/<id>`. A heading becomes a linked milestone, and the same heading again is `409 node_already_linked`. Off-origin `doc_url` values are `400` on `doc_url` (D-45, D-95). Unsupported methods are `404` with no `Allow` (D-27). Unlinking clears qdit's links (D-22). |
| `03-webhooks` | Webhooks (WP-2.7, WP-2.9) | The delivery route refuses a wrong cron secret and reports `doqtriOrigin: match` and `scheduler: configured` (D-57, D-95). Submitting a linked milestone in qdit's UI writes an outbox event. Delivery signs it, doqtri answers 2xx and records the event id and qdit's status. doqtri refuses an unsigned body. |
| `04-revocation` | Revocation (WP-2.10; D-59, D-75, D-76) | Revoking doqtri in qdit's Settings refuses the live token at once: on `/api/v1` (`401`, `invalid_token`), on the `link_project_doc` RPC (`42501`) and on a guarded table write. doqtri asks for a reconnect, and qdit's doc card says "Connection to doqtri lost". Reconnecting works again. |
| `05-proof-chain` | Proof chain (WP-3.2, WP-3.3; D-77, D-78, D-83, D-94, D-95) | For an unanchored milestone: four steps in order, none past the plan Done. The anonymous RPC's `docSource` is exactly `docId`, `docVersion`, `nodeLabel` and `projectId`. For a milestone walked by hand (below): both public pages Done on all four steps, the same approval tx, the `artifact_ref` grammar as plain text, and "Open in doqtri" landing on `/d/<doc>`. "Current proof hash" has no tx link. |
| `06-doc-card` | Doc card and Planned in doqtri (WP-2.6, WP-3.2) | qdit's project page shows the linked note, live. The public page's "Planned in doqtri" links doqtri by doc id, shows no doc title, and reads the real registry (`unsigned`, not `unreachable`). doqtri's milestone card reads the milestone back from qdit. |

### What stays manual

The chain steps of release plan S6 step 1 stay manual: anchor the note, submit
in qdit, sign the heading Built, approve, sign it Verified. Each one is a
wallet prompt in one of the two apps. A test cannot answer the prompt without
a signing path the apps do not have. So `05-proof-chain` checks the *result*
of that walk once it has been done by hand. Set `DOQTRI_IT_WALKED_QDIT_PAGE`
and `DOQTRI_IT_WALKED_DOC_ID` to point at the walked milestone. Without them,
those four tests are skipped and the run is not a full pass.

Also manual:

- S6 step 5: the receipt with Horizon blocked (D-85).
- S6 step 7: the integration flag turned off, and the phone-width layout.
- S6 step 8: a reload within 30 s of approving (D-97). It needs an approval
  at test time.
- S6 step 9: another network or contract (D-93, D-94). It needs a second
  contract. The local gate covers it.

| Release plan S6 | Here |
| --- | --- |
| 1. One item end to end | Manual chain steps; the result is checked by `05-proof-chain` (walked). The off-chain parts (connect, link, milestone from a heading) are `01`, `02`. |
| 2. Outsider check | `05-proof-chain` (walked), logged-out context |
| 3. D-83 | `05-proof-chain` (walked) |
| 4. Privacy (D-77, D-95) | `05-proof-chain` |
| 5. D-85, Horizon blocked | manual |
| 6. D-59 and D-75 | `04-revocation` |
| 7. Flags, phone width | manual |
| 8. D-97 | manual |
| 9. D-93 and D-94 | manual (optional; the local gate covers it) |

## The pair it runs against

Run it against one of these:

- **Both apps locally**, each against its own non-production Supabase project
  (`npm run dev` in qdit's `web/` and in doqtri's `doqtri/frontend/`, on two
  ports).
- **Hand-made previews**, as release plan S6 describes. Never a git deploy of
  a non-`main` branch (D-58).

The pair must be wired as release plan S4 and S5 describe, on the
non-production projects:

1. qdit's Supabase Auth runs the OAuth 2.1 server, with Authorization Path
   `/oauth/consent` and ES256 JWT keys. doqtri is registered as a confidential
   client (`client_secret_basic`) with a UUID client id. Its redirect URI is
   `<doqtri origin>/api/integrations/qdit/callback`.
2. qdit's `DOQTRI_ORIGIN`, `integration_settings.doqtri_origin` and doqtri's
   `NEXT_PUBLIC_SITE_URL` are the same string. `integration_settings.doqtri_oauth_client_id`
   is doqtri's client id.
3. qdit has its webhook row for doqtri's
   `/api/integrations/qdit/webhook` (`scripts/integration-webhook-secret.mjs`),
   the Vault secrets `qdit_deliver_webhooks_url` and `qdit_cron_secret`, and
   `CRON_SECRET`. doqtri's `QDIT_WEBHOOK_SECRET` is the signing secret.
4. doqtri has `NEXT_PUBLIC_QDIT_INTEGRATION=1` and its `QDIT_*` settings
   pointing at this qdit.
5. Both name the same DoqtriRegistry and network (D-84).

## Configuration

Set these in the shell or in `web/.env.local` (git-ignored).
`web/.env.example` lists them empty. The suite refuses to start when any
required one is missing. It also refuses when either origin is a production
host (`qdit.app`, `qdit.atalusan.com`, `doqtri.xyz`, `www.doqtri.xyz`), or when
either Supabase project is not listed in `DOQTRI_IT_ALLOWED_SUPABASE_REFS`.

| Variable | What it is |
| --- | --- |
| `DOQTRI_IT_QDIT_ORIGIN` | qdit's origin |
| `DOQTRI_IT_DOQTRI_ORIGIN` | doqtri's origin; equal to qdit's `DOQTRI_ORIGIN` |
| `DOQTRI_IT_QDIT_SUPABASE_URL` | qdit's Supabase project URL. The OAuth issuer is its `/auth/v1`. |
| `DOQTRI_IT_QDIT_SUPABASE_PUBLISHABLE_KEY` | its publishable key |
| `DOQTRI_IT_QDIT_SUPABASE_SECRET_KEY` | its secret key: creating the test project, reading the outbox, cleanup |
| `DOQTRI_IT_QDIT_CRON_SECRET` | qdit's `CRON_SECRET` |
| `DOQTRI_IT_DOQTRI_SUPABASE_URL` | doqtri's Supabase project URL |
| `DOQTRI_IT_DOQTRI_SUPABASE_ANON_KEY` | its publishable key, to write doqtri's session cookies |
| `DOQTRI_IT_DOQTRI_SUPABASE_SERVICE_ROLE_KEY` | its service role key: seeding notes, read-back, cleanup |
| `DOQTRI_IT_DOQTRI_OAUTH_CLIENT_ID` | doqtri's client id on this qdit (doqtri's `QDIT_OAUTH_CLIENT_ID`) |
| `DOQTRI_IT_DOQTRI_OAUTH_CLIENT_SECRET` | that client's secret (doqtri's `QDIT_CLIENT_SECRET`) |
| `DOQTRI_IT_ALLOWED_SUPABASE_REFS` | comma-separated refs of the two projects above; production only together with `DOQTRI_IT_ALLOW_PRODUCTION` |
| `DOQTRI_IT_ALLOW_PRODUCTION` | optional; exactly `i-know-this-writes-to-production` lifts the production-host check (owner decision, 4 Nov 2026, to avoid a second Supabase pair). The teardown removes the suite's `qdit-it` rows |
| `DOQTRI_IT_SEED` | optional; salt for the test wallets (default `doqtri-it`) |
| `DOQTRI_IT_WALKED_QDIT_PAGE` | optional; `/p/<slug>/<milestone id>` of the hand-walked milestone |
| `DOQTRI_IT_WALKED_DOC_ID` | optional; the doqtri doc it is linked to |

Why the suite holds doqtri's client secret: doqtri keeps its tokens sealed
on its server. To check qdit's side of the contract with a token for doqtri's
client, the suite runs the same authorization-code grant doqtri runs. It uses
PKCE and doqtri's registered redirect URI, and intercepts the redirect before
doqtri spends the code (`clientToken` in `world.ts`).

## Accounts and data

- **Accounts.** One person, with a qdit account and a doqtri account, each
  signed in with a wallet derived from `DOQTRI_IT_SEED`. Neither sign-in
  touches the ledger, so the wallets are never funded. The qdit account is
  registered through `/register` on the first run, as `dqit_<hash>`. The
  accounts are kept and reused on later runs.
- **Per spec.** Each spec makes its own qdit project (slug `dqit-…`, public
  proofs on) and doqtri note (title `DQIT …`), and deletes them in
  `afterAll`. Deleting the project removes its doc links, milestones, links
  and outbox events in qdit. doqtri's `qdit_milestone_states` rows for it are
  removed by project id.
- **Sweep.** `global-teardown.ts` sweeps anything a crashed run left behind,
  using the same prefixes.
- **Not cleaned.** doqtri's `qdit_webhook_events` ids are not deleted. doqtri
  keeps them for its own idempotency window. The OAuth grant for doqtri stays
  in qdit between runs, and each spec revokes it at its start.

## Output

`integration/doqtri/.results/` holds traces and screenshots of failures and
`report.json`. It is git-ignored.
