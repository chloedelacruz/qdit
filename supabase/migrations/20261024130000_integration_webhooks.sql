-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261024130000_integration_webhooks.sql
--
-- The webhook qdit sends doqtri (WP-2.7): where it goes, the outbox it is
-- sent from, and the triggers that fill the outbox. The contract is
-- docs/integration/CONTRACT.md section 9.
--
-- ---------------------------------------------------------------------------
-- WHAT IS STORED
-- ---------------------------------------------------------------------------
--   integration_webhooks   one row per OAuth client that receives events: its
--                          client id, the URL, the signing secret (encrypted,
--                          see below) and an `active` switch. It also names
--                          the link `source` whose milestones it hears about,
--                          so an event about a doqtri-linked milestone only
--                          ever goes to doqtri's endpoint. In v1 that is one
--                          row: doqtri.
--   integration_events     the outbox. One row per emission and per webhook,
--                          and its `id` is the event id doqtri dedupes on.
--                          The row is the body (ids and a status, nothing
--                          else) plus its delivery state: attempts, the next
--                          attempt, delivered or dead, the last error.
--
-- ---------------------------------------------------------------------------
-- WHEN AN EVENT IS WRITTEN (contract section 9, D-26)
-- ---------------------------------------------------------------------------
-- For a milestone that has a milestone_external_links row, and only then:
--
--   * milestones.status changes. Its own AFTER UPDATE trigger, next to
--     notify_milestone_status() (20260815051105_notifications.sql), which is
--     not touched: notifications and webhooks are separate audiences and
--     neither should be able to break the other's trigger by being edited;
--   * a milestone_anchors row is recorded, even when the status does not
--     move. `status` is what that contract call produced: submit ->
--     submitted, approve -> approved, reject -> rejected.
--
-- A transaction that does both writes two events, which the contract allows
-- (doqtri re-reads the chain for each). The trigger writes the row in the
-- same transaction as the change, so a rolled-back change never emits, and
-- a committed one always has its row: that is why it is an outbox and not a
-- call from the server action.
--
-- `occurred_at` is cut to milliseconds when it is written, so the body sent
-- on every retry is the same bytes (the contract's timestamps have
-- milliseconds, and JavaScript's Date cannot carry more).
--
-- ---------------------------------------------------------------------------
-- DELIVERY (web/src/app/api/cron/deliver-webhooks/route.ts)
-- ---------------------------------------------------------------------------
-- A Vercel cron calls the route every minute. It claims due events with
-- claim_integration_events(), posts them, and reports each outcome with
-- record_integration_delivery(). Both are SECURITY DEFINER, granted to
-- service_role only, and the route holds the secret key for exactly this.
--
--   Order (D-25). Only the head of each (webhook, milestone) queue can be
--   claimed: the earliest event, by `occurred_at` and then `seq` (insertion
--   order), that is neither delivered nor dead. A later event waits behind
--   it without spending attempts; its own schedule starts when it becomes the
--   head, because its `next_attempt_at` only moves when it is tried.
--   Different milestones never wait on each other.
--
--   Attempts. Claiming counts the attempt and leases the row
--   (`next_attempt_at` moves past the lease, `claim_token` is set), so two
--   overlapping cron runs cannot send one event twice, and a run that dies
--   mid-delivery still used up the attempt rather than retrying forever.
--   The backoff schedule (1 min ... 12 h, +/-10% jitter) lives in
--   web/src/lib/webhooks/backoff.ts; the database holds the cap: an event is
--   dead after its 8th failed attempt whatever the caller asks for, and a
--   lease that ran out on the 8th attempt is marked dead at the next claim.
--
--   Idempotent. A report only lands with the claim's token, and only while
--   the row is still pending, so a repeated or stale report changes nothing.
--   Retries resend the same `id` (contract section 9), so doqtri dedupes them.
--
-- ---------------------------------------------------------------------------
-- THE SIGNING SECRET: ENCRYPTED BY THE APP, NOT STORED IN CLEAR
-- ---------------------------------------------------------------------------
-- Three places it could live were weighed:
--
--   * Plain text here. Rejected: anyone who reads the table, a backup or a
--     log of it can forge webhooks doqtri trusts.
--   * Supabase Vault (`vault.secrets`). Encrypted at rest, but decrypted
--     inside the database for any session that can read
--     vault.decrypted_secrets, so a leaked service key or a SQL session as
--     postgres reads it in clear. It also needs the extension in every
--     environment, the local test harness included.
--   * A pointer to an env var. The secret never touches the database, but
--     it is in clear in the host's env store, and a row could point the
--     signer at any other env var.
--
-- Chosen: AES-256-GCM in the app (web/src/lib/webhooks/secret-box.ts), with
-- the key in the server env as INTEGRATION_WEBHOOK_ENCRYPTION_KEY and only
-- ciphertext here. Reading the secret takes both the database and the app's
-- env; either one alone yields nothing usable. The ciphertext is bound to
-- the row's `client_id` (GCM additional data), so a ciphertext copied onto
-- another client's row does not decrypt. This is also what the contract's
-- data-ownership table says ("encrypted in integration_webhooks").
--
-- `next_secret_ciphertext` is for rotation: while it is set, every delivery
-- carries two signatures (`sha256=<current>,sha256=<next>`, section 9), so
-- doqtri can switch its QDIT_WEBHOOK_SECRET at any moment; then the next
-- secret becomes the current one and the column is cleared.
--
-- Rows are written by an operator in the SQL editor;
-- web/scripts/integration-webhook-secret.mjs generates a secret, encrypts it
-- and prints the statement.
--
-- ---------------------------------------------------------------------------
-- ACCESS
-- ---------------------------------------------------------------------------
-- RLS on, no permissive policy, no grant to anon or authenticated: no token,
-- first party or OAuth, reads or writes either table. The restrictive OAuth
-- guards every table carries (20261024110000_oauth_client_guards.sql) are
-- added too, SELECT included, since an app has no business reading another
-- client's URL or the outbox. service_role may read the outbox, to inspect
-- dead events; it writes it only through the two functions.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table public.integration_webhooks (
  id                     uuid primary key default gen_random_uuid(),

  -- The OAuth client this endpoint belongs to. Text, as in api_requests:
  -- OAuth clients live in Supabase Auth's own schema.
  client_id              text not null check (char_length(client_id) between 1 and 255),

  -- Which milestone links it hears about: milestone_external_links.source.
  -- One provider in v1 (D-08), and one endpoint for it.
  link_source            text not null default 'doqtri' check (link_source = 'doqtri'),

  -- https, or plain http to the local machine for development. Nothing else:
  -- the body is signed, not encrypted, and the URL is posted to by the server.
  target_url             text not null check (
    char_length(target_url) <= 2048
    and (
      target_url ~ '^https://[^/?#[:space:]]+'
      or target_url ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?(/|$)'
    )
  ),

  -- `v1.<iv>.<ciphertext+tag>`, base64url; see the header.
  secret_ciphertext      text not null
    check (secret_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),
  next_secret_ciphertext text
    check (next_secret_ciphertext ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$'),

  active                 boolean not null default true,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint integration_webhooks_client_id_key unique (client_id),
  constraint integration_webhooks_link_source_key unique (link_source)
);

comment on table public.integration_webhooks is
  'Where qdit sends milestone events: one row per receiving OAuth client (doqtri in v1). The signing secret is AES-256-GCM ciphertext under INTEGRATION_WEBHOOK_ENCRYPTION_KEY, never plain text.';
comment on column public.integration_webhooks.secret_ciphertext is
  'Signing secret, encrypted by web/src/lib/webhooks/secret-box.ts with the row''s client_id as additional data.';
comment on column public.integration_webhooks.next_secret_ciphertext is
  'Set during rotation: deliveries are then signed with both secrets.';


create table public.integration_events (
  -- The event id: the body's `id`, doqtri's idempotency key.
  id               uuid primary key default gen_random_uuid(),

  -- Insertion order, the tie-break after occurred_at (D-25).
  seq              bigint generated always as identity,

  webhook_id       uuid not null references public.integration_webhooks (id) on delete cascade,
  milestone_id     uuid not null references public.milestones (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,

  -- The one event type in v1.
  event            text not null default 'milestone.status_changed'
    check (event = 'milestone.status_changed'),

  -- The body's `status`: the milestone's new status, or what the anchored
  -- contract call produced.
  status           public.milestone_status not null,

  -- Why it was emitted. Not sent; for whoever inspects the outbox.
  cause            text not null check (cause in ('status_changed', 'anchor_recorded')),

  -- Milliseconds, so the body is the same bytes on every retry (header).
  occurred_at      timestamptz not null default date_trunc('milliseconds', now()),

  -- Delivery state.
  attempts         smallint not null default 0 check (attempts between 0 and 8),
  next_attempt_at  timestamptz not null default now(),
  claim_token      uuid,
  delivered_at     timestamptz,
  dead_at          timestamptz,
  last_error       text check (char_length(last_error) <= 500),

  created_at       timestamptz not null default now(),

  constraint integration_events_seq_key unique (seq),
  constraint integration_events_one_outcome check (delivered_at is null or dead_at is null)
);

comment on table public.integration_events is
  'Webhook outbox (contract section 9). One row per emission per webhook; id is the event id. Written by trigger, delivered by /api/cron/deliver-webhooks, in order per milestone (D-25).';


-- ----------------------------------------------------------------------------
-- 2. Indexes
-- ----------------------------------------------------------------------------

-- The claim: pending rows, per queue, in queue order. Partial, because
-- delivered rows are almost all of them and none is ever claimed.
create index integration_events_pending_idx
  on public.integration_events (webhook_id, milestone_id, occurred_at, seq)
  where delivered_at is null and dead_at is null;

-- The cascades from milestones and projects.
create index integration_events_milestone_idx on public.integration_events (milestone_id);
create index integration_events_project_idx   on public.integration_events (project_id);

-- "What died?", for whoever is on call.
create index integration_events_dead_idx
  on public.integration_events (dead_at desc)
  where dead_at is not null;


-- ----------------------------------------------------------------------------
-- 3. updated_at
-- ----------------------------------------------------------------------------

create trigger integration_webhooks_set_updated_at
  before update on public.integration_webhooks
  for each row execute function public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 4. Enqueue triggers
--
-- SECURITY DEFINER: they write a table no client may write, from a change a
-- client made. Both derive everything from the row being written and from
-- the link table, never from the caller. enqueue_integration_event() is the
-- shared insert and is callable by nobody but them.
-- ----------------------------------------------------------------------------

create or replace function public.enqueue_integration_event(
  p_milestone_id uuid,
  p_status       public.milestone_status,
  p_cause        text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- No link, no event; no active webhook for the link's source, no event.
  -- The link's project is the milestone's (check_milestone_external_link()).
  insert into public.integration_events (webhook_id, milestone_id, project_id, status, cause)
  select w.id, l.milestone_id, l.project_id, p_status, p_cause
    from public.milestone_external_links l
    join public.integration_webhooks w
      on w.link_source = l.source
     and w.active
   where l.milestone_id = p_milestone_id;
end;
$$;

comment on function public.enqueue_integration_event(uuid, public.milestone_status, text) is
  'Writes one integration_events row per active webhook for a linked milestone; nothing for an unlinked one. Called only by the enqueue triggers.';


create or replace function public.enqueue_milestone_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform public.enqueue_integration_event(new.id, new.status, 'status_changed');
  end if;
  return null;
end;
$$;

comment on function public.enqueue_milestone_status_event() is
  'AFTER UPDATE OF status on milestones: queues milestone.status_changed for a linked milestone. Runs beside notify_milestone_status(), which it does not replace.';

create trigger milestones_enqueue_integration_event
  after update of status on public.milestones
  for each row
  execute function public.enqueue_milestone_status_event();


create or replace function public.enqueue_anchor_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_integration_event(
    new.milestone_id,
    case new.action
      when 'submit'  then 'submitted'
      when 'approve' then 'approved'
      when 'reject'  then 'rejected'
    end::public.milestone_status,
    'anchor_recorded'
  );
  return null;
end;
$$;

comment on function public.enqueue_anchor_event() is
  'AFTER INSERT on milestone_anchors: queues milestone.status_changed for a linked milestone with the status the contract call produced (D-26).';

create trigger milestone_anchors_enqueue_integration_event
  after insert on public.milestone_anchors
  for each row
  execute function public.enqueue_anchor_event();


-- ----------------------------------------------------------------------------
-- 5. Delivery functions, for the cron route only (service_role)
-- ----------------------------------------------------------------------------

create or replace function public.claim_integration_events(
  p_limit         integer default 20,
  p_lease_seconds integer default 120
)
returns table (
  id                     uuid,
  webhook_id             uuid,
  milestone_id           uuid,
  project_id             uuid,
  event                  text,
  status                 public.milestone_status,
  occurred_at            timestamptz,
  attempts               integer,
  claim_token            uuid,
  client_id              text,
  target_url             text,
  secret_ciphertext      text,
  next_secret_ciphertext text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_token uuid := gen_random_uuid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_lease interval := make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900)));
begin
  -- A run that claimed an 8th attempt and never reported back: its lease is
  -- over and no attempt is left, so it is dead, which releases the next one.
  update public.integration_events e
     set dead_at = now(),
         claim_token = null,
         last_error = coalesce(e.last_error || '; ', '') || 'last attempt did not report back'
   where e.delivered_at is null
     and e.dead_at is null
     and e.attempts >= 8
     and e.next_attempt_at <= now();

  return query
  with heads as (
    -- The head of each (webhook, milestone) queue (D-25).
    select distinct on (h.webhook_id, h.milestone_id) h.id
      from public.integration_events h
     where h.delivered_at is null
       and h.dead_at is null
     order by h.webhook_id, h.milestone_id, h.occurred_at, h.seq
  ),
  due as (
    -- Re-checked against the newest row version once locked, so a row
    -- another run claimed (or settled) after this statement's snapshot is
    -- skipped, not sent twice.
    select d.id
      from public.integration_events d
     where d.id in (select heads.id from heads)
       and d.delivered_at is null
       and d.dead_at is null
       and d.next_attempt_at <= now()
       and d.attempts < 8
       and exists (
         select 1 from public.integration_webhooks w
          where w.id = d.webhook_id and w.active
       )
     order by d.next_attempt_at, d.seq
     limit v_limit
     for update of d skip locked
  ),
  claimed as (
    update public.integration_events e
       set attempts = e.attempts + 1,
           next_attempt_at = now() + v_lease,
           claim_token = v_token
      from due
     where e.id = due.id
    returning e.id, e.webhook_id, e.milestone_id, e.project_id, e.event, e.status,
              e.occurred_at, e.attempts, e.claim_token, e.seq
  )
  select c.id, c.webhook_id, c.milestone_id, c.project_id, c.event, c.status,
         c.occurred_at, c.attempts::integer, c.claim_token,
         w.client_id, w.target_url, w.secret_ciphertext, w.next_secret_ciphertext
    from claimed c
    join public.integration_webhooks w on w.id = c.webhook_id
   order by c.seq;
end;
$$;

comment on function public.claim_integration_events(integer, integer) is
  'SECURITY DEFINER, service_role only. Claims up to p_limit due events, at most one per (webhook, milestone) and only the head of that queue (D-25); counts the attempt and leases the row. Returns each with its webhook URL and secret ciphertext.';


create or replace function public.record_integration_delivery(
  p_id              uuid,
  p_claim_token     uuid,
  p_delivered       boolean,
  p_error           text,
  p_next_attempt_at timestamptz
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_outcome text;
begin
  update public.integration_events e
     set delivered_at    = case when p_delivered then now() end,
         dead_at         = case
                             when p_delivered then null
                             when e.attempts >= 8 or p_next_attempt_at is null then now()
                           end,
         next_attempt_at = case
                             when p_delivered or e.attempts >= 8 or p_next_attempt_at is null
                               then e.next_attempt_at
                             else p_next_attempt_at
                           end,
         last_error      = case when p_delivered then e.last_error else left(p_error, 500) end,
         claim_token     = null
   where e.id = p_id
     and e.claim_token = p_claim_token
     and e.delivered_at is null
     and e.dead_at is null
  returning case
              when e.delivered_at is not null then 'delivered'
              when e.dead_at is not null then 'dead'
              else 'retry'
            end
    into v_outcome;

  -- Not this claim's row any more (a repeat, or a lease that ran out and was
  -- claimed again): nothing changes.
  return coalesce(v_outcome, 'stale');
end;
$$;

comment on function public.record_integration_delivery(uuid, uuid, boolean, text, timestamptz) is
  'SECURITY DEFINER, service_role only. Settles one claimed attempt: delivered, retry at p_next_attempt_at, or dead (no next attempt, or the 8th attempt failed). Only with the claim''s token; returns delivered | retry | dead | stale.';


-- ----------------------------------------------------------------------------
-- 6. Row Level Security
--
-- No permissive policy: no client role sees or writes a row. The restrictive
-- guards are the ones every table carries (see the header).
-- ----------------------------------------------------------------------------

alter table public.integration_webhooks enable row level security;
alter table public.integration_events   enable row level security;

create policy "integration_webhooks: no select by oauth clients"
  on public.integration_webhooks
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "integration_webhooks: no insert by oauth clients"
  on public.integration_webhooks
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "integration_webhooks: no update by oauth clients"
  on public.integration_webhooks
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "integration_webhooks: no delete by oauth clients"
  on public.integration_webhooks
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


create policy "integration_events: no select by oauth clients"
  on public.integration_events
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "integration_events: no insert by oauth clients"
  on public.integration_events
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "integration_events: no update by oauth clients"
  on public.integration_events
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "integration_events: no delete by oauth clients"
  on public.integration_events
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 7. Grants
--
-- Tables: nothing for anon or authenticated; service_role may read the outbox
-- and nothing else. Functions: the trigger functions and the shared insert
-- are called by Postgres only (20260731133429_function_grants.sql's rule);
-- the two delivery functions go to service_role alone.
-- ----------------------------------------------------------------------------

revoke all on table public.integration_webhooks from public, anon, authenticated, service_role;
revoke all on table public.integration_events   from public, anon, authenticated, service_role;
grant select on table public.integration_events to service_role;

revoke all on function public.enqueue_integration_event(uuid, public.milestone_status, text)
  from public, anon, authenticated, service_role;
revoke all on function public.enqueue_milestone_status_event() from public, anon, authenticated, service_role;
revoke all on function public.enqueue_anchor_event()           from public, anon, authenticated, service_role;

revoke all on function public.claim_integration_events(integer, integer) from public, anon, authenticated;
revoke all on function public.record_integration_delivery(uuid, uuid, boolean, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_integration_events(integer, integer) to service_role;
grant execute on function public.record_integration_delivery(uuid, uuid, boolean, text, timestamptz)
  to service_role;
