-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261112150000_hackathon_released_event.sql
--
-- QDIT-67 (WP-4.7, DOQ-54): tell doqtri when a hackathon's grades are
-- released, so the public mindmap links sent for it stop working 24 hours
-- later. The event is `hackathon.released` (contract v1.5.0, section 9):
--
--   {"id": "<event uuid>", "event": "hackathon.released",
--    "hackathon_slug": "...", "released_at": "<ISO 8601>", "occurred_at": "<ISO 8601>"}
--
-- It goes through the outbox, signing, cron delivery and retries that
-- milestone.status_changed uses (20261024130000_integration_webhooks.sql):
-- nothing new is sent any other way.
--
-- ---------------------------------------------------------------------------
-- WHAT
-- ---------------------------------------------------------------------------
--   1. integration_events gains hackathon_id, hackathon_slug and released_at.
--      milestone_id, project_id and status become nullable; a check pins
--      each event type to its own columns, so a milestone event still always
--      has its milestone, project and status, and a release event has its
--      hackathon, slug and time and nothing of a milestone's. `event` and
--      `cause` each take the one new value.
--   2. One release event per hackathon per webhook, enforced by a partial
--      unique index: a second release attempt, a replay of the trigger, or
--      the backfill below run twice, writes nothing.
--   3. claim_integration_events() returns hackathon_slug and released_at
--      too (its return type changes, so it is dropped and created again with
--      the same grants). The queue key becomes (webhook, milestone) for a
--      milestone event and the event itself for a release event, so a
--      release event waits for nothing and nothing waits for it; D-25 order
--      per milestone is unchanged.
--   4. enqueue_hackathon_released_event(), the trigger on hackathons that
--      calls it when released_at goes from null to a time (only
--      release_hackathon_grades() does that, once, D-116), and the backfill
--      for hackathons released before this migration.
--
-- ---------------------------------------------------------------------------
-- WHICH ENDPOINT GETS IT
-- ---------------------------------------------------------------------------
-- A milestone event goes to the webhook whose link_source is the milestone's
-- link source, and only when the milestone has a link. A release is not tied
-- to a link. What it is about, the mindmap links, exists only for doqtri: the
-- `mindmap_url` of POST /hackathon-snapshots, which only doqtri's OAuth
-- client may call (D-117, D-61). So it goes to every integration_webhooks
-- row whose link_source is 'doqtri' — the one doqtri row in v1, since
-- link_source is unique — and to nothing else. It is not narrowed to
-- hackathons doqtri sent a snapshot to: the slug is an id (the body carries
-- nothing else), doqtri ignores a slug it holds no links for, and a later
-- snapshot cannot arrive (nothing is open after release,
-- hackathon_window_state()).
--
-- Unlike a milestone event it is queued for that row even while the row is
-- inactive. A milestone event is a hint that doqtri also gets by re-reading
-- the chain, so one dropped during a pause costs nothing; a release event is
-- sent once and is the only way doqtri learns when links expire. While the
-- row is inactive the claim skips it, as it skips every event of an inactive
-- webhook, and it goes out once the row is active again.
--
-- ---------------------------------------------------------------------------
-- BODY BYTES
-- ---------------------------------------------------------------------------
-- released_at is copied into the event cut to milliseconds, like
-- occurred_at, so every retry sends the same bytes (the contract's
-- timestamps have milliseconds and JavaScript's Date carries no more). The
-- slug is copied too: it cannot change once a snapshot was sent to the
-- hackathon (update_hackathon(), slug_locked), and the copy means a body
-- never changes between attempts whatever happens to the row.
--
-- Delivered rows are pruned after 30 days by the claim, as before; the
-- partial unique index then no longer holds the slot, but released_at never
-- goes back to null (nothing in qdit clears it), so the trigger cannot fire
-- for that hackathon again.
--
-- No grant changes: the tables stay closed to every client role, the new
-- functions are callable by Postgres only, and the two delivery functions go
-- to service_role alone, as in 20261024130000_integration_webhooks.sql
-- section 7.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The outbox takes a second event type
-- ----------------------------------------------------------------------------

alter table public.integration_events
  alter column milestone_id drop not null,
  alter column project_id   drop not null,
  alter column status       drop not null,
  add column hackathon_id   uuid references public.hackathons (id) on delete cascade,
  add column hackathon_slug text check (hackathon_slug ~ '^[a-z0-9-]{1,64}$'),
  add column released_at    timestamptz;

alter table public.integration_events
  drop constraint integration_events_event_check,
  drop constraint integration_events_cause_check;

alter table public.integration_events
  add constraint integration_events_event_check
    check (event in ('milestone.status_changed', 'hackathon.released')),
  add constraint integration_events_cause_check
    check (cause in ('status_changed', 'anchor_recorded', 'hackathon_released')),
  -- Each type carries its own columns and none of the other's.
  add constraint integration_events_shape check (
    (    event = 'milestone.status_changed'
     and cause in ('status_changed', 'anchor_recorded')
     and milestone_id is not null and project_id is not null and status is not null
     and hackathon_id is null and hackathon_slug is null and released_at is null)
    or
    (    event = 'hackathon.released'
     and cause = 'hackathon_released'
     and hackathon_id is not null and hackathon_slug is not null and released_at is not null
     and milestone_id is null and project_id is null and status is null)
  );

-- Once per hackathon per webhook (header, 2).
create unique index integration_events_hackathon_released_key
  on public.integration_events (webhook_id, hackathon_id)
  where event = 'hackathon.released';

-- The cascade from hackathons.
create index integration_events_hackathon_idx
  on public.integration_events (hackathon_id)
  where hackathon_id is not null;

comment on table public.integration_events is
  'Webhook outbox (contract section 9). One row per emission per webhook; id is the event id. milestone.status_changed rows are written by the milestone triggers and delivered in order per milestone (D-25); hackathon.released rows (QDIT-67) once per hackathon by the hackathons trigger, each its own queue. Delivered by /api/cron/deliver-webhooks.';
comment on column public.integration_events.hackathon_slug is
  'hackathon.released only: the slug as it was when the event was written, sent as hackathon_slug.';
comment on column public.integration_events.released_at is
  'hackathon.released only: hackathons.released_at cut to milliseconds, sent as released_at.';


-- ----------------------------------------------------------------------------
-- 2. The claim: one more event type, its own queue per release event
--
-- The same function as in 20261024130000_integration_webhooks.sql section 5,
-- with two more result columns and the queue key of the header (3). Its
-- return type changes, so it is dropped first; nothing in the database calls
-- it (the cron route does, through PostgREST).
-- ----------------------------------------------------------------------------

drop function public.claim_integration_events(integer, integer);

create function public.claim_integration_events(
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
  hackathon_slug         text,
  released_at            timestamptz,
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
  -- Delivered more than 30 days ago: past doqtri's 7-day dedupe window, so
  -- of no further use. Bounded per call; dead rows are kept.
  delete from public.integration_events e
   where e.id in (
     select p.id
       from public.integration_events p
      where p.delivered_at < now() - interval '30 days'
      order by p.delivered_at
      limit 500
   );

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
    -- The head of each queue: (webhook, milestone) for a milestone event
    -- (D-25), the event itself for a release event (header, 3).
    select distinct on (h.webhook_id, coalesce(h.milestone_id, h.id)) h.id
      from public.integration_events h
     where h.delivered_at is null
       and h.dead_at is null
     order by h.webhook_id, coalesce(h.milestone_id, h.id), h.occurred_at, h.seq
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
              e.hackathon_slug, e.released_at, e.occurred_at, e.attempts, e.claim_token, e.seq
  )
  select c.id, c.webhook_id, c.milestone_id, c.project_id, c.event, c.status,
         c.hackathon_slug, c.released_at,
         c.occurred_at, c.attempts::integer, c.claim_token,
         w.client_id, w.target_url, w.secret_ciphertext, w.next_secret_ciphertext
    from claimed c
    join public.integration_webhooks w on w.id = c.webhook_id
   order by c.seq;
end;
$$;

comment on function public.claim_integration_events(integer, integer) is
  'SECURITY DEFINER, service_role only. Prunes events delivered over 30 days ago, then claims up to p_limit due events: only the head of each (webhook, milestone) queue for milestone.status_changed (D-25), and any due hackathon.released event (its own queue, QDIT-67); counts the attempt and leases the row. Returns each with its body columns, webhook URL and secret ciphertext.';

revoke all on function public.claim_integration_events(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_integration_events(integer, integer) to service_role;


-- ----------------------------------------------------------------------------
-- 3. Enqueue: the trigger on hackathons, and the backfill
-- ----------------------------------------------------------------------------

create or replace function public.enqueue_hackathon_released_event(p_hackathon_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Every doqtri webhook, active or not (header). Nothing for a hackathon
  -- that is not released; nothing a second time (the partial unique index).
  insert into public.integration_events
    (webhook_id, event, cause, hackathon_id, hackathon_slug, released_at)
  select w.id, 'hackathon.released', 'hackathon_released',
         h.id, h.slug, date_trunc('milliseconds', h.released_at)
    from public.hackathons h
    cross join public.integration_webhooks w
   where h.id = p_hackathon_id
     and h.released_at is not null
     and w.link_source = 'doqtri'
  on conflict (webhook_id, hackathon_id) where event = 'hackathon.released' do nothing;
end;
$$;

comment on function public.enqueue_hackathon_released_event(uuid) is
  'Writes one hackathon.released integration_events row per doqtri webhook (active or not) for a released hackathon, at most once per hackathon and webhook (QDIT-67, contract v1.5.0 section 9). Called by the hackathons trigger and this migration''s backfill only.';


create or replace function public.enqueue_hackathon_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_hackathon_released_event(new.id);
  return null;
end;
$$;

comment on function public.enqueue_hackathon_release() is
  'AFTER INSERT or UPDATE OF released_at on hackathons, when released_at is set and was not: queues hackathon.released (QDIT-67). In the same transaction as release_hackathon_grades(), so a rolled-back release emits nothing.';

create trigger hackathons_enqueue_released_event
  after update of released_at on public.hackathons
  for each row
  when (old.released_at is null and new.released_at is not null)
  execute function public.enqueue_hackathon_release();

-- An operator inserting a hackathon that is already released (no app path
-- does) still sends its one event.
create trigger hackathons_enqueue_released_event_on_insert
  after insert on public.hackathons
  for each row
  when (new.released_at is not null)
  execute function public.enqueue_hackathon_release();

revoke all on function public.enqueue_hackathon_released_event(uuid) from public, anon, authenticated, service_role;
revoke all on function public.enqueue_hackathon_release()            from public, anon, authenticated, service_role;


-- Hackathons released before this migration: one event each, with their
-- original released_at (contract v1.5.0, section 9). Their links then expire
-- 24 hours after that time, at once if it is already past.
do $backfill$
declare
  v_id uuid;
begin
  for v_id in select h.id from public.hackathons h where h.released_at is not null order by h.released_at, h.id loop
    perform public.enqueue_hackathon_released_event(v_id);
  end loop;
end;
$backfill$;
