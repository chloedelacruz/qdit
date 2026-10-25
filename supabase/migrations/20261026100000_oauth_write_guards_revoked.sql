-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261026100000_oauth_write_guards_revoked.sql
--
-- A revoked app's token is refused on PostgREST writes too (WP-2.12, D-75),
-- on top of 20261024110000_oauth_client_guards.sql,
-- 20261024120000_integration_links.sql and 20261025130000_oauth_revocations.sql.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- D-59 made /api/v1 refuse every token issued at or before its user's revoke
-- of its client (oauth_token_revoked(), called once per request by
-- authenticate()). PostgREST never asks: Supabase's revoke ends the grant's
-- sessions and refresh tokens but cannot recall an access token already
-- issued, so for up to an hour (its exp) that token kept every write the
-- D-03 guards open to apps, through /rest/v1 directly. 20261025130000 named
-- this as the known limit and left it to a decision; D-75 is that decision:
-- writes are refused at once, reads keep the window (contract section 5).
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES
-- ---------------------------------------------------------------------------
-- Every restrictive guard that opens a write to apps gets
-- `and not (select public.oauth_token_revoked())` on its app branch:
--
--   milestones                 INSERT (as proposed), UPDATE (linked only)
--   milestone_external_links   INSERT (as their user), UPDATE, DELETE
--   project_doc_links          DELETE
--
-- Each is dropped and created again under the same name, with the same
-- condition plus that one term; the first-party branch (`client_id is null`)
-- is untouched, so a user's own session is unaffected. Guards that already
-- close a write to apps outright need nothing. `(select ...)` makes the check
-- an initplan: one lookup per statement, not one per row, the same way every
-- guard here reads auth.jwt().
--
-- And the three /api/v1 RPCs that write as their owner, where RLS does not
-- reach: link_project_doc(), unlink_project_doc() and
-- create_linked_milestone(). They all open with assert_project_role(), so the
-- same check goes there, first: a revoked token calling them over
-- /rest/v1/rpc gets 42501 before the role check, so it learns nothing about
-- the project either. Through /api/v1 the token never gets that far
-- (authenticate() refused it), so the API's answers do not change.
--
-- What stays: reads. A revoked token can still read what the D-03 guards let
-- an app read (projects, milestones, anchors, its user's own profile and
-- membership rows) until its exp, at most an hour. That is the window the
-- contract states (section 5, D-75), decided, not overlooked: nothing a read
-- returns there is more than /api/v1 handed the app before the revoke, while
-- a write after it is the app acting for a user who has said stop.
--
-- Grants are unchanged. The policies are `to public`, but anon never
-- evaluates them: it has no permissive write policy on milestones (they are
-- all `to authenticated`), and PostgreSQL adds no restrictive policy to a
-- command no permissive one allows, and it holds no grant at all on the two
-- link tables (20261024120000). So oauth_token_revoked() stays executable by
-- authenticated and service_role only.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. milestones
-- ----------------------------------------------------------------------------

drop policy "milestones: oauth clients insert as proposed only" on public.milestones;

create policy "milestones: oauth clients insert as proposed only"
  on public.milestones
  as restrictive
  for insert
  to public
  with check (
    ((select auth.jwt()) ->> 'client_id') is null
    or (status = 'proposed' and not (select public.oauth_token_revoked()))
  );

drop policy "milestones: oauth clients update linked only" on public.milestones;

create policy "milestones: oauth clients update linked only"
  on public.milestones
  as restrictive
  for update
  to public
  using (
    ((select auth.jwt()) ->> 'client_id') is null
    or (
      exists (
        select 1 from public.milestone_external_links l
         where l.milestone_id = milestones.id
      )
      and not (select public.oauth_token_revoked())
    )
  )
  with check (
    ((select auth.jwt()) ->> 'client_id') is null
    or (
      exists (
        select 1 from public.milestone_external_links l
         where l.milestone_id = milestones.id
      )
      and not (select public.oauth_token_revoked())
    )
  );


-- ----------------------------------------------------------------------------
-- 2. milestone_external_links
-- ----------------------------------------------------------------------------

drop policy "milestone_external_links: oauth clients insert as their user" on public.milestone_external_links;

create policy "milestone_external_links: oauth clients insert as their user"
  on public.milestone_external_links
  as restrictive
  for insert
  to public
  with check (
    ((select auth.jwt()) ->> 'client_id') is null
    or (created_by = (select auth.uid()) and not (select public.oauth_token_revoked()))
  );

-- Which columns may move is still check_milestone_external_link()'s job.
drop policy "milestone_external_links: oauth clients may update (D-21)" on public.milestone_external_links;

create policy "milestone_external_links: oauth clients may update (D-21)"
  on public.milestone_external_links
  as restrictive
  for update
  to public
  using (
    ((select auth.jwt()) ->> 'client_id') is null
    or not (select public.oauth_token_revoked())
  )
  with check (
    ((select auth.jwt()) ->> 'client_id') is null
    or not (select public.oauth_token_revoked())
  );

drop policy "milestone_external_links: oauth clients may delete (D-03)" on public.milestone_external_links;

create policy "milestone_external_links: oauth clients may delete (D-03)"
  on public.milestone_external_links
  as restrictive
  for delete
  to public
  using (
    ((select auth.jwt()) ->> 'client_id') is null
    or not (select public.oauth_token_revoked())
  );


-- ----------------------------------------------------------------------------
-- 3. project_doc_links (INSERT and UPDATE are closed to every client, D-48)
-- ----------------------------------------------------------------------------

drop policy "project_doc_links: oauth clients may delete (D-03, D-22)" on public.project_doc_links;

create policy "project_doc_links: oauth clients may delete (D-03, D-22)"
  on public.project_doc_links
  as restrictive
  for delete
  to public
  using (
    ((select auth.jwt()) ->> 'client_id') is null
    or not (select public.oauth_token_revoked())
  );


-- ----------------------------------------------------------------------------
-- 4. The /api/v1 RPCs: assert_project_role() refuses a revoked token first
--
-- The body from 20261024120000_integration_links.sql with step (0) added.
-- Signature, grants (none: internal) and callers are unchanged.
-- ----------------------------------------------------------------------------

create or replace function public.assert_project_role(
  p_project_id uuid,
  p_min_role   text
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  -- (0) D-75: a token issued at or before its user's revoke of its client.
  -- False for a first-party session, so only apps can hit it.
  if public.oauth_token_revoked() then
    raise exception 'This app''s access to qdit was revoked.' using errcode = '42501';
  end if;

  if not public.is_project_member(p_project_id, 'viewer') then
    raise exception 'No such project.' using errcode = 'P0002';
  end if;

  if not public.is_project_member(p_project_id, p_min_role) then
    raise exception 'Your role in this project does not allow that.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.assert_project_role(uuid, text) is
  'Raises 42501 for an OAuth token its user revoked (D-75), then P0002 when the caller is not a member of p_project_id, 42501 when their role is below p_min_role. Used first by the /api/v1 RPCs.';

revoke all on function public.assert_project_role(uuid, text) from public, anon, authenticated;

