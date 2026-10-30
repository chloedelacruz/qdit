-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261026120100_oauth_token_revoked_fail_closed.sql
--
-- oauth_token_revoked() fails closed for a client_id that is not a UUID
-- (WP-2.14, D-96), on top of 20261025130000_oauth_revocations.sql and
-- 20261026100000_oauth_write_guards_revoked.sql.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- oauth_client_revocations keys on a uuid, so a revoke can never be recorded
-- for a client_id of any other shape, and oauth_token_revoked() answered
-- false for one rather than fail a cast. /api/v1 closed that for itself
-- (authenticate() refuses such a token, D-77), but the D-75 terms in the
-- restrictive write guards, and assert_project_role() in the three /api/v1
-- RPCs, call the function directly: on PostgREST a token with a non-UUID
-- client_id was never revoked, whatever its user did (wave-6 review).
-- Supabase issues UUID client ids, so this is a token qdit never expects to
-- see; refusing its writes costs nothing.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES
-- ---------------------------------------------------------------------------
-- A present client_id that is not a UUID now answers true ("revoked"), so
-- every caller refuses the write: the six guards of 20261026100000 filter or
-- refuse it, and link_project_doc(), unlink_project_doc() and
-- create_linked_milestone() raise 42501 through assert_project_role(). The
-- body is the one from 20261025130000 with that branch split out.
--
-- What does not: a first-party session (no client_id) and a request with no
-- user (no sub) are still false. Neither is an app's token: the first is
-- what the guards' `client_id is null` branch lets through as before, and
-- the second writes nothing as a user anyway. Reads are unaffected, as the
-- function is only in the write guards. Signature and grants are unchanged.
-- ============================================================================

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
  if v_user is null or v_client is null then
    return false;
  end if;

  -- D-96: no revoke could ever be recorded for it, so it counts as revoked.
  if v_client !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return true;
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
  'SECURITY DEFINER. Whether the caller''s own token (sub, client_id, iat from the request JWT) was issued at or before that user''s latest revoke of that client (D-59); true for a client_id that is not a UUID, which no revoke can name (D-96); false for a first-party session or no user. Called once per /api/v1 request by authenticate(), and by the D-75 write guards and assert_project_role(); takes no argument, so it answers for nobody else.';
