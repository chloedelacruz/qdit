# Setting up qdit for doqtri

Operator steps that make one qdit environment (a Supabase project and the
Vercel deployment in front of it) ready for doqtri to connect. The API,
OAuth, webhook and data rules themselves are in
[`CONTRACT.md`](./CONTRACT.md); this file only says what to switch on and
where. Do it once per environment, in this order.

Nothing here is done by a migration: every step is a dashboard setting, an
environment variable or a statement in the SQL editor. Values in `<angle
brackets>` are per environment.

## 0. Before you start

- All qdit migrations are applied, through
  `20261025130100_doc_links_from_apps_only.sql`. The last two print a
  WARNING until steps 4 and 6 below are done; that is expected.
- You know both origins exactly, scheme and host, no path:
  `https://<qdit host>` and `https://<doqtri host>`. `www.` or not matters:
  qdit compares doqtri's origin character for character (step 5).

## 1. Sign JWTs with an asymmetric key

Supabase Dashboard > **Project Settings > JWT Keys**: create an asymmetric
signing key (**ES256** recommended, RS256 also works) and make it the
current key.

Why it is required, not optional:

- qdit's `/api/v1` accepts only ES256 and RS256 tokens whose `kid` is in
  `<issuer>/.well-known/jwks.json` (`web/src/lib/api/auth.ts`). A project
  still signing with the legacy HS256 secret issues tokens that qdit
  refuses, so every doqtri call is `401`.
- doqtri asks for the `openid` scope, and Supabase cannot sign an ID token
  with HS256.

After switching, check that `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`
lists the new key.

## 2. Turn on the OAuth 2.1 server

1. **Authentication > URL Configuration**: the **Site URL** is
   `https://<qdit host>`. Supabase builds the consent URL from it.
2. **Authentication > OAuth Server**: enable it, and set the
   **Authorization Path** to `/oauth/consent`. The consent page is then
   `https://<qdit host>/oauth/consent`, which is qdit's
   `web/src/app/oauth/consent` page.
3. Leave dynamic client registration off. doqtri is registered by hand
   (step 3), and no other client should be able to register itself.

Discovery is then at
`https://<project-ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`.

## 3. Register doqtri as a confidential client

**Authentication > OAuth Apps > Add**:

| Field | Value |
| --- | --- |
| Name | `doqtri` (shown on qdit's consent page and in Settings > Authorized apps) |
| Client type | Confidential |
| Redirect URI | `https://<doqtri host>/api/integrations/qdit/callback` |
| Token endpoint auth method | `client_secret_basic` (the default for confidential clients) |

doqtri requests the `openid` scope; make sure it is allowed for the client.

Copy the **client id** and the **client secret**. The secret is shown once;
if it is lost, regenerate it on the same page and update doqtri. In doqtri's
environment:

- `QDIT_OAUTH_CLIENT_ID` = the client id
- `QDIT_CLIENT_SECRET` = the client secret
- `QDIT_OAUTH_ISSUER` = `https://<project-ref>.supabase.co/auth/v1`
- `QDIT_API_BASE_URL` = `https://<qdit host>/api/v1`

The client id is the contract's `DOQTRI_OAUTH_CLIENT_ID` for this
environment. qdit needs it too: step 4.

## 4. Tell qdit which client is doqtri

qdit keeps doqtri's client id in the one-row `integration_settings` table
(D-61), not in an environment variable, because the database uses it: only
writes made with doqtri's tokens keep a plan doc's card connected. In the
SQL editor:

```sql
update public.integration_settings
   set doqtri_oauth_client_id = '<doqtri client id>';

select doqtri_oauth_client_id, updated_at from public.integration_settings;
```

The column is a `uuid`, so a typo fails the update instead of matching
nothing. While it is empty, no OAuth write counts as doqtri's: every doc
card reads "Connection to doqtri lost", and each such write logs a WARNING
naming the setting. If doqtri is ever re-registered with a new client id,
run the update again and change `integration_webhooks.client_id` (step 7)
to match.

## 5. qdit's environment

On the qdit deployment (`web/.env.example` documents each one):

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://<qdit host>` |
| `DOQTRI_ORIGIN` | `https://<doqtri host>`, exactly doqtri's origin |
| `SUPABASE_SECRET_KEY` | the project's secret key (audit log and webhook delivery) |
| `CRON_SECRET` | a long random string, e.g. `openssl rand -base64 32` |
| `INTEGRATION_WEBHOOK_ENCRYPTION_KEY` | `node scripts/integration-webhook-secret.mjs --generate-key` (from `web/`) |

`DOQTRI_ORIGIN` must equal the origin doqtri builds its doc URLs from
(doqtri's `NEXT_PUBLIC_SITE_URL`). qdit accepts a `doc_url` only when it
starts with `DOQTRI_ORIGIN` followed by `/` (D-45, D-72): an apex host
against a `www.` host, or a preview host against production, makes every
link attempt `400` on `doc_url`. Set `NEXT_PUBLIC_SITE_URL` in doqtri
explicitly rather than relying on its fallbacks.

`NEXT_PUBLIC_*` values are built in; redeploy after changing them.

## 6. Vault secrets for webhook delivery

The pg_cron job delivers webhooks every minute by calling qdit's delivery
route. It reads the route's URL and the `CRON_SECRET` from Vault, and sends
nothing until both are there. In the SQL editor:

```sql
select vault.create_secret('https://<qdit host>/api/cron/deliver-webhooks',
                           'qdit_deliver_webhooks_url');
select vault.create_secret('<the CRON_SECRET from step 5>', 'qdit_cron_secret');

-- 'configured' once both are stored and the job is scheduled.
select public.webhook_scheduler_health();
```

The Vercel cron in `web/vercel.json` is a once-a-day backstop: Hobby
projects allow at most daily crons, and only on production deployments.

## 7. The webhook endpoint row

From `web/`, with the key from step 5 in the environment:

```bash
INTEGRATION_WEBHOOK_ENCRYPTION_KEY=<key> node scripts/integration-webhook-secret.mjs \
  --client-id <doqtri client id> \
  --url https://<doqtri host>/api/integrations/qdit/webhook
```

It prints the plain signing secret, which goes into doqtri as
`QDIT_WEBHOOK_SECRET`, and an `insert into public.integration_webhooks`
holding only the ciphertext, which you run in the SQL editor. `--rotate`
does the same for a rotation (see the script's header).

## 8. Check it

- doqtri, Profile > Connected apps > **Connect qdit**: qdit's consent page
  names doqtri and its redirect host; approving returns to doqtri as
  "Connected".
- qdit, Settings > Authorized apps lists doqtri.
- Link a note to a project from doqtri, then open the project's Plan docs
  in qdit: the card is connected (step 4 done) and its link opens doqtri
  (step 5 done).
- Revoke doqtri in qdit Settings. doqtri's next call is refused straight
  away (D-59), doqtri shows "Reconnect needed", and the doc card says the
  connection was lost.
- `select public.webhook_scheduler_health();` answers `configured`, and
  `integration_events.delivered_at` is set after a milestone status change.
