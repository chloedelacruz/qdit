-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261026100100_doc_link_connections_hardening.sql
--
-- Two fixes to the doc card's doqtri connection (WP-2.12, wave-5 review of
-- WP-2.10), on top of 20261025120600_doc_link_connections.sql and
-- 20261025130000_oauth_revocations.sql.
--
-- ---------------------------------------------------------------------------
-- 1. THE REVOKE MARKS THE CONNECTIONS LOST AT ONCE
-- ---------------------------------------------------------------------------
-- revokeAuthorizedApp() (web/src/lib/actions.ts) records the revoke, asks
-- Auth to revoke the grant, then calls mark_doc_link_connections_revoked().
-- If that last call failed it was only logged, on the theory that the next
-- write would fix the card. Since D-59 there is no next write: /api/v1
-- refuses the revoked token, and a pre-revoke token writing through
-- PostgREST only bumps last_write_at on a live row (record_doc_link_
-- connection()'s revoked branch). The rows stayed live with no end date.
--
-- record_oauth_client_revocation(), step 1, now marks them too, with the
-- same revoke time. That is safe to do before Auth has answered, because it
-- heals itself: if Auth then refuses the revoke, doqtri's refresh still
-- works, and its next write carries a later iat, which
-- record_doc_link_connection()'s live branch takes as a live connection and
-- clears lost_at. Step 3 stays as it was, so either call alone leaves the
-- rows marked.
--
-- ---------------------------------------------------------------------------
-- 2. ONLY THE CURRENT DOQTRI CLIENT'S ROWS COUNT
-- ---------------------------------------------------------------------------
-- record_doc_link_connection() records only writes by
-- integration_settings.doqtri_oauth_client_id (D-61), but rows already
-- recorded were never checked against it again. An operator who first
-- stored a wrong client id (a test client's, still a UUID) or later
-- re-registered doqtri under a new one left the old client's rows live, and
-- the doc cards kept reading "connected" with no doqtri connection behind
-- them.
--
-- The members' read policy now also asks is_doqtri_oauth_client(client_id),
-- so a row recorded for any other client is invisible to the card, which
-- reads no row at all as "Connection to doqtri lost". Nothing is deleted: if
-- the operator puts the old id back, the rows count again. The helper is
-- SECURITY DEFINER because no client may read integration_settings, and it
-- answers yes or no for the id it is given, so a caller learns doqtri's
-- client id only by guessing it, and client ids are not secrets anyway (they
-- are in every authorize URL).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. record_oauth_client_revocation(): marks the caller's rows in step 1
--
-- The body from 20261025130000 with the update added. Signature and grants
-- are unchanged.
-- ----------------------------------------------------------------------------

create or replace function public.record_oauth_client_revocation(p_client_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_revoked_at timestamptz;
begin
  perform public.assert_first_party_session();

  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  v_revoked_at := public.upsert_oauth_client_revocation(auth.uid(), p_client_id);

  -- The card says "lost" from the revoke on, whatever Auth answers next (see
  -- the header for why this heals itself if Auth refuses).
  update public.doc_link_connections c
     set lost_at = v_revoked_at,
         lost_reason = 'revoked'
   where c.user_id = auth.uid()
     and c.client_id = p_client_id
     and c.lost_at is null;

  return v_revoked_at;
end;
$$;

comment on function public.record_oauth_client_revocation(uuid) is
  'SECURITY DEFINER, first-party sessions only. Records that the caller revoked p_client_id now, so /api/v1 refuses that app''s tokens issued until now (D-59), and marks the caller''s doc link connections through it lost (revoked). Returns the revoke time.';


-- ----------------------------------------------------------------------------
-- 2. Members read only the current doqtri client's rows
-- ----------------------------------------------------------------------------

create or replace function public.is_doqtri_oauth_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.doqtri_oauth_client_id = p_client_id from public.integration_settings s),
    false
  );
$$;

comment on function public.is_doqtri_oauth_client(uuid) is
  'SECURITY DEFINER. Whether p_client_id is integration_settings.doqtri_oauth_client_id (D-61); false while it is unset. Used by the doc_link_connections read policy, so the doc card counts only the current doqtri client''s connections.';

revoke all on function public.is_doqtri_oauth_client(uuid) from public, anon;
grant execute on function public.is_doqtri_oauth_client(uuid) to authenticated, service_role;

drop policy "doc_link_connections: read as member" on public.doc_link_connections;

create policy "doc_link_connections: read as member"
  on public.doc_link_connections
  for select
  to authenticated
  using (
    public.is_doqtri_oauth_client(client_id)
    and exists (
      select 1
        from public.project_doc_links d
       where d.id = doc_link_connections.doc_link_id
         and public.is_project_member(d.project_id, 'viewer')
    )
  );
