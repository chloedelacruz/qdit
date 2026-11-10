-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261110120000_hackathon_management.sql
--
-- QDIT-56 (WP-4.7): create, edit, hide and delete hackathons from a page,
-- instead of by hand-written SQL.
--
-- ---------------------------------------------------------------------------
-- WHAT
-- ---------------------------------------------------------------------------
--   1. qdit_operators        who may create hackathons and manage any of them.
--                            No client reads or writes it; rows are added by
--                            SQL (the product owner's call, 10 Nov 2026).
--      is_qdit_operator()    whether the caller is one, for the app.
--   2. hackathons.hidden     unlisted: out of the site banner and, for anyone
--                            but its staff and teams, the Hackathons index.
--                            Its page still opens by link. The `test-` slug
--                            prefix (QDIT-51) keeps meaning the same.
--   3. create_hackathon()    operators. The creator also becomes its admin, so
--                            the staff pages work for them at once.
--      update_hackathon()    operators, or that hackathon's admins.
--                            - the slug is locked once an entry or a doqtri
--                              snapshot exists: doqtri pushes address the
--                              hackathon by slug;
--                            - the window, team size and finalist count are
--                              locked once grades are released.
--      delete_hackathon()    operators, and only an empty hackathon: no entry,
--                            no doqtri snapshot (QD409 hackathon_not_empty).
--                            Anything with team work in it is hidden instead.
--
-- All three are SECURITY DEFINER and first-party only, like every other
-- hackathon RPC. The table's own checks (slug format, closes after opens,
-- team bounds, finalist count) still apply and surface as 23514 with the
-- constraint name, which the app maps to a field.
--
-- Errors:
--   42501  not first-party, not signed in, or not allowed
--   P0002  no such hackathon
--   23505  slug taken (hackathons_slug_key)
--   23514  a table check (constraint name in the message)
--   QD409  slug_locked | slug_reserved | released_locked | hackathon_not_empty
--
-- `manage` is reserved: /hackathons/manage is the management page, so a
-- hackathon with that slug could never be opened.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Operators
-- ----------------------------------------------------------------------------

create table public.qdit_operators (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  note     text check (note is null or char_length(note) <= 200)
);

comment on table public.qdit_operators is
  'Who runs qdit itself (QDIT-56): may create hackathons and manage any of them. Rows are added by SQL; no client reads or writes this table.';

alter table public.qdit_operators enable row level security;
revoke all on table public.qdit_operators from anon, authenticated;
-- No permissive policy: nothing but SECURITY DEFINER functions and the service
-- role reads it. The restrictive OAuth-client policies every public table
-- carries (oauth_client_guards.test.sql) are here all the same.
create policy "qdit_operators: no select by oauth clients"
  on public.qdit_operators as restrictive for select to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "qdit_operators: no insert by oauth clients"
  on public.qdit_operators as restrictive for insert to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "qdit_operators: no update by oauth clients"
  on public.qdit_operators as restrictive for update to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "qdit_operators: no delete by oauth clients"
  on public.qdit_operators as restrictive for delete to public
  using (((select auth.jwt()) ->> 'client_id') is null);


create or replace function public.is_qdit_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and (auth.jwt() ->> 'client_id') is null
     and exists (select 1 from public.qdit_operators o where o.user_id = auth.uid());
$$;

comment on function public.is_qdit_operator() is
  'SECURITY DEFINER. Whether the caller is a qdit operator (QDIT-56), on a first-party session. False for OAuth clients and anon.';

revoke all on function public.is_qdit_operator() from public, anon;
grant execute on function public.is_qdit_operator() to authenticated;


-- ----------------------------------------------------------------------------
-- 2. Hidden
-- ----------------------------------------------------------------------------

alter table public.hackathons
  add column hidden boolean not null default false;

comment on column public.hackathons.hidden is
  'Unlisted (QDIT-56): left out of the site banner and, for anyone but its staff and teams, the Hackathons index. The page still opens by link. A slug starting test- is treated the same (QDIT-51).';

comment on table public.hackathons is
  'A hackathon (D-115). Created, edited and deleted through create_hackathon(), update_hackathon() and delete_hackathon() (QDIT-56). released_at is set once by release_hackathon_grades() and is what unseals grades for admins (D-116).';


-- ----------------------------------------------------------------------------
-- 3. The RPCs
-- ----------------------------------------------------------------------------

create or replace function public.create_hackathon(
  p_slug           text,
  p_name           text,
  p_description    text,
  p_opens_at       timestamptz,
  p_closes_at      timestamptz,
  p_team_min       integer,
  p_team_max       integer,
  p_finalist_count integer,
  p_hidden         boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.assert_first_party_session();

  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not public.is_qdit_operator() then
    raise exception 'Only qdit operators can create hackathons.' using errcode = '42501';
  end if;

  if lower(btrim(coalesce(p_slug, ''))) = 'manage' then
    raise exception 'slug_reserved'
      using errcode = 'QD409', detail = '/hackathons/manage is the management page.';
  end if;

  insert into public.hackathons
    (slug, name, description, opens_at, closes_at, team_min, team_max, finalist_count, hidden)
  values
    (lower(btrim(coalesce(p_slug, ''))), btrim(coalesce(p_name, '')), nullif(btrim(coalesce(p_description, '')), ''),
     p_opens_at, p_closes_at, p_team_min, p_team_max, p_finalist_count, coalesce(p_hidden, false))
  returning id into v_id;

  insert into public.hackathon_staff (hackathon_id, user_id, role, added_by)
  values (v_id, auth.uid(), 'admin', auth.uid());

  return v_id;
end;
$$;

comment on function public.create_hackathon(text, text, text, timestamptz, timestamptz, integer, integer, integer, boolean) is
  'SECURITY DEFINER, first-party, qdit operators (QDIT-56). Creates a hackathon and makes the caller its admin. Returns its id. Errors: header of 20261110120000_hackathon_management.sql.';


create or replace function public.update_hackathon(
  p_id             uuid,
  p_slug           text,
  p_name           text,
  p_description    text,
  p_opens_at       timestamptz,
  p_closes_at      timestamptz,
  p_team_min       integer,
  p_team_max       integer,
  p_finalist_count integer,
  p_hidden         boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_h    public.hackathons;
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  perform public.assert_first_party_session();

  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  -- FOR NO KEY UPDATE: conflicts with a submit's FOR SHARE, so the "anything
  -- references it" checks below hold until this commits.
  select * into v_h from public.hackathons h where h.id = p_id for no key update;
  if not found then
    raise exception 'No such hackathon.' using errcode = 'P0002';
  end if;

  if not (public.is_qdit_operator() or public.is_hackathon_staff(p_id, 'admin')) then
    raise exception 'Only qdit operators and this hackathon''s admins can edit it.' using errcode = '42501';
  end if;

  if v_slug = 'manage' and v_slug is distinct from v_h.slug then
    raise exception 'slug_reserved'
      using errcode = 'QD409', detail = '/hackathons/manage is the management page.';
  end if;

  if v_slug is distinct from v_h.slug and (
       exists (select 1 from public.hackathon_submissions s where s.hackathon_id = p_id)
    or exists (select 1 from public.hackathon_doqtri_snapshots d where d.hackathon_id = p_id)
  ) then
    raise exception 'slug_locked'
      using errcode = 'QD409',
            detail = 'Teams have already sent work to this hackathon, and doqtri finds it by its slug.';
  end if;

  if v_h.released_at is not null and (
       p_opens_at is distinct from v_h.opens_at
    or p_closes_at is distinct from v_h.closes_at
    or p_team_min is distinct from v_h.team_min
    or p_team_max is distinct from v_h.team_max
    or p_finalist_count is distinct from v_h.finalist_count
  ) then
    raise exception 'released_locked'
      using errcode = 'QD409',
            detail = 'Grades are released, so the window, team size and finalist count stay as they were.';
  end if;

  update public.hackathons h
     set slug           = v_slug,
         name           = btrim(coalesce(p_name, '')),
         description    = nullif(btrim(coalesce(p_description, '')), ''),
         opens_at       = p_opens_at,
         closes_at      = p_closes_at,
         team_min       = p_team_min,
         team_max       = p_team_max,
         finalist_count = p_finalist_count,
         hidden         = coalesce(p_hidden, false)
   where h.id = p_id;
end;
$$;

comment on function public.update_hackathon(uuid, text, text, text, timestamptz, timestamptz, integer, integer, integer, boolean) is
  'SECURITY DEFINER, first-party, qdit operators or the hackathon''s admins (QDIT-56). Replaces every editable field. QD409 slug_locked once an entry or doqtri snapshot exists, released_locked for window, team size or finalist count after release.';


create or replace function public.delete_hackathon(p_id uuid)
returns void
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
  if not public.is_qdit_operator() then
    raise exception 'Only qdit operators can delete hackathons.' using errcode = '42501';
  end if;

  perform 1 from public.hackathons h where h.id = p_id for update;
  if not found then
    raise exception 'No such hackathon.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.hackathon_submissions s where s.hackathon_id = p_id)
     or exists (select 1 from public.hackathon_doqtri_snapshots d where d.hackathon_id = p_id) then
    raise exception 'hackathon_not_empty'
      using errcode = 'QD409',
            detail = 'Teams have sent work to this hackathon. Hide it instead.';
  end if;

  -- Staff rows and late passes go with it (on delete cascade).
  delete from public.hackathons h where h.id = p_id;
end;
$$;

comment on function public.delete_hackathon(uuid) is
  'SECURITY DEFINER, first-party, qdit operators (QDIT-56). Deletes an empty hackathon; QD409 hackathon_not_empty when it has an entry or a doqtri snapshot. Mindmap uploads never submitted stay in Storage.';


revoke all on function public.create_hackathon(text, text, text, timestamptz, timestamptz, integer, integer, integer, boolean) from public, anon;
revoke all on function public.update_hackathon(uuid, text, text, text, timestamptz, timestamptz, integer, integer, integer, boolean) from public, anon;
revoke all on function public.delete_hackathon(uuid) from public, anon;
grant execute on function public.create_hackathon(text, text, text, timestamptz, timestamptz, integer, integer, integer, boolean) to authenticated;
grant execute on function public.update_hackathon(uuid, text, text, text, timestamptz, timestamptz, integer, integer, integer, boolean) to authenticated;
grant execute on function public.delete_hackathon(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 4. The management page's list
--
-- An operator who is not a hackathon's staff cannot read its entries under
-- RLS, so the counts that decide whether Delete is offered come from here.
-- ----------------------------------------------------------------------------

create or replace function public.hackathon_manage_list()
returns table (
  id             uuid,
  slug           text,
  name           text,
  description    text,
  opens_at       timestamptz,
  closes_at      timestamptz,
  team_min       integer,
  team_max       integer,
  finalist_count integer,
  hidden         boolean,
  released_at    timestamptz,
  entries        bigint,
  snapshots      bigint,
  can_delete     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_operator boolean := public.is_qdit_operator();
begin
  perform public.assert_first_party_session();

  return query
  select h.id, h.slug, h.name, h.description, h.opens_at, h.closes_at,
         h.team_min, h.team_max, h.finalist_count, h.hidden, h.released_at,
         (select count(*) from public.hackathon_submissions s where s.hackathon_id = h.id),
         (select count(*) from public.hackathon_doqtri_snapshots d where d.hackathon_id = h.id),
         v_operator
           and not exists (select 1 from public.hackathon_submissions s where s.hackathon_id = h.id)
           and not exists (select 1 from public.hackathon_doqtri_snapshots d where d.hackathon_id = h.id)
    from public.hackathons h
   where v_operator or public.is_hackathon_staff(h.id, 'admin')
   order by h.opens_at desc;
end;
$$;

comment on function public.hackathon_manage_list() is
  'SECURITY DEFINER, first-party (QDIT-56). The hackathons the caller may manage (all for an operator, their own for a hackathon admin, none otherwise), with entry and doqtri snapshot counts and whether Delete is allowed.';

revoke all on function public.hackathon_manage_list() from public, anon;
grant execute on function public.hackathon_manage_list() to authenticated;
