-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260815101500_notifications.sql
--
-- Telling people that something happened to their work.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FIXES
-- ---------------------------------------------------------------------------
-- Five of twenty testers described the same hole. One found out their milestone
-- had been approved by refreshing the page for an unrelated reason. One waited
-- two days on a submission, assumed nobody had seen it, and rated the product
-- 1. Two more said their work was "still sitting there" with no way to tell
-- whether that meant anything.
--
-- Nothing was broken. The app simply never spoke first.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT THE SERVER ACTION
-- ---------------------------------------------------------------------------
-- The row is written by the database, not by whichever code path moved the
-- milestone. A notification written in the application layer is a notification
-- that goes missing the moment a second path appears — a bulk update, a fix
-- applied by hand, an admin tool. The status changing *is* the event, so the
-- trigger fires on the status changing.
--
-- ---------------------------------------------------------------------------
-- WHO GETS ONE
-- ---------------------------------------------------------------------------
-- Every member of the project except whoever caused it. A decision matters to
-- the person who submitted the work, and to everyone who has to plan around it;
-- telling the reviewer what they just did is noise, and noise is how people
-- learn to ignore a bell.
--
-- Deliberately not built here: email. It needs a provider, a domain, a sender
-- reputation and an unsubscribe path, and none of that is what these five
-- testers were missing — they were missing "the app told me". Revisit if the
-- next round still says no email.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Kind
-- ----------------------------------------------------------------------------

-- Named for what happened, not for what the reader should do about it. The UI
-- decides the wording; the database records the event.
create type public.notification_kind as enum (
  'milestone_submitted',
  'milestone_approved',
  'milestone_rejected'
);


-- ----------------------------------------------------------------------------
-- 2. Table
-- ----------------------------------------------------------------------------

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  -- auth.users, not profiles: the recipient is an account, and a missing
  -- profile row must not silently drop somebody's mail.
  recipient_id uuid not null references auth.users (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete cascade,
  kind         public.notification_kind not null,

  -- Rendered at write time and stored. The alternative is joining back to the
  -- milestone on read, which would make an old notification silently describe
  -- the milestone's *current* title — "approved" pointing at work that has
  -- since been renamed and resubmitted. A notification is a record of a moment.
  body         text not null check (char_length(btrim(body)) between 1 and 500),

  -- The actor, kept for attribution in the text and for the "not me" filter.
  actor_id     uuid references auth.users (id) on delete set null,

  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.notifications is
  'Per-recipient record that something happened to work they can see. Written by trigger, never by the client.';
comment on column public.notifications.body is
  'Rendered when the event happened, so it keeps describing that moment even after the milestone changes.';


-- ----------------------------------------------------------------------------
-- 3. Indexes
-- ----------------------------------------------------------------------------

-- The bell's only query: my rows, newest first.
create index notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

-- The unread count, which runs on every page load. Partial, because read rows
-- are the overwhelming majority over time and none of them are ever counted.
create index notifications_unread_idx
  on public.notifications (recipient_id)
  where read_at is null;


-- ----------------------------------------------------------------------------
-- 4. Row Level Security
--
-- A notification is addressed to exactly one person. Membership does not enter
-- into it: the fan-out already happened when the rows were written, and reading
-- somebody else's copy would be reading their mail.
--
-- No INSERT policy at all. Rows come from the trigger below, which is SECURITY
-- DEFINER; a client that could insert here could forge a message from the app.
-- No DELETE policy either — marking read is the only edit, enforced by the
-- UPDATE policy's WITH CHECK clause.
-- ----------------------------------------------------------------------------

alter table public.notifications enable row level security;

create policy "notifications: read own"
  on public.notifications
  for select
  to authenticated
  using (recipient_id = (select auth.uid()));

create policy "notifications: mark own as read"
  on public.notifications
  for update
  to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));


-- ----------------------------------------------------------------------------
-- 5. Fan-out trigger
-- ----------------------------------------------------------------------------

-- SECURITY DEFINER because it writes rows addressed to *other* people, which no
-- policy on this table permits and none should. Same discipline as the RLS
-- helpers in 20260731133313_rls.sql: pinned empty search_path, every identifier
-- schema-qualified, no arguments, and it derives both the actor and the
-- recipients from the row being written rather than from anything a caller
-- controls.
create or replace function public.notify_milestone_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind    public.notification_kind;
  v_actor   uuid := (select auth.uid());
  v_project text;
begin
  -- Only a status move is an event. Renaming a milestone is not news.
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_kind := case new.status
    when 'submitted' then 'milestone_submitted'
    when 'approved'  then 'milestone_approved'
    when 'rejected'  then 'milestone_rejected'
    -- Back to proposed is not a transition the contract allows, so there is no
    -- wording for it and nothing to announce.
    else null
  end;

  if v_kind is null then
    return new;
  end if;

  select p.name into v_project
  from public.projects p
  where p.id = new.project_id;

  insert into public.notifications (recipient_id, project_id, milestone_id, kind, body, actor_id)
  select
    pm.user_id,
    new.project_id,
    new.id,
    v_kind,
    -- Written once, kept forever. Truncated well inside the 500-character
    -- check so a long milestone title cannot make the insert fail and take the
    -- status change down with it.
    left(
      case v_kind
        when 'milestone_submitted' then 'Submitted for approval: '
        when 'milestone_approved'  then 'Approved: '
        else 'Rejected: '
      end || new.title || ' (' || coalesce(v_project, 'a project') || ')',
      500
    ),
    v_actor
  from public.project_members pm
  where pm.project_id = new.project_id
    -- Never notify the person who just did it.
    and pm.user_id is distinct from v_actor;

  return new;
end;
$$;

comment on function public.notify_milestone_status() is
  'Fans a milestone status change out to every project member except the actor. SECURITY DEFINER: writes rows addressed to other users, which no RLS policy allows.';

create trigger milestones_notify_status
  after update of status on public.milestones
  for each row
  execute function public.notify_milestone_status();


-- ----------------------------------------------------------------------------
-- 6. Grants
--
-- Same rule as 20260731133429_function_grants.sql: a trigger function is called
-- by Postgres and never by a client, and this one is SECURITY DEFINER, so
-- leaving it reachable through PostgREST would hand out the ability to write
-- notifications as the app.
-- ----------------------------------------------------------------------------

revoke all on function public.notify_milestone_status() from public, anon, authenticated;
