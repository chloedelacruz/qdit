-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261111120000_hackathon_list_for_clients.sql
--
-- QDIT-60 (WP-4.7, D-122): the read behind GET /api/v1/hackathons, so
-- doqtri's Send to qdit hackathon dialog can offer a list instead of asking
-- for a pasted link. Contract v1.3.0, section 8. One new function; no table,
-- policy or existing function changes.
--
-- ---------------------------------------------------------------------------
-- WHY A FUNCTION
-- ---------------------------------------------------------------------------
-- public.hackathons keeps its restrictive "no select by oauth clients" guard
-- (20261110100000_hackathons.sql), and APP_READ_SCOPE and the
-- oauth_client_guards tripwire keep it on the hidden list: no OAuth app reads
-- the table through PostgREST, with this endpoint or without it. An app sees
-- the list only through list_open_hackathons_for_client(), which applies the
-- listing rules itself and returns five fields, the way
-- push_doqtri_hackathon_snapshot() performs the one hackathon write an app
-- may make. Staff, entries, grades, late passes, the description and `hidden`
-- itself never leave it.
--
-- ---------------------------------------------------------------------------
-- WHAT IT LISTS
-- ---------------------------------------------------------------------------
-- The hackathons qdit's Hackathons index and site banner list to everyone
-- (web/src/lib/hackathon/banner.ts):
--   - hidden is false (QDIT-56);
--   - the slug does not start with `test-` (a rehearsal, QDIT-51);
--   - closes_at is still ahead, so open and upcoming ones.
-- A hidden hackathon is not listed even to its own staff, and a closed one
-- not even to a project holding a late pass: the snapshot endpoint still
-- takes that hackathon's slug, so a late pass is sent by link.
--
-- Order opens_at asc, slug asc; at most 50 (the contract does not page yet).
-- state is `open` while opens_at <= now < closes_at, else `upcoming`. One
-- clock reading answers both the filter and the state, so a row is never
-- listed with a state its own filter disagrees with. clock_timestamp(), like
-- every hackathon window check (20261110100000_hackathons.sql header).
--
-- name is btrim'd and cut to 200 characters. The table's check already holds
-- btrim(name) to 1..200, so the cut never bites; it is what the contract
-- promises ("plain text, 1 to 200 characters"), stated where the row leaves
-- the database. The route strips control and bidi characters on top, as the
-- Hackathons index does (toPlainText(h.name, 200)).
--
-- ---------------------------------------------------------------------------
-- WHO MAY CALL
-- ---------------------------------------------------------------------------
-- Any signed-in caller: an OAuth app's token or a first-party session. Not
-- OAuth-only, unlike push_doqtri_hackathon_snapshot(), and not first-party
-- only, unlike every other hackathon RPC:
--   - the other /api/v1 reads (projects, milestones, the caller's profile) are
--     plain RLS reads that a first-party session can make as well; what keeps
--     a session off /api/v1 is authenticate() in the route, which refuses a
--     token without client_id (contract section 5), not the database;
--   - a first-party session already reads every hackathons row, hidden ones
--     included ("hackathons: read when signed in"), so this function shows it
--     nothing new, while refusing it would protect nothing;
--   - the OAuth-only rule of push_doqtri_hackathon_snapshot() is about a
--     write only doqtri may make (D-117). This is a read every authorised
--     client may make (D-122), so it does not check which client either.
-- What it does refuse: no user (42501; anon has no EXECUTE anyway), and an
-- OAuth token whose user disconnected the app (42501, D-59, D-96). RLS does
-- not run inside a SECURITY DEFINER function, so the revoke check that the
-- route's authenticate() makes once per request is repeated here for a
-- caller who goes to PostgREST directly, as push_doqtri_hackathon_snapshot()
-- does.
--
-- Errors: 42501 not signed in, or a revoked OAuth token.
-- ============================================================================


create or replace function public.list_open_hackathons_for_client()
returns table (
  slug      text,
  name      text,
  opens_at  timestamptz,
  closes_at timestamptz,
  state     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  -- False for a first-party session (no client_id); true for an app's token
  -- issued at or before its user's latest disconnect, or with a client_id
  -- that is not a UUID (D-96).
  if public.oauth_token_revoked() then
    raise exception 'This app''s access to qdit was revoked.' using errcode = '42501';
  end if;

  return query
  select h.slug,
         pg_catalog.left(pg_catalog.btrim(h.name), 200),
         h.opens_at,
         h.closes_at,
         case when h.opens_at <= v_now then 'open' else 'upcoming' end
    from public.hackathons h
   where h.hidden = false
     and h.slug not like 'test-%'
     and h.closes_at > v_now
   order by h.opens_at asc, h.slug asc
   limit 50;
end;
$$;

comment on function public.list_open_hackathons_for_client() is
  'SECURITY DEFINER, any signed-in caller (QDIT-60, D-122). GET /api/v1/hackathons: the hackathons that are not hidden, have no test- slug and have not closed, opens_at asc, slug asc, at most 50, as {slug, name (btrim, <= 200), opens_at, closes_at, state: open|upcoming}. The hackathons table''s OAuth SELECT guard stays closed; this is the only way an app sees the list. 42501 with no user or a revoked OAuth token.';

revoke all on function public.list_open_hackathons_for_client() from public, anon;
grant execute on function public.list_open_hackathons_for_client() to authenticated;
