-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261025090000_integration_hardening.sql
--
-- Hardening of the doqtri integration (WP-2.9), on top of
-- 20261024120000_integration_links.sql.
--
-- ---------------------------------------------------------------------------
-- 1. DOC LINKS ARE WRITTEN ONLY BY link_project_doc() (D-48)
-- ---------------------------------------------------------------------------
-- Until now a project admin could INSERT or UPDATE project_doc_links directly
-- through PostgREST, with their own qdit session, past the API and its D-45
-- origin check. Nothing in qdit's UI does that (linking happens in doqtri,
-- D-10), so the door only served hand-made requests.
--
-- It is closed twice:
--
--   * INSERT and UPDATE are revoked from authenticated and anon. A direct
--     write is `permission denied` before any policy is looked at.
--   * The permissive INSERT and UPDATE policies are dropped, and the OAuth
--     guards for those two commands are replaced by restrictive policies that
--     are `false` for everyone. Should a later grant reopen the table, RLS
--     still refuses the write. (The guard tripwire in
--     supabase/tests/oauth_client_guards.test.sql wants a restrictive policy
--     per command on every table; these are those.)
--
-- link_project_doc() is SECURITY DEFINER and owned by the table's owner,
-- which RLS does not bind (the table does not FORCE it), so the one write
-- path keeps working. It already does everything the direct path lacked:
--
--   * the role: assert_project_role(p_project_id, 'admin') first, so not_found
--     for an outsider and forbidden below admin (D-23);
--   * the https rule: `doc_url` lands in the column, whose CHECK holds it to a
--     plain https URL (D-45). doqtri's origin is deployment config, so the API
--     route checks that part (POST /api/v1/projects/{id}/docs);
--   * the frozen columns: `linked_by` is auth.uid(), never a parameter; the
--     re-post refresh sets only `doc_title` and `doc_url`, and only when the
--     doc is linked to the same project; check_project_doc_link() still
--     refuses any other change for every caller, the function included.
--
-- SELECT and DELETE are unchanged: viewers read, admins unlink (D-22, D-23),
-- and an app may delete as before (D-03). The service role and direct
-- database sessions keep their access; they are operators, not users.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. project_doc_links: no direct INSERT or UPDATE (D-48)
-- ----------------------------------------------------------------------------

revoke insert, update on table public.project_doc_links from authenticated, anon;

drop policy "project_doc_links: insert as admin"                   on public.project_doc_links;
drop policy "project_doc_links: update as admin"                   on public.project_doc_links;
drop policy "project_doc_links: oauth clients insert as their user" on public.project_doc_links;
drop policy "project_doc_links: no update by oauth clients"        on public.project_doc_links;

create policy "project_doc_links: no direct insert, use link_project_doc (D-48)"
  on public.project_doc_links
  as restrictive
  for insert
  to public
  with check (false);

create policy "project_doc_links: no direct update, use link_project_doc (D-48)"
  on public.project_doc_links
  as restrictive
  for update
  to public
  using (false)
  with check (false);

comment on table public.project_doc_links is
  'A doqtri doc linked to a qdit project (D-09: one project per doc, many docs per project). Copies of the doc title and URL only; doqtri owns the doc. Written only by link_project_doc() (D-48); clients read and delete.';
