-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261025130100_doc_links_from_apps_only.sql
--
-- Doc link hardening (WP-2.10), on top of
-- 20261024120000_integration_links.sql and
-- 20261025090000_integration_hardening.sql.
--
-- ---------------------------------------------------------------------------
-- DOC LINKS COME ONLY FROM AN APP (D-60)
-- ---------------------------------------------------------------------------
-- link_project_doc() and unlink_project_doc() are the API's
-- POST and DELETE /projects/{id}/docs. Linking happens in doqtri (D-10), and
-- nothing in qdit's UI calls either; a project admin's own session could
-- still call them over PostgREST, writing a doc link the D-45 origin check
-- (in the API route) never saw. They now raise 42501 for a request JWT with
-- no client_id, before the role check, so a session learns nothing. Unlinking
-- from a qdit session stays possible the way it was: a direct DELETE on
-- project_doc_links, which the admin policy allows and the cascade follows
-- (D-22).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- link_project_doc() and unlink_project_doc(): apps only (D-60)
--
-- Each body is the one from 20261024120000_integration_links.sql with step
-- (0) added. Signatures and grants are unchanged.
-- ----------------------------------------------------------------------------

-- The mirror of assert_first_party_session(): raises 42501 when the request
-- JWT has no client_id.
create or replace function public.assert_oauth_client_session()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if (auth.jwt() ->> 'client_id') is null then
    raise exception 'Doc links are made and removed from doqtri, through its connection to qdit.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.assert_oauth_client_session() is
  'Raises 42501 when the request JWT carries no client_id, i.e. it is not a token issued to an OAuth client. Called first by link_project_doc() and unlink_project_doc() (D-60).';


create or replace function public.link_project_doc(
  p_project_id uuid,
  p_doc_id     uuid,
  p_doc_title  text,
  p_doc_url    text
)
returns table (
  id         uuid,
  project_id uuid,
  doc_id     uuid,
  doc_title  text,
  doc_url    text,
  created_at timestamptz,
  updated_at timestamptz,
  created    boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- (0) Only through an app (D-60), before anything about the project.
  perform public.assert_oauth_client_session();

  perform public.assert_project_role(p_project_id, 'admin');

  -- One statement, so two concurrent posts of the same doc cannot both
  -- insert. The WHERE makes the conflict branch a no-op for a doc linked to
  -- another project, which then returns no row. `xmax = 0` is true only for
  -- a row this statement inserted, which is how 201 is told from 200.
  return query
    insert into public.project_doc_links as d (project_id, doc_id, doc_title, doc_url, linked_by)
    values (p_project_id, p_doc_id, btrim(p_doc_title), p_doc_url, auth.uid())
    on conflict on constraint project_doc_links_doc_id_key do update
      set doc_title = excluded.doc_title,
          doc_url   = excluded.doc_url
      where d.project_id = excluded.project_id
    returning d.id, d.project_id, d.doc_id, d.doc_title, d.doc_url,
              d.created_at, d.updated_at, (d.xmax = 0);

  if not found then
    raise exception 'doc_linked_elsewhere' using errcode = 'QD409';
  end if;
end;
$$;

comment on function public.link_project_doc(uuid, uuid, text, text) is
  'SECURITY DEFINER, OAuth clients only (D-60). POST /api/v1/projects/{id}/docs: links a doqtri doc to a project the caller administers, or refreshes title and URL when it is already linked there. QD409 doc_linked_elsewhere when another project holds it.';


create or replace function public.unlink_project_doc(
  p_project_id uuid,
  p_doc_id     uuid
)
returns uuid[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_removed uuid[];
begin
  -- (0) Only through an app (D-60), before anything about the project.
  perform public.assert_oauth_client_session();

  perform public.assert_project_role(p_project_id, 'admin');

  -- Locked first, so a milestone link created concurrently either commits
  -- before this (and is listed below) or waits and then fails its foreign
  -- key. Without the lock it could be removed by the cascade and not listed.
  perform 1
     from public.project_doc_links d
    where d.project_id = p_project_id
      and d.doc_id = p_doc_id
      for update;

  if not found then
    raise exception 'That doc is not linked to this project.' using errcode = 'P0002';
  end if;

  with removed as (
    delete from public.milestone_external_links l
     where l.project_id = p_project_id
       and l.doc_id = p_doc_id
    returning l.id
  )
  select coalesce(array_agg(r.id order by r.id), '{}')
    into v_removed
    from removed r;

  delete from public.project_doc_links d
   where d.project_id = p_project_id
     and d.doc_id = p_doc_id;

  return v_removed;
end;
$$;

comment on function public.unlink_project_doc(uuid, uuid) is
  'SECURITY DEFINER, OAuth clients only (D-60). DELETE /api/v1/projects/{id}/docs/{doc_id}: removes the doc link and every milestone link into it in one transaction (D-22) and returns the removed link ids. Milestones stay.';


-- ----------------------------------------------------------------------------
-- Grants
--
-- The check runs only inside the two RPCs, as their owner. The RPCs keep the
-- grants of 20261024120000 (`create or replace` does not change them).
-- ----------------------------------------------------------------------------

revoke all on function public.assert_oauth_client_session() from public, anon, authenticated;
