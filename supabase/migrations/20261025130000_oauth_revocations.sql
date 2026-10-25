-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261025130000_oauth_revocations.sql
--
-- Revocation hardening (WP-2.10), on top of
-- 20261025120600_doc_link_connections.sql. The doc link RPCs' D-60 change
-- follows in 20261025130100_doc_links_from_apps_only.sql.
--
-- ---------------------------------------------------------------------------
-- 1. A REVOKE ENDS THE APP'S ACCESS AT ONCE (D-59)
-- ---------------------------------------------------------------------------
-- Revoking an app in qdit's Settings revokes the grant in Supabase Auth, which
-- stops refreshes but cannot recall an access token already issued: a JWT is
-- valid until its exp (about an hour). Until now /api/v1 kept accepting that
-- token, so "disconnect" took effect up to an hour late.
--
-- qdit now remembers each revoke in oauth_client_revocations, one row per
-- (user, client) holding the latest revoke time, and refuses every token
-- issued at or before it:
--
--   recorded   record_oauth_client_revocation(), called by
--              revokeAuthorizedApp() (web/src/lib/actions.ts) before it asks
--              Auth to revoke the grant, so a disconnect that reports success
--              has always cut the old tokens off. mark_doc_link_connections_
--              revoked(), called after Auth accepted it, upserts the same row
--              again, so either call alone leaves the revoke on record.
--   checked    oauth_token_revoked(), called once per request by authenticate()
--              (web/src/lib/api/auth.ts) with the caller's own token. It reads
--              sub, client_id and iat from that token, so it answers only for
--              the caller, and takes no argument anyone could point elsewhere.
--              The API refuses a revoked token with 401 invalid_token, and
--              answers 503 when the lookup fails rather than letting it pass.
--   re-consent connecting the app again issues tokens with a later iat, which
--              pass. The row stays; it only ever moves forward.
--
-- A token without a numeric iat counts as issued before any revoke. iat has
-- whole seconds, so a token issued in the second of the revoke counts as old
-- too; the comparison is `iat <= revoked_at` on purpose, never the other way
-- round, so it errs on refusing.
--
-- record_doc_link_connection() takes its revoke time from this table as well
-- (the greater of it and the rows' own lost_at), which closes the WP-2.6 gap
-- where a user with no doc link rows revoked, nothing was marked, and a
-- pre-revoke token's later writes recorded live connections.
--
-- Not covered: the same token used against PostgREST directly. The D-03
-- guards still bound what it can do there; checking revocations in every
-- policy is a separate decision, raised with WP-2.10.
--
-- ---------------------------------------------------------------------------
-- 2. ONLY DOQTRI'S CLIENT KEEPS A DOC CARD CONNECTED (D-61)
-- ---------------------------------------------------------------------------
-- doc_link_connections counted a write from any OAuth client. qdit now pins
-- doqtri's client id per environment, the contract's DOQTRI_OAUTH_CLIENT_ID,
-- in a one-row integration_settings table the operator sets in the SQL editor
-- once the client is registered (docs/integration/qdit-oauth-setup.md):
--
--   update public.integration_settings
--      set doqtri_oauth_client_id = '<doqtri client id>';
--
-- record_doc_link_connection() ignores writes from any other client id. While
-- the setting is empty nothing counts as a doqtri connection: every doc card
-- reads "Connection to doqtri lost", each such write raises a WARNING saying
-- why, and so does this migration.
--
-- Both new tables are hidden like the webhook tables: RLS on, no grant to
-- anon or authenticated, and the four restrictive no-OAuth-client guards the
-- tripwire in supabase/tests/oauth_client_guards.test.sql asks for. Only the
-- SECURITY DEFINER functions below and operators reach them.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. oauth_client_revocations
-- ----------------------------------------------------------------------------

create table public.oauth_client_revocations (
  -- The user who revoked. Deleting the account deletes the row; their tokens
  -- stop verifying as a user anyway.
  user_id    uuid not null references auth.users (id) on delete cascade,

  -- The OAuth client revoked (the client_id claim of its tokens).
  client_id  uuid not null,

  -- The latest revoke. Tokens with iat at or before it are refused.
  revoked_at timestamptz not null default now(),

  -- The one lookup, (sub, client_id), is this key.
  primary key (user_id, client_id)
);

comment on table public.oauth_client_revocations is
  'When each user last revoked each OAuth client in qdit Settings (D-59). /api/v1 refuses tokens issued at or before revoked_at; record_doc_link_connection() treats their writes as revoked.';

alter table public.oauth_client_revocations enable row level security;

create policy "oauth_client_revocations: no select by oauth clients"
  on public.oauth_client_revocations
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "oauth_client_revocations: no insert by oauth clients"
  on public.oauth_client_revocations
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "oauth_client_revocations: no update by oauth clients"
  on public.oauth_client_revocations
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "oauth_client_revocations: no delete by oauth clients"
  on public.oauth_client_revocations
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

revoke all on table public.oauth_client_revocations from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. integration_settings
-- ----------------------------------------------------------------------------

create table public.integration_settings (
  -- Always true: the table holds exactly one row.
  id                     boolean primary key default true check (id),

  -- doqtri's OAuth client id in this environment (CONTRACT.md:
  -- DOQTRI_OAUTH_CLIENT_ID). A uuid, as Supabase issues them, so a typo fails
  -- the UPDATE instead of silently matching nothing. Null until the operator
  -- sets it.
  doqtri_oauth_client_id uuid,

  updated_at             timestamptz not null default now()
);

comment on table public.integration_settings is
  'One row of per-environment integration config, set by an operator in the SQL editor. doqtri_oauth_client_id pins which OAuth client counts as doqtri (D-61).';

insert into public.integration_settings (id) values (true);

create trigger integration_settings_set_updated_at
  before update on public.integration_settings
  for each row execute function public.set_updated_at();

alter table public.integration_settings enable row level security;

create policy "integration_settings: no select by oauth clients"
  on public.integration_settings
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "integration_settings: no insert by oauth clients"
  on public.integration_settings
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "integration_settings: no update by oauth clients"
  on public.integration_settings
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "integration_settings: no delete by oauth clients"
  on public.integration_settings
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

revoke all on table public.integration_settings from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. Recording a revoke
-- ----------------------------------------------------------------------------

-- The upsert both revoke RPCs share. Only ever moves revoked_at forward.
-- Called as the owner from inside them; no client may call it.
create or replace function public.upsert_oauth_client_revocation(p_user_id uuid, p_client_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_revoked_at timestamptz;
begin
  insert into public.oauth_client_revocations as r (user_id, client_id, revoked_at)
  values (p_user_id, p_client_id, now())
  on conflict (user_id, client_id) do update
    set revoked_at = greatest(r.revoked_at, excluded.revoked_at)
  returning r.revoked_at into v_revoked_at;

  return v_revoked_at;
end;
$$;

comment on function public.upsert_oauth_client_revocation(uuid, uuid) is
  'Internal. Records that p_user_id revoked p_client_id now (never moving an earlier revoke back); returns the stored revoke time.';


-- Called by revokeAuthorizedApp() before it asks Auth to revoke the grant.
-- Only the caller's own row, and only from the user's own session: an app
-- cannot revoke itself or anyone. Calling it without revoking only makes
-- the caller's current tokens for that app fail until the app refreshes,
-- which harms nobody else.
create or replace function public.record_oauth_client_revocation(p_client_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.assert_first_party_session();

  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  return public.upsert_oauth_client_revocation(auth.uid(), p_client_id);
end;
$$;

comment on function public.record_oauth_client_revocation(uuid) is
  'SECURITY DEFINER, first-party sessions only. Records that the caller revoked p_client_id now, so /api/v1 refuses that app''s tokens issued until now (D-59). Returns the revoke time.';


-- As in 20261025120600, plus the upsert, and lost_at is the recorded revoke
-- time so both tables tell the same time.
create or replace function public.mark_doc_link_connections_revoked(p_client_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_revoked_at timestamptz;
  v_count      integer;
begin
  perform public.assert_first_party_session();

  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  v_revoked_at := public.upsert_oauth_client_revocation(auth.uid(), p_client_id);

  update public.doc_link_connections c
     set lost_at = v_revoked_at,
         lost_reason = 'revoked'
   where c.user_id = auth.uid()
     and c.client_id = p_client_id
     and c.lost_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.mark_doc_link_connections_revoked(uuid) is
  'SECURITY DEFINER, first-party sessions only. Records the caller''s revoke of p_client_id (D-59) and marks their doc link connections through it lost (revoked); returns how many. Called after the user revokes that app in Settings.';


-- ----------------------------------------------------------------------------
-- 4. Checking a token
-- ----------------------------------------------------------------------------

-- True when the request's own token was issued at or before its user's latest
-- revoke of its client. False for a token with no revoke on record, and for
-- a first-party session (no client_id), which /api/v1 refuses on its own.
-- A client_id that is not a UUID cannot have a row, so it is false rather than
-- a failed cast.
create or replace function public.oauth_token_revoked()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims     jsonb := auth.jwt();
  v_client     text := v_claims ->> 'client_id';
  v_iat_text   text := v_claims ->> 'iat';
  v_user       uuid := auth.uid();
  v_revoked_at timestamptz;
begin
  if v_user is null or v_client is null
     or v_client !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  select r.revoked_at
    into v_revoked_at
    from public.oauth_client_revocations r
   where r.user_id = v_user
     and r.client_id = v_client::uuid;

  if v_revoked_at is null then
    return false;
  end if;

  -- No iat, or one that is not a number: counted as old. (`is null` first:
  -- a regex match against null is null, which IF reads as false.)
  if v_iat_text is null or v_iat_text !~ '^[0-9]{1,12}(\.[0-9]+)?$' then
    return true;
  end if;

  return to_timestamp(v_iat_text::double precision) <= v_revoked_at;
end;
$$;

comment on function public.oauth_token_revoked() is
  'SECURITY DEFINER. Whether the caller''s own token (sub, client_id, iat from the request JWT) was issued at or before that user''s latest revoke of that client (D-59). Called once per /api/v1 request by authenticate(); takes no argument, so it answers for nobody else.';


-- ----------------------------------------------------------------------------
-- 5. record_doc_link_connection(): doqtri's client only, and the revoke time
-- from both tables
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
  v_doqtri     uuid;
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

  -- Only doqtri's client keeps a doc card connected (D-61).
  select s.doqtri_oauth_client_id
    into v_doqtri
    from public.integration_settings s;

  if v_doqtri is null then
    raise warning 'doc_link_connections: integration_settings.doqtri_oauth_client_id is not set, so this write by OAuth client % is not recorded as a doqtri connection',
      v_client
      using hint = 'Set it once doqtri''s OAuth client is registered, see docs/integration/qdit-oauth-setup.md.';
    return null;
  end if;

  if v_client::uuid <> v_doqtri then
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

  -- When this user last revoked this client: the revoke on record (D-59), or,
  -- for revokes from before it existed, the latest one any of their rows
  -- remembers.
  select greatest(
           (select r.revoked_at
              from public.oauth_client_revocations r
             where r.user_id = v_user
               and r.client_id = v_client::uuid),
           (select max(c.lost_at)
              from public.doc_link_connections c
             where c.user_id = v_user
               and c.client_id = v_client::uuid
               and c.lost_reason = 'revoked'))
    into v_revoked_at;

  if v_iat_text ~ '^[0-9]{1,12}(\.[0-9]+)?$' then
    v_iat := to_timestamp(v_iat_text::double precision);
  end if;

  -- A token from before that revoke (or with no iat to tell) is one doqtri
  -- held when the user revoked it: see "stale token" in 20261025120600.
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
  'AFTER INSERT OR UPDATE on project_doc_links and milestone_external_links: for a write by doqtri''s OAuth client (integration_settings, D-61), records (doc link, user, client) as a live connection, unless the token was issued at or before that user''s latest revoke of that client (D-59). Other clients and first-party writes record nothing.';


-- ----------------------------------------------------------------------------
-- 6. Grants
--
-- The helpers run only inside the functions that use them, as their owner.
-- record_oauth_client_revocation() goes to authenticated (and refuses apps
-- itself); oauth_token_revoked() to authenticated, which is what the API's
-- client, carrying the caller's OAuth token, runs as.
-- ----------------------------------------------------------------------------

revoke all on function public.upsert_oauth_client_revocation(uuid, uuid) from public, anon, authenticated;

revoke all on function public.record_oauth_client_revocation(uuid) from public, anon;
grant execute on function public.record_oauth_client_revocation(uuid) to authenticated, service_role;

revoke all on function public.oauth_token_revoked() from public, anon;
grant execute on function public.oauth_token_revoked() to authenticated, service_role;


-- Every fresh environment starts without doqtri's client id. Say so where the
-- operator applying migrations sees it.
do $warn$
begin
  if not exists (
    select 1 from public.integration_settings s where s.doqtri_oauth_client_id is not null
  ) then
    raise warning 'integration_settings.doqtri_oauth_client_id is not set: no OAuth write counts as a doqtri connection, so every doc card reads "Connection to doqtri lost"'
      using hint = 'After registering doqtri''s OAuth client: update public.integration_settings set doqtri_oauth_client_id = ''<client id>''; see docs/integration/qdit-oauth-setup.md.';
  end if;
end;
$warn$;
