-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260731133313_rls.sql
--
-- Row Level Security. Every table in `public` is locked down; access is derived
-- entirely from public.project_members.
--
-- ---------------------------------------------------------------------------
-- WHY THE HELPERS ARE `SECURITY DEFINER`
-- ---------------------------------------------------------------------------
-- The natural policy for public.project_members is "you may read a membership
-- row if you are a member of that project" — but expressing that inline means
-- the policy on project_members runs a SELECT against project_members, which
-- re-triggers the same policy. Postgres detects that and aborts with
-- `infinite recursion detected in policy for relation "project_members"`.
--
-- The fix is to move the lookup into a SECURITY DEFINER function. Such a
-- function executes as its owner (postgres), for whom RLS is not enforced, so
-- the inner SELECT never re-enters the policy and the recursion is broken.
--
-- SECURITY DEFINER is a privilege escalation primitive, so each helper below:
--   * pins `set search_path = ''` and schema-qualifies every identifier, so a
--     caller cannot shadow `project_members` with a table on their own path;
--   * takes only the project id as input and returns a bare boolean — it never
--     leaks rows, only a yes/no answer about the *calling* user;
--   * derives the subject from auth.uid() and never from an argument, so it
--     cannot be used to probe another user's membership;
--   * is STABLE and revoked from PUBLIC, granted only to authenticated.
--
-- Ordering inside this file matters: helper functions are created first,
-- because every policy below calls them.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Role ranking
-- ----------------------------------------------------------------------------

-- Maps member_role onto a comparable integer. Plain (non-definer) IMMUTABLE
-- function: it touches no tables, so it needs no elevated rights.
create or replace function public.member_role_rank(p_role public.member_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'viewer' then 1
    when 'member' then 2
    when 'admin'  then 3
    when 'owner'  then 4
  end;
$$;

comment on function public.member_role_rank(public.member_role) is
  'Orders member_role for >= comparisons: viewer(1) < member(2) < admin(3) < owner(4).';


-- ----------------------------------------------------------------------------
-- 2. Membership helpers (SECURITY DEFINER — see header)
-- ----------------------------------------------------------------------------

-- True when the current user holds at least `p_min_role` on `p_project_id`.
--
-- SECURITY DEFINER: reads public.project_members from inside the policies that
-- protect public.project_members. Running as the owner bypasses RLS on that
-- inner read and prevents the infinite-recursion error described above.
create or replace function public.is_project_member(
  p_project_id uuid,
  p_min_role   text default 'viewer'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = (select auth.uid())
      and public.member_role_rank(pm.role)
          >= public.member_role_rank(p_min_role::public.member_role)
  );
$$;

comment on function public.is_project_member(uuid, text) is
  'SECURITY DEFINER membership check. Called from RLS policies to avoid '
  'infinite recursion on public.project_members. Always evaluates auth.uid(), '
  'never an arbitrary user, and returns only a boolean.';


-- True when the current user shares at least one project with `p_user_id`.
-- Used so teammates can resolve each other's display name / avatar / wallet
-- without exposing the whole profiles table.
--
-- SECURITY DEFINER for the same reason: it reads public.project_members, which
-- is itself RLS-protected by a policy that calls into these helpers.
create or replace function public.shares_project_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members me
    join public.project_members them on them.project_id = me.project_id
    where me.user_id = (select auth.uid())
      and them.user_id = p_user_id
  );
$$;

comment on function public.shares_project_with(uuid) is
  'SECURITY DEFINER: true when the caller and p_user_id share a project. '
  'Definer rights are required because it reads the RLS-protected '
  'public.project_members table from within a policy.';


-- Least privilege: policies are evaluated as the invoking role, so only
-- `authenticated` needs EXECUTE. `anon` must not be able to probe membership.
revoke execute on function public.member_role_rank(public.member_role) from public;
revoke execute on function public.is_project_member(uuid, text)        from public;
revoke execute on function public.shares_project_with(uuid)            from public;

grant execute on function public.member_role_rank(public.member_role) to authenticated, service_role;
grant execute on function public.is_project_member(uuid, text)        to authenticated, service_role;
grant execute on function public.shares_project_with(uuid)            to authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3. Enable RLS on every table
--
-- No table has a permissive default: with RLS on and no matching policy, the
-- answer is "no rows".
-- ----------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.milestones      enable row level security;
alter table public.tasks           enable row level security;
alter table public.stellar_proofs  enable row level security;
alter table public.deployments     enable row level security;


-- ----------------------------------------------------------------------------
-- 4. profiles
--
-- Readable by yourself and by teammates. Writable only by yourself — role has
-- no bearing here, a project admin never edits someone else's profile.
-- ----------------------------------------------------------------------------

create policy "profiles: read own or teammate"
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or public.shares_project_with(id)
  );

create policy "profiles: insert own"
  on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

create policy "profiles: update own"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles: delete own"
  on public.profiles
  for delete
  to authenticated
  using (id = (select auth.uid()));


-- ----------------------------------------------------------------------------
-- 5. projects
--
-- viewer+ : read
-- admin+  : update project settings
-- owner   : delete
-- Anyone authenticated may create a project, but only with themselves as owner;
-- the on_project_created trigger then grants them the `owner` membership row.
-- ----------------------------------------------------------------------------

create policy "projects: read as member"
  on public.projects
  for select
  to authenticated
  using (public.is_project_member(id, 'viewer'));

create policy "projects: insert as self-owner"
  on public.projects
  for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy "projects: update as admin"
  on public.projects
  for update
  to authenticated
  using (public.is_project_member(id, 'admin'))
  with check (public.is_project_member(id, 'admin'));

create policy "projects: delete as owner"
  on public.projects
  for delete
  to authenticated
  using (public.is_project_member(id, 'owner'));


-- ----------------------------------------------------------------------------
-- 6. project_members
--
-- viewer+ : see the roster
-- admin+  : add / change / remove members
-- anyone  : remove their own membership (leave the project)
--
-- Every clause routes through is_project_member() rather than querying
-- project_members inline — this is precisely the recursion trap the helper
-- exists to avoid.
-- ----------------------------------------------------------------------------

create policy "project_members: read as member"
  on public.project_members
  for select
  to authenticated
  using (public.is_project_member(project_id, 'viewer'));

create policy "project_members: insert as admin"
  on public.project_members
  for insert
  to authenticated
  with check (public.is_project_member(project_id, 'admin'));

create policy "project_members: update as admin"
  on public.project_members
  for update
  to authenticated
  using (public.is_project_member(project_id, 'admin'))
  with check (public.is_project_member(project_id, 'admin'));

create policy "project_members: delete as admin or leave"
  on public.project_members
  for delete
  to authenticated
  using (
    public.is_project_member(project_id, 'admin')
    or user_id = (select auth.uid())
  );


-- ----------------------------------------------------------------------------
-- 7. milestones — viewer+ read, member+ write
--
-- The WITH CHECK clauses re-assert membership on the *new* project_id so a row
-- cannot be moved into a project the caller does not belong to.
-- ----------------------------------------------------------------------------

create policy "milestones: read as member"
  on public.milestones
  for select
  to authenticated
  using (public.is_project_member(project_id, 'viewer'));

create policy "milestones: insert as member"
  on public.milestones
  for insert
  to authenticated
  with check (public.is_project_member(project_id, 'member'));

create policy "milestones: update as member"
  on public.milestones
  for update
  to authenticated
  using (public.is_project_member(project_id, 'member'))
  with check (public.is_project_member(project_id, 'member'));

create policy "milestones: delete as member"
  on public.milestones
  for delete
  to authenticated
  using (public.is_project_member(project_id, 'member'));


-- ----------------------------------------------------------------------------
-- 8. tasks — viewer+ read, member+ write
-- ----------------------------------------------------------------------------

create policy "tasks: read as member"
  on public.tasks
  for select
  to authenticated
  using (public.is_project_member(project_id, 'viewer'));

create policy "tasks: insert as member"
  on public.tasks
  for insert
  to authenticated
  with check (public.is_project_member(project_id, 'member'));

create policy "tasks: update as member"
  on public.tasks
  for update
  to authenticated
  using (public.is_project_member(project_id, 'member'))
  with check (public.is_project_member(project_id, 'member'));

create policy "tasks: delete as member"
  on public.tasks
  for delete
  to authenticated
  using (public.is_project_member(project_id, 'member'));


-- ----------------------------------------------------------------------------
-- 9. stellar_proofs — viewer+ read, member+ write
--
-- created_by is pinned to the caller on insert so a proof cannot be attributed
-- to a teammate. Rewriting history is restricted to admins.
-- ----------------------------------------------------------------------------

create policy "stellar_proofs: read as member"
  on public.stellar_proofs
  for select
  to authenticated
  using (public.is_project_member(project_id, 'viewer'));

create policy "stellar_proofs: insert as member"
  on public.stellar_proofs
  for insert
  to authenticated
  with check (
    public.is_project_member(project_id, 'member')
    and created_by = (select auth.uid())
  );

create policy "stellar_proofs: update own or as admin"
  on public.stellar_proofs
  for update
  to authenticated
  using (
    public.is_project_member(project_id, 'admin')
    or (
      public.is_project_member(project_id, 'member')
      and created_by = (select auth.uid())
    )
  )
  with check (public.is_project_member(project_id, 'member'));

create policy "stellar_proofs: delete own or as admin"
  on public.stellar_proofs
  for delete
  to authenticated
  using (
    public.is_project_member(project_id, 'admin')
    or (
      public.is_project_member(project_id, 'member')
      and created_by = (select auth.uid())
    )
  );


-- ----------------------------------------------------------------------------
-- 10. deployments — viewer+ read, member+ append, admin+ rewrite
--
-- This table is the deployment history log, so edits and deletions are held to
-- a higher bar than the tables it summarises.
-- ----------------------------------------------------------------------------

create policy "deployments: read as member"
  on public.deployments
  for select
  to authenticated
  using (public.is_project_member(project_id, 'viewer'));

create policy "deployments: insert as member"
  on public.deployments
  for insert
  to authenticated
  with check (
    public.is_project_member(project_id, 'member')
    and (deployed_by is null or deployed_by = (select auth.uid()))
  );

create policy "deployments: update as admin"
  on public.deployments
  for update
  to authenticated
  using (public.is_project_member(project_id, 'admin'))
  with check (public.is_project_member(project_id, 'admin'));

create policy "deployments: delete as admin"
  on public.deployments
  for delete
  to authenticated
  using (public.is_project_member(project_id, 'admin'));


-- ----------------------------------------------------------------------------
-- 11. Table grants
--
-- RLS filters rows; GRANTs decide whether the role may reach the table at all.
-- Both are required. `anon` is granted nothing: this app has no public surface.
-- ----------------------------------------------------------------------------

grant select, insert, update, delete on public.profiles        to authenticated;
grant select, insert, update, delete on public.projects        to authenticated;
grant select, insert, update, delete on public.project_members to authenticated;
grant select, insert, update, delete on public.milestones      to authenticated;
grant select, insert, update, delete on public.tasks           to authenticated;
grant select, insert, update, delete on public.stellar_proofs  to authenticated;
grant select, insert, update, delete on public.deployments     to authenticated;
