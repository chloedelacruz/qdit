-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261024100000_api_requests.sql
--
-- An audit log for the public API (WP-2.1).
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS FOR
-- ---------------------------------------------------------------------------
-- `/api/v1` is the first part of qdit another application drives on a user's
-- behalf: doqtri holds an OAuth access token per connected user (D-02) and
-- calls the API with it. When a user asks "what did doqtri do in my project?",
-- or doqtri quotes an `X-Request-Id` from a failed call, there has to be a
-- record that answers by client, by user and by request. This is that record:
-- one row per authenticated `/api/v1` request — who (client and user), what
-- (method and path) and how it ended (status). The one exception is a caller
-- over its rate limit: only its first 429 in each window gets a row, so a
-- caller hammering past the limit cannot turn each refusal into a write.
--
-- Deliberately not stored: request or response bodies, query strings and
-- headers. The log says that a call happened, not what it carried, so it never
-- becomes a second copy of project data or a place a token could leak into.
--
-- ---------------------------------------------------------------------------
-- WHO WRITES IT, AND WHY NOT A SECURITY DEFINER FUNCTION
-- ---------------------------------------------------------------------------
-- RLS is on with no policies at all, and `anon` and `authenticated` hold no
-- privilege on the table, so no token — first party or OAuth — can read or
-- write it through PostgREST. The only writer is the API's route wrapper
-- (web/src/lib/api/audit.ts), using the secret key, after the response is
-- sent. The integration contract (section 5) names this as the one thing the
-- service role does on the API path.
--
-- The obvious alternative is a SECURITY DEFINER `log_api_request()` granted to
-- `authenticated`. It was rejected: anything granted to `authenticated` is
-- callable straight through PostgREST by every signed-in user and every OAuth
-- token, so the log would record whatever a caller chose to claim about itself
-- (any path, any status) and anyone could flood it. Granted to `service_role`
-- only, it would be an insert with more surface. Writing from the server keeps
-- every value tied to the verified token and to the response actually sent.
--
-- `service_role` gets SELECT and INSERT and nothing else, so even the app's
-- most privileged key cannot rewrite history. Pruning, when it is added, runs
-- as `postgres` (e.g. pg_cron); none is scheduled here.
--
-- ---------------------------------------------------------------------------
-- RATE LIMITING
-- ---------------------------------------------------------------------------
-- The first rate limiter is in memory (web/src/lib/api/handler.ts), per
-- instance. The `(client_id, created_at)` index below is the one a shared,
-- table-backed limiter would count against when one instance stops being true.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------

create table public.api_requests (
  id          uuid primary key default gen_random_uuid(),

  -- The `X-Request-Id` the response carried, so a caller's bug report lands
  -- on exactly one row. Not unique-constrained: it is generated per request
  -- by the server, and an index on it is enough to look one up.
  request_id  uuid not null,

  -- The token's `client_id` claim. Text, not a foreign key: OAuth clients live
  -- in Supabase Auth's own schema, which this migration does not reach into,
  -- and a deleted client's history must outlive the client.
  client_id   text not null check (char_length(client_id) between 1 and 255),

  -- The token's `sub`. Cascades: a deleted account's request history has no
  -- remaining purpose, and keeping it would keep personal data past deletion.
  user_id     uuid not null references auth.users (id) on delete cascade,

  method      text not null
    check (method in ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS')),

  -- Path only, no query string. Restricted to the API so the table cannot be
  -- repurposed as a general-purpose log.
  path        text not null
    check (char_length(path) <= 2048 and path like '/api/v1/%'),

  status      smallint not null check (status between 100 and 599),

  created_at  timestamptz not null default now()
);

comment on table public.api_requests is
  'One row per authenticated /api/v1 request: client, user, method, path, status. Repeat 429s within one rate-limit window are not recorded. Written only by the API server with the secret key; RLS on, no policies.';
comment on column public.api_requests.request_id is
  'X-Request-Id sent on the response. Quote it to find the row.';
comment on column public.api_requests.client_id is
  'OAuth client id from the access token''s client_id claim.';


-- ----------------------------------------------------------------------------
-- 2. Indexes
-- ----------------------------------------------------------------------------

-- "What has this client done lately?" — and the count a shared rate limiter
-- would run.
create index api_requests_client_idx
  on public.api_requests (client_id, created_at desc);

-- "What has been done as me?" Also covers the ON DELETE CASCADE from
-- auth.users, which would otherwise scan the table per deleted account.
create index api_requests_user_idx
  on public.api_requests (user_id, created_at desc);

-- Looking up one request from a quoted X-Request-Id.
create index api_requests_request_id_idx
  on public.api_requests (request_id);

-- Append-only and written in time order, which is BRIN's best case: a pruning
-- `delete ... where created_at < ...` stays cheap at a fraction of a btree's
-- size.
create index api_requests_created_at_brin
  on public.api_requests using brin (created_at);


-- ----------------------------------------------------------------------------
-- 3. Row Level Security and privileges
--
-- RLS on, no policies: for every role subject to RLS the answer is "no rows".
-- The privileges are revoked as well so a policy added by mistake later still
-- opens nothing for `anon` or `authenticated` without a matching GRANT.
-- ----------------------------------------------------------------------------

alter table public.api_requests enable row level security;

revoke all on table public.api_requests from public, anon, authenticated, service_role;
grant select, insert on table public.api_requests to service_role;
