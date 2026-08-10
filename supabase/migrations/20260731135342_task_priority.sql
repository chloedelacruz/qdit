-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260731135342_task_priority.sql
--
-- Task priority.
--
-- BACKFILLED. This was applied to the hosted project directly and never
-- committed; it is transcribed here verbatim from
-- supabase_migrations.schema_migrations so the repository describes the
-- deployed schema. Already applied — do not re-run it against that project.
--
-- The app reads and writes this column: TASK_PRIORITY in
-- web/src/lib/constants.ts holds the labels and the P3..P0 notation, the task
-- form writes it, list rows and board cards render it, and it is a filter facet
-- plus a sort key on the task surfaces.
--
-- Note for anyone writing a test against it: the column arrived before the UI
-- did, so every task in the hosted project predating that carries 'medium' and
-- there are no non-default priorities to filter for. A spec that needs one has
-- to create it. `supabase/seed.sql` spreads priorities across its five tasks,
-- but that seeds a local stack only.
-- ============================================================================

create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');

comment on type public.task_priority is
  'Task importance, ordered low -> urgent. Rendered as P3..P0 on the board.';

alter table public.tasks
  add column priority public.task_priority not null default 'medium';

comment on column public.tasks.priority is
  'Board priority chip. Defaults to medium so title-only creation stays valid.';

create index tasks_priority_idx on public.tasks (project_id, priority);
