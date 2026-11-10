-- ============================================================================
-- qdit — pgTAP
-- supabase/tests/task_assignee_membership.test.sql
--
-- Covers 20261110024006_task_assignee_membership.sql (QDIT-52, WP-2.9): a
-- task's assignee must be a member of the task's project, whoever writes the
-- row; leaving a project unassigns the leaver's tasks there and nowhere else;
-- and deleting a project or an account still works with assigned tasks.
--
-- Run with `supabase test db` against a local stack (`supabase start` first).
-- Everything happens inside one transaction that is rolled back.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);


-- ----------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ----------------------------------------------------------------------------

-- P1: u1 owner, u2 member, u3 member, u4 viewer.
-- P2: u5 owner, u3 member. u5 is a stranger to P1, u2 and u4 to P2.
insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a5200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'asg-owner@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Owner","username":"asg_owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'asg-member@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Member","username":"asg_member"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5200000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'asg-both@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Both","username":"asg_both"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5200000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'asg-viewer@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Viewer","username":"asg_viewer"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5200000-0000-4000-8000-000000000005', 'authenticated', 'authenticated',
   'asg-stranger@qdit.test', '{"provider":"email","providers":["email"]}', '{"full_name":"Stranger","username":"asg_stranger"}', now(), now());

insert into public.projects (id, owner_id, name, slug)
values
  ('b5200000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'Assign one', 'asg-one'),
  ('b5200000-0000-4000-8000-000000000002', 'a5200000-0000-4000-8000-000000000005', 'Assign two', 'asg-two');

insert into public.project_members (project_id, user_id, role)
values
  ('b5200000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000002', 'member'),
  ('b5200000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000003', 'member'),
  ('b5200000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000004', 'viewer'),
  ('b5200000-0000-4000-8000-000000000002', 'a5200000-0000-4000-8000-000000000003', 'member');


create function pg_temp.as_session(p_user uuid) returns void
language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_user,
    'role', 'authenticated',
    'aud', 'authenticated'
  )::text, true);
$$;

create function pg_temp.as_postgres() returns void
language sql as $$
  select set_config('role', 'postgres', true);
  select set_config('request.jwt.claims', '', true);
$$;

create function pg_temp.assignee(p_task uuid) returns uuid
language sql as $$
  select assignee_id from public.tasks where id = p_task;
$$;


-- ----------------------------------------------------------------------------
-- 1. Shape
-- ----------------------------------------------------------------------------

select has_trigger('public', 'tasks', 'tasks_guard_assignee',
  'tasks carries the assignee guard');
select has_trigger('public', 'project_members', 'project_members_unassign_tasks_on_leave',
  'project_members carries the leave cleanup');


-- ----------------------------------------------------------------------------
-- 2. Guard, through a member's session (the server action's path)
-- ----------------------------------------------------------------------------

select pg_temp.as_session('a5200000-0000-4000-8000-000000000002');

select lives_ok(
  $$ insert into public.tasks (id, project_id, title, assignee_id)
     values ('c5200000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000001',
             'For a teammate', 'a5200000-0000-4000-8000-000000000003') $$,
  'a member assigns a task to another member of the project'
);

select lives_ok(
  $$ insert into public.tasks (id, project_id, title, assignee_id)
     values ('c5200000-0000-4000-8000-000000000002', 'b5200000-0000-4000-8000-000000000001',
             'For the viewer', 'a5200000-0000-4000-8000-000000000004') $$,
  '... and to a viewer of it'
);

select lives_ok(
  $$ insert into public.tasks (id, project_id, title)
     values ('c5200000-0000-4000-8000-000000000003', 'b5200000-0000-4000-8000-000000000001',
             'Nobody yet') $$,
  '... and leaves a task unassigned'
);

select throws_ok(
  $$ insert into public.tasks (project_id, title, assignee_id)
     values ('b5200000-0000-4000-8000-000000000001', 'For a stranger',
             'a5200000-0000-4000-8000-000000000005') $$,
  '23514', 'The assignee is not a member of this project.',
  'assigning a new task to someone outside the project is refused'
);

select throws_ok(
  $$ update public.tasks set assignee_id = 'a5200000-0000-4000-8000-000000000005'
      where id = 'c5200000-0000-4000-8000-000000000003' $$,
  '23514', 'The assignee is not a member of this project.',
  'reassigning an existing task to someone outside the project is refused'
);


-- ----------------------------------------------------------------------------
-- 3. Guard, for writers RLS does not see
-- ----------------------------------------------------------------------------

select pg_temp.as_postgres();

select throws_ok(
  $$ insert into public.tasks (project_id, title, assignee_id)
     values ('b5200000-0000-4000-8000-000000000001', 'Service write',
             'a5200000-0000-4000-8000-000000000005') $$,
  '23514', 'The assignee is not a member of this project.',
  'the table owner is held to the same rule'
);

-- A row assigned before the guard existed: written with the guard off.
alter table public.tasks disable trigger tasks_guard_assignee;
insert into public.tasks (id, project_id, title, assignee_id)
values ('c5200000-0000-4000-8000-000000000004', 'b5200000-0000-4000-8000-000000000001',
        'Assigned long ago', 'a5200000-0000-4000-8000-000000000005');
alter table public.tasks enable trigger tasks_guard_assignee;

select pg_temp.as_session('a5200000-0000-4000-8000-000000000002');
select lives_ok(
  $$ update public.tasks set title = 'Assigned long ago, renamed'
      where id = 'c5200000-0000-4000-8000-000000000004' $$,
  'an edit that leaves the assignee alone is not checked'
);
select pg_temp.as_postgres();


-- ----------------------------------------------------------------------------
-- 4. Leaving a project
-- ----------------------------------------------------------------------------

insert into public.tasks (id, project_id, title, assignee_id)
values ('c5200000-0000-4000-8000-000000000005', 'b5200000-0000-4000-8000-000000000002',
        'u3 in the other project', 'a5200000-0000-4000-8000-000000000003');

delete from public.project_members
 where project_id = 'b5200000-0000-4000-8000-000000000001'
   and user_id = 'a5200000-0000-4000-8000-000000000003';

select is(pg_temp.assignee('c5200000-0000-4000-8000-000000000001'), null::uuid,
  'leaving a project unassigns the leaver''s tasks there');
select is(pg_temp.assignee('c5200000-0000-4000-8000-000000000005'), 'a5200000-0000-4000-8000-000000000003'::uuid,
  '... and leaves their tasks in other projects assigned');
select is(pg_temp.assignee('c5200000-0000-4000-8000-000000000002'), 'a5200000-0000-4000-8000-000000000004'::uuid,
  '... and other members'' tasks in that project assigned');


-- ----------------------------------------------------------------------------
-- 5. Deletes that cascade through project_members
-- ----------------------------------------------------------------------------

select lives_ok(
  $$ delete from auth.users where id = 'a5200000-0000-4000-8000-000000000003' $$,
  'deleting an account that is a member and an assignee succeeds'
);
select is(pg_temp.assignee('c5200000-0000-4000-8000-000000000005'), null::uuid,
  '... and leaves its tasks unassigned');

select lives_ok(
  $$ delete from public.projects where id = 'b5200000-0000-4000-8000-000000000001' $$,
  'deleting a project with assigned tasks succeeds'
);
select is((select count(*)::int from public.tasks where project_id = 'b5200000-0000-4000-8000-000000000001'), 0,
  '... and takes its tasks with it');


select * from finish();
rollback;
