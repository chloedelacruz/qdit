-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260731000004_task_priority.sql
--
-- Task priority.
--
-- BACKFILLED. This ran against the hosted project on 2026-07-31 as migration
-- `20260731135342_task_priority` and was never committed. Recovered from
-- supabase_migrations.schema_migrations on 2026-08-09 and written here verbatim
-- so the repository can describe the deployed schema. Do not re-run it against
-- that project; it is already applied.
--
-- ---------------------------------------------------------------------------
-- THE COLUMN IS LIVE AND THE APP DOES NOT USE IT
-- ---------------------------------------------------------------------------
-- Nothing in web/ reads or writes public.tasks.priority: it is absent from
-- src/lib/types/database.ts, from the task dialogs, from the board rows and
-- from the filter bar. Every task in the database therefore carries the
-- default, 'medium'.
--
-- This is deferred UI work, not deferred schema work. gaps.md described the
-- priority field as the last item still needing a migration; that was wrong
-- from the day this ran. The remaining work is: add it to database.ts, give it
-- a StateMeta table in constants.ts alongside TASK_STATUS, put it in the shared
-- field set in entity-dialogs.tsx, render a chip in rows.tsx, and add it to the
-- facets in the board and task filter bars.
-- ============================================================================

create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');

comment on type public.task_priority is
  'Task importance, ordered low -> urgent. Rendered as P3..P0 on the board.';

alter table public.tasks
  add column priority public.task_priority not null default 'medium';

comment on column public.tasks.priority is
  'Board priority chip. Defaults to medium so title-only creation stays valid.';

create index tasks_priority_idx on public.tasks (project_id, priority);
