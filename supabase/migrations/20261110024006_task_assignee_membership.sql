-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261110024006_task_assignee_membership.sql
--
-- Applied to the hosted project through the Supabase MCP, which stamps its own
-- version; authored as 20261110130000 and renamed to match the ledger
-- (gaps.md section 2).
--
-- QDIT-52 (WP-2.9): a task's assignee is a member of the task's project.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- tasks.assignee_id references auth.users, not project_members, so nothing
-- tied it to the task's project. The assignee picker offered everyone the
-- caller shares *any* project with (profiles RLS), and the database took
-- whatever uuid arrived. A task assigned to a non-member is invisible to its
-- assignee (tasks RLS needs membership) and shows a name the project's other
-- members cannot resolve.
--
-- Three parts:
--
--   1. guard     BEFORE INSERT, or UPDATE OF assignee_id / project_id, on
--                tasks: a non-null assignee must hold a membership row in the
--                task's project, at any role. Updates that leave both columns
--                alone are not checked, so an edit to some other field never
--                trips over an assignment made before this migration.
--   2. leave     AFTER DELETE on project_members: the departed user's tasks in
--                that project become unassigned. Their tasks elsewhere stay.
--   3. backfill  existing tasks whose assignee is not a member of the task's
--                project become unassigned, once, here.
--
-- Viewers count as members for assignment: the role decides what someone may
-- edit, not whether work can be theirs.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Guard
-- ----------------------------------------------------------------------------

create or replace function public.tasks_guard_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.project_members pm
     where pm.project_id = new.project_id
       and pm.user_id = new.assignee_id
  ) then
    raise exception 'The assignee is not a member of this project.'
      using errcode = '23514',
            constraint = 'tasks_assignee_is_project_member';
  end if;

  return new;
end;
$$;

comment on function public.tasks_guard_assignee() is
  'BEFORE INSERT / UPDATE OF assignee_id, project_id on tasks: refuses an assignee who is not a member of the task''s project (23514, constraint tasks_assignee_is_project_member).';

revoke all on function public.tasks_guard_assignee() from public, anon, authenticated;

create trigger tasks_guard_assignee
  before insert or update of assignee_id, project_id on public.tasks
  for each row execute function public.tasks_guard_assignee();


-- ----------------------------------------------------------------------------
-- 2. Leave
-- ----------------------------------------------------------------------------

create or replace function public.unassign_tasks_on_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks t
     set assignee_id = null
   where t.project_id = old.project_id
     and t.assignee_id = old.user_id;
  return null;
end;
$$;

comment on function public.unassign_tasks_on_leave() is
  'AFTER DELETE on project_members: unassigns the departed user''s tasks in that project.';

revoke all on function public.unassign_tasks_on_leave() from public, anon, authenticated;

create trigger project_members_unassign_tasks_on_leave
  after delete on public.project_members
  for each row execute function public.unassign_tasks_on_leave();


-- ----------------------------------------------------------------------------
-- 3. Backfill
-- ----------------------------------------------------------------------------

update public.tasks t
   set assignee_id = null
 where t.assignee_id is not null
   and not exists (
     select 1
       from public.project_members pm
      where pm.project_id = t.project_id
        and pm.user_id = t.assignee_id
   );
