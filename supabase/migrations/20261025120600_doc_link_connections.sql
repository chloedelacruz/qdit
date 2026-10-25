-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261025120600_doc_link_connections.sql
--
-- Which doqtri connections keep a plan doc linked (WP-2.6), so qdit's doc
-- card can say "Connection to doqtri lost" from its own data.
--
-- ---------------------------------------------------------------------------
-- WHY qdit NEEDS THIS
-- ---------------------------------------------------------------------------
-- qdit is the OAuth provider and holds no token for doqtri (D-02), so the doc
-- card is built from qdit's own link rows. Those rows are copies doqtri keeps
-- fresh through /api/v1, under some user's OAuth grant: the admin who linked
-- the doc, and the members whose saves rename or re-point its milestones. When
-- every one of those grants is gone, nothing will refresh the copies again,
-- and the card has to say so instead of showing them as current.
--
-- A grant itself lives in Supabase Auth, which a session can only list for
-- its own user (`auth.oauth.listGrants()`): a viewer's page cannot ask about
-- the linker's. So qdit records it here, as it happens:
--
--   written     every write an OAuth client makes to a doc link or one of its
--               milestone links records (doc link, user, client) as live.
--               First-party writes record nothing: they are not doqtri's.
--   revoked     revoking an app in qdit's Settings marks that user's rows for
--               that client lost (mark_doc_link_connections_revoked(), called
--               by the revoke action right after Auth accepts it).
--   left        leaving a project (the membership row going) marks that user's
--               rows for the project's docs lost: their token can no longer
--               write there.
--   deleted     deleting the account deletes its rows (on delete cascade).
--
-- A doc link is connected while at least one of its rows is live (lost_at is
-- null). A new write through an app makes its row live again, so reconnecting
-- doqtri and saving the doc restores the card, with one exception:
--
--   stale token  revoking cannot recall an access token doqtri already holds
--                (Auth cannot unsign a JWT; it stays valid until exp, and
--                CONTRACT.md section 5 accepts it). A write made with a token
--                issued (iat) at or before the user's latest revoke of that
--                client, as recorded on any of their rows, does not revive
--                anything: it only refreshes last_write_at on an existing row,
--                and a first write to another doc records that row as already
--                revoked. A token without a numeric iat counts as old. iat has
--                whole seconds, so a token issued in the second of the revoke
--                counts as old too; doqtri's next refresh fixes that.
--
-- Known limits: a grant that ends outside qdit's revoke action (the OAuth
-- client deleted by an operator, a refresh token that lapsed) is not seen
-- here; neither is a role dropping to viewer without leaving. Two limits this
-- file had are closed by 20261025130000_oauth_revocations.sql: a revoke by a
-- user with no live rows is now remembered there (D-59), and only doqtri's
-- pinned client id counts (D-61).
--
-- ---------------------------------------------------------------------------
-- WHO MAY DO WHAT
-- ---------------------------------------------------------------------------
-- Read: viewer and above of the doc link's project, like the link itself, and
-- only the columns the card needs (doc_link_id, lost_at, lost_reason): who
-- authorized doqtri, through which client and when they last wrote is each
-- user's own grant bookkeeping, not something teammates need to see.
-- Write: nobody directly. The rows are written by the SECURITY DEFINER
-- triggers and the revoke RPC below; authenticated gets SELECT only.
-- OAuth clients see nothing (restrictive guards, as for the webhook tables):
-- this is qdit's own bookkeeping about grants, not data D-03 lets an app read.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------

create table public.doc_link_connections (
  id            uuid primary key default gen_random_uuid(),

  -- The doc link this connection has written. Unlinking the doc ends it.
  doc_link_id   uuid not null references public.project_doc_links (id) on delete cascade,

  -- The qdit user whose grant made the write. Deleting the account deletes
  -- the row: a deleted account's grant is gone with it.
  user_id       uuid not null references auth.users (id) on delete cascade,

  -- The OAuth client (the request JWT's client_id claim) that wrote it.
  client_id     uuid not null,

  -- The newest write through this (user, client) for this doc.
  last_write_at timestamptz not null default now(),

  -- Set when the grant stopped being usable for this doc; null while live.
  lost_at       timestamptz,
  lost_reason   text,

  constraint doc_link_connections_key unique (doc_link_id, user_id, client_id),
  constraint doc_link_connections_lost_check check (
    (lost_at is null and lost_reason is null)
    or (lost_at is not null and lost_reason in ('revoked', 'left_project'))
  )
);

comment on table public.doc_link_connections is
  'Which (user, OAuth client) pairs have written a doqtri doc link or its milestone links, and whether that grant is still usable. A doc link with no live row has lost its connection to doqtri (WP-2.6 doc card).';
comment on column public.doc_link_connections.lost_reason is
  'revoked: the user revoked the app in qdit Settings. left_project: the user is no longer a member of the doc''s project.';

-- The revoke RPC looks rows up by user and client; leaving, by user.
create index doc_link_connections_user_idx
  on public.doc_link_connections (user_id, client_id);


-- ----------------------------------------------------------------------------
-- 2. Recording writes
--
-- One trigger function for both link tables. It runs AFTER the write, as its
-- owner, and only for a request JWT with a client_id claim: a write through
-- doqtri's token, whichever path it took (the API's RPCs, PostgREST directly,
-- or a trigger such as sync_link_node_label() running inside one).
--
-- The column lists on the UPDATE triggers leave out the author columns, so the
-- `on delete set null` of linked_by / created_by when an account is deleted
-- records nothing.
-- ----------------------------------------------------------------------------

create or replace function public.record_doc_link_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client     text := auth.jwt() ->> 'client_id';
  v_user       uuid := auth.uid();
  v_iat_text   text := auth.jwt() ->> 'iat';
  v_iat        timestamptz;
  v_link_id    uuid;
  v_revoked_at timestamptz;
begin
  -- Supabase issues client ids as UUIDs. Anything else is not recorded rather
  -- than cast: a failed cast here would fail the write it is watching.
  if v_client is null or v_user is null
     or v_client !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  if tg_table_name = 'project_doc_links' then
    v_link_id := new.id;
  else
    select d.id
      into v_link_id
      from public.project_doc_links d
     where d.project_id = new.project_id
       and d.doc_id = new.doc_id;
  end if;

  -- The composite foreign key on milestone_external_links makes a missing doc
  -- link impossible; this is only belt and braces.
  if v_link_id is null then
    return null;
  end if;

  -- When this user last revoked this client, if any of their rows remembers.
  select max(c.lost_at)
    into v_revoked_at
    from public.doc_link_connections c
   where c.user_id = v_user
     and c.client_id = v_client::uuid
     and c.lost_reason = 'revoked';

  if v_iat_text ~ '^[0-9]{1,12}(\.[0-9]+)?$' then
    v_iat := to_timestamp(v_iat_text::double precision);
  end if;

  -- A token from before that revoke (or with no iat to tell) is one doqtri
  -- held when the user revoked it: see "stale token" in the header.
  if v_revoked_at is not null and (v_iat is null or v_iat <= v_revoked_at) then
    insert into public.doc_link_connections (doc_link_id, user_id, client_id, lost_at, lost_reason)
    values (v_link_id, v_user, v_client::uuid, v_revoked_at, 'revoked')
    on conflict on constraint doc_link_connections_key do update
      set last_write_at = now();
    return null;
  end if;

  insert into public.doc_link_connections (doc_link_id, user_id, client_id)
  values (v_link_id, v_user, v_client::uuid)
  on conflict on constraint doc_link_connections_key do update
    set last_write_at = now(),
        lost_at       = null,
        lost_reason   = null;

  return null;
end;
$$;

comment on function public.record_doc_link_connection() is
  'AFTER INSERT OR UPDATE on project_doc_links and milestone_external_links: for a write by an OAuth client, records (doc link, user, client) as a live connection, unless the token was issued at or before that user''s latest revoke of that client. First-party writes record nothing.';

create trigger project_doc_links_record_connection
  after insert or update of doc_title, doc_url on public.project_doc_links
  for each row execute function public.record_doc_link_connection();

create trigger milestone_external_links_record_connection
  after insert or update of node_id, node_label, doc_version on public.milestone_external_links
  for each row execute function public.record_doc_link_connection();


-- ----------------------------------------------------------------------------
-- 3. Losing a connection
-- ----------------------------------------------------------------------------

-- Called by revokeAuthorizedApp() (web/src/lib/actions.ts) once Supabase Auth
-- has revoked the grant. Only the caller's own rows, and only from the user's
-- own session: an app cannot mark itself, or anyone, disconnected. Calling it
-- without revoking only makes the caller's own links read as lost until
-- doqtri writes with a token issued after the call (its next refresh), which
-- harms nobody else.
create or replace function public.mark_doc_link_connections_revoked(p_client_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform public.assert_first_party_session();

  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  update public.doc_link_connections c
     set lost_at = now(),
         lost_reason = 'revoked'
   where c.user_id = auth.uid()
     and c.client_id = p_client_id
     and c.lost_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.mark_doc_link_connections_revoked(uuid) is
  'SECURITY DEFINER, first-party sessions only. Marks the caller''s doc link connections through p_client_id lost (revoked); returns how many. Called after the user revokes that app in Settings.';


create or replace function public.mark_doc_link_connections_left()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.doc_link_connections c
     set lost_at = now(),
         lost_reason = 'left_project'
    from public.project_doc_links d
   where d.id = c.doc_link_id
     and d.project_id = old.project_id
     and c.user_id = old.user_id
     and c.lost_at is null;
  return null;
end;
$$;

comment on function public.mark_doc_link_connections_left() is
  'AFTER DELETE on project_members: marks the departed user''s connections to that project''s doc links lost (left_project).';

create trigger project_members_mark_doc_link_connections_left
  after delete on public.project_members
  for each row execute function public.mark_doc_link_connections_left();


-- ----------------------------------------------------------------------------
-- 4. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.doc_link_connections enable row level security;

create policy "doc_link_connections: read as member"
  on public.doc_link_connections
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.project_doc_links d
       where d.id = doc_link_connections.doc_link_id
         and public.is_project_member(d.project_id, 'viewer')
    )
  );

-- The guards every table carries (20261024110000_oauth_client_guards.sql),
-- here closing the table to apps entirely, reads included.
create policy "doc_link_connections: no select by oauth clients"
  on public.doc_link_connections
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "doc_link_connections: no insert by oauth clients"
  on public.doc_link_connections
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "doc_link_connections: no update by oauth clients"
  on public.doc_link_connections
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "doc_link_connections: no delete by oauth clients"
  on public.doc_link_connections
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 5. Grants
--
-- Read only for authenticated, and only the three columns the card selects
-- (see WHO MAY DO WHAT): a `select *` or a read of user_id, client_id or
-- last_write_at is refused. No permissive write policy exists either, so the
-- triggers and the RPC above are the only writers. The trigger functions
-- are called by Postgres alone (20260731133429_function_grants.sql's rule).
-- ----------------------------------------------------------------------------

revoke all on table public.doc_link_connections from public, anon, authenticated;
grant select (doc_link_id, lost_at, lost_reason) on table public.doc_link_connections to authenticated;

revoke all on function public.record_doc_link_connection()     from public, anon, authenticated;
revoke all on function public.mark_doc_link_connections_left() from public, anon, authenticated;

revoke all on function public.mark_doc_link_connections_revoked(uuid) from public, anon;
grant execute on function public.mark_doc_link_connections_revoked(uuid) to authenticated, service_role;
