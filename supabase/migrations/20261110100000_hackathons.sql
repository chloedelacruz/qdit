-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20261110100000_hackathons.sql
--
-- Hackathon entries, sealed AI grades, the mindmap bucket and the grading
-- queue (WP-4.7, QDIT-43; D-115, D-116, D-117, D-119). New objects only: no
-- existing table, policy or function is changed.
--
-- ---------------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------------
-- The bootcamp hackathon has teams submit their qdit project, their doqtri
-- notes and global mindmap images in a five-minute window, and grades them
-- with a hidden AI review that nobody sees until a hackathon admin presses
-- Release grades. The rules that make that trustworthy live here, where both
-- the app and a hand-written PostgREST request end:
--
--   D-115  hackathons, hackathon_staff (admin, judge), one entry per project
--          per hackathon, one team per person per hackathon, insert-only
--          versions. Hackathons and the first admin are created by operator
--          SQL; there is no RPC for either.
--   D-116  sealed grades. hackathon_ai_runs and hackathon_grading_jobs have no
--          client policy and no client grant at all. The only way a client
--          reaches a score is hackathon_leaderboard(), which checks
--          first-party session -> hackathon admin -> released_at, in that
--          order, before it joins hackathon_ai_runs. Release is admin-only,
--          refused before closes_at, and irreversible: there is no
--          un-release function, and released_at is never cleared here.
--          Residual (R-15): the service role and the database owner can
--          read the tables; they are operators, not users.
--   D-117  doqtri pushes a workspace snapshot to a project's entry through
--          its own OAuth client only (push_doqtri_hackathon_snapshot()). It
--          is the one hackathon write an OAuth token may make; every other
--          RPC here refuses OAuth tokens first, and no OAuth token can read
--          any table here (restrictive SELECT guards, like
--          20261024110000_oauth_client_guards.sql).
--   D-119  the grading queue: two runs per version, a third on
--          disagreement, at most 20 running at once, three attempts each.
--
-- ---------------------------------------------------------------------------
-- WHO READS WHAT (RLS)
-- ---------------------------------------------------------------------------
--   hackathons                     every signed-in first-party user
--   hackathon_staff                staff of that hackathon; a user their own row
--   hackathon_late_passes          that hackathon's admins; the project's members
--   hackathon_submissions,
--   hackathon_team_members,
--   hackathon_submission_versions,
--   hackathon_doqtri_snapshots     the project's members (any role) and the
--                                  hackathon's staff, judges included, before
--                                  release too (Q-15: judges may read content)
--   hackathon_finalists            that hackathon's staff, and only the
--                                  columns hackathon_id, submission_id and
--                                  pitch_order (ai_rank is reached through
--                                  hackathon_leaderboard() by admins)
--   hackathon_judge_scores         a judge their own rows, after release
--
-- Eligibility is not shown to teams (participants only ever see "Received",
-- D-116): hackathon_submission_versions.eligibility and
-- hackathon_submissions.eligibility_override, override_reason and
-- overridden_by are left out of the column grants to authenticated, for
-- everyone, staff included. Admins read them through
-- hackathon_grading_status() and hackathon_leaderboard(); the grader writes
-- them through the service-role RPCs. Column grants rather than a side
-- table, so RLS, the frozen-row trigger and every RPC stay as they are; the
-- cost is that a client must name its columns (`select *` on those two
-- tables is refused), as on hackathon_finalists.
--   hackathon_grading_jobs,
--   hackathon_ai_runs              nobody (no policy, no grant)
--
-- No table here has an INSERT, UPDATE or DELETE grant for anon or
-- authenticated: every write goes through a SECURITY DEFINER function below.
-- Every table still gets the four restrictive OAuth guards, so a later grant
-- or policy cannot quietly open it to apps (the oauth_client_guards tripwire).
--
-- ---------------------------------------------------------------------------
-- ERRORS THE APP MAPS (SQLSTATE, then MESSAGE)
-- ---------------------------------------------------------------------------
--   42501  not allowed: OAuth token where a first-party session is needed
--          (or the reverse for the push), revoked token, not doqtri's client,
--          role too low, not hackathon staff/admin. Message is a sentence.
--   P0002  not found: no such project (or not a member), hackathon,
--          submission, version, job, username or snapshot. Message is a
--          sentence.
--   22023  invalid argument. HINT names the parameter (team_name, member_ids,
--          image_paths, reason, until, role, submission_ids, scores, note,
--          eligibility, payload_sha256, note_count, payload, snapshot_id,
--          criteria, total, run_no). Message is a sentence.
--   QD409  state conflict. MESSAGE is the machine reason, DETAIL a sentence:
--            hackathon_not_open     before opens_at
--            hackathon_closed       after closes_at with no late pass in
--                                   force, or after release
--            member_on_other_team   a member is on another entry here
--            snapshot_conflict      same (project, snapshot_id), other hash
--            snapshot_limit         30 snapshots for (hackathon, project)
--            hackathon_not_closed   release before closes_at
--            already_released       release twice; regrade or late pass
--                                   after release
--            grading_incomplete     release with pending/running jobs
--            late_pass_active       release while a late pass is in force
--            grades_not_released    leaderboard, pitch order or judge score
--                                   before release
--            not_finalist           judge score for a non-finalist
--            last_admin             removing or demoting the last admin
--            regrade_limit          run numbers exhausted (see below)
--   QD413  snapshot_too_large: the qdit snapshot is over 2 MB after the caps.
--
-- ---------------------------------------------------------------------------
-- RUN NUMBERS AND REGRADE
-- ---------------------------------------------------------------------------
-- hackathon_grading_jobs and hackathon_ai_runs are unique on
-- (version_id, run_no), run_no 1 to 9. A submission's version gets jobs 1
-- and 2; enqueue_third_run() adds the next number. regrade_submission()
-- marks every job of the current version superseded (done ones included)
-- and adds two jobs with the next two numbers, so earlier runs are kept for
-- the record but no longer count: only runs whose job is `done` count
-- towards a grade. Nine numbers allow the first grading plus three regrades
-- (each possibly with a third run); past that regrade_limit.
--
-- Leases are fenced: claim_grading_jobs() returns `attempts`, and
-- complete_grading_job(), fail_grading_job() and skip_grading_job() take it
-- back as p_attempt and do nothing (answer `stale`) unless the job is still
-- running under that same claim. attempts only grows; uncounted retries are
-- kept in free_attempts, and the limit of three applies to
-- attempts - free_attempts.
--
-- An entry's AI grade is combined exactly as rubric.ts combineRuns(): per
-- criterion the one run, the mean of two or the median of three (scores
-- clamped to integers 0-10), total = sum of value/10 x 20, 2 decimals
-- (hackathon_current_ai()). Release and the leaderboard both use it.
--
-- ---------------------------------------------------------------------------
-- THE SNAPSHOT
-- ---------------------------------------------------------------------------
-- submit_hackathon_entry() freezes the project in the same transaction, from
-- one consistent read with the server clock: the QditSnapshotV1 shape of
-- web/src/lib/hackathon/types.ts. Caps: 500 milestones, 2,000 tasks, 2,000
-- of each other list, free text clipped to 4,000 characters ending in
-- " [truncated]"; `truncated` is true when any cap or clip applied. Over 2 MB
-- after that is QD413. The doqtri part is a reference to the newest snapshot
-- (by received_at) the project pushed for that hackathon.
--
-- ---------------------------------------------------------------------------
-- SCHEDULED JOBS
-- ---------------------------------------------------------------------------
--   qdit-grade-hackathon            every minute: GET of the grading route,
--                                   URL and bearer from Vault
--                                   (qdit_grade_hackathon_url,
--                                   qdit_cron_secret), as the webhook job of
--                                   20261024130000 / 20261025090000. It sends
--                                   nothing while a secret is missing (with a
--                                   WARNING) and nothing while the queue has
--                                   no pending or running job.
--   qdit-prune-hackathon-snapshots  daily: deletes doqtri snapshots 90 days
--                                   after their hackathon closed (versions
--                                   keep a null reference).
--   The operator stores the URL once per environment:
--     select vault.create_secret('https://<qdit host>/api/cron/grade-hackathon',
--                                'qdit_grade_hackathon_url');
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Types and tables
-- ----------------------------------------------------------------------------

create type public.hackathon_role as enum ('admin', 'judge');

comment on type public.hackathon_role is
  'A hackathon staff role (D-115). admin > judge; see hackathon_role_rank().';


create table public.hackathons (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9-]{1,64}$'),
  name           text not null check (char_length(btrim(name)) between 1 and 200),
  description    text check (description is null or char_length(description) <= 4000),
  opens_at       timestamptz not null,
  closes_at      timestamptz not null,
  team_min       integer not null default 3 check (team_min >= 1),
  team_max       integer not null default 4,
  finalist_count integer not null default 10 check (finalist_count between 1 and 100),
  -- Set once by release_hackathon_grades(); nothing here clears it.
  released_at    timestamptz,
  released_by    uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint hackathons_window check (closes_at > opens_at),
  constraint hackathons_team_bounds check (team_max >= team_min and team_max <= 20)
);

comment on table public.hackathons is
  'A hackathon (D-115). Created and edited by operator SQL. released_at is set once by release_hackathon_grades() and is what unseals grades for admins (D-116).';


create table public.hackathon_staff (
  hackathon_id uuid not null references public.hackathons (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.hackathon_role not null,
  added_by     uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (hackathon_id, user_id)
);

create index hackathon_staff_user_idx on public.hackathon_staff (user_id);

comment on table public.hackathon_staff is
  'Hackathon admins and judges (D-115). The first admin is added by operator SQL; then set_hackathon_staff(), which never removes or demotes the last admin.';


create table public.hackathon_late_passes (
  hackathon_id uuid not null references public.hackathons (id) on delete cascade,
  project_id   uuid not null references public.projects (id) on delete cascade,
  -- While now() <= until, closes_at does not apply to this project (submit
  -- and push). A pass never opens a hackathon early, and none applies once
  -- grades are released.
  until        timestamptz not null,
  granted_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (hackathon_id, project_id)
);

create index hackathon_late_passes_project_idx on public.hackathon_late_passes (project_id);

comment on table public.hackathon_late_passes is
  'Per-project extension past closes_at, written by grant_late_pass(). A pass with until in the past is no pass.';


create table public.hackathon_doqtri_snapshots (
  -- qdit's id, returned to doqtri as `id` (CONTRACT.md, hackathon-snapshots).
  id             uuid primary key default gen_random_uuid(),
  -- doqtri's idempotency key, unique per project (not globally).
  snapshot_id    uuid not null,
  hackathon_id   uuid not null references public.hackathons (id) on delete cascade,
  project_id     uuid not null references public.projects (id) on delete cascade,
  -- doqtri's workspace id; stored, never interpreted.
  workspace_id   uuid not null,
  pushed_by      uuid references auth.users (id) on delete set null,
  -- The OAuth client that sent it (doqtri's, at the time).
  client_id      uuid not null,
  payload        jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- SHA-256 of the raw request body bytes, lowercase hex, computed by the
  -- route. Compared on a replay.
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  note_count     integer not null check (note_count between 0 and 200),
  received_at    timestamptz not null default now(),
  -- The route's per-note registry check, written later by
  -- record_doqtri_chain_check(); null until then.
  chain_check    jsonb,

  constraint hackathon_doqtri_snapshots_key unique (project_id, snapshot_id)
);

create index hackathon_doqtri_snapshots_entry_idx
  on public.hackathon_doqtri_snapshots (hackathon_id, project_id, received_at desc);

comment on table public.hackathon_doqtri_snapshots is
  'Insert-only copies of doqtri workspaces pushed for a hackathon entry (D-117), through push_doqtri_hackathon_snapshot(). Only chain_check ever changes. Pruned 90 days after the hackathon closes.';


create table public.hackathon_submissions (
  id                   uuid primary key default gen_random_uuid(),
  hackathon_id         uuid not null references public.hackathons (id) on delete cascade,
  project_id           uuid not null references public.projects (id) on delete cascade,
  team_name            text not null
    check (team_name = btrim(team_name) and char_length(team_name) between 1 and 80),
  -- The version that counts. Set by submit_hackathon_entry() right after it
  -- inserts the version; null only inside that transaction.
  current_version_id   uuid,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- An admin's call on eligibility: true or false wins over the computed
  -- answer, null means the computed answer stands.
  eligibility_override boolean,
  override_reason      text,
  overridden_by        uuid references auth.users (id) on delete set null,

  constraint hackathon_submissions_entry_key unique (hackathon_id, project_id),
  -- Target of the composite keys below, so a child row's hackathon is its
  -- submission's.
  constraint hackathon_submissions_id_hackathon_key unique (id, hackathon_id),
  constraint hackathon_submissions_override_reason check (
    (eligibility_override is null and override_reason is null)
    or (eligibility_override is not null
        and char_length(btrim(override_reason)) between 1 and 500)
  )
);

create index hackathon_submissions_project_idx on public.hackathon_submissions (project_id);

create trigger hackathon_submissions_set_updated_at
  before update on public.hackathon_submissions
  for each row execute function public.set_updated_at();

comment on table public.hackathon_submissions is
  'One entry per project per hackathon (D-115). Written only by submit_hackathon_entry() and set_eligibility_override().';


create table public.hackathon_team_members (
  hackathon_id  uuid not null,
  submission_id uuid not null,
  user_id       uuid not null references auth.users (id) on delete cascade,
  primary key (submission_id, user_id),
  -- D-115: a person is on one team per hackathon.
  constraint hackathon_team_members_one_team unique (hackathon_id, user_id),
  constraint hackathon_team_members_submission_fkey
    foreign key (submission_id, hackathon_id)
    references public.hackathon_submissions (id, hackathon_id)
    on delete cascade
);

create index hackathon_team_members_user_idx on public.hackathon_team_members (user_id);

comment on table public.hackathon_team_members is
  'The current team of each entry, replaced on every (re)submit. unique (hackathon_id, user_id) is the one-team-per-person rule.';


create table public.hackathon_submission_versions (
  id                 uuid primary key default gen_random_uuid(),
  submission_id      uuid not null references public.hackathon_submissions (id) on delete cascade,
  version_no         integer not null check (version_no >= 1),
  team_name          text not null,
  member_ids         uuid[] not null check (cardinality(member_ids) between 1 and 20),
  -- QditSnapshotV1 (web/src/lib/hackathon/types.ts), frozen at submit.
  qdit_snapshot      jsonb not null check (jsonb_typeof(qdit_snapshot) = 'object'),
  -- The newest doqtri push at submit time; null when there was none, or
  -- once retention removed it.
  doqtri_snapshot_id uuid references public.hackathon_doqtri_snapshots (id) on delete set null,
  -- `<hackathon_id>/<project_id>/<uuid>.<ext>` in bucket hackathon-mindmaps;
  -- the first is the global mindmap.
  image_paths        text[] not null check (cardinality(image_paths) between 1 and 3),
  submitted_by       uuid references auth.users (id) on delete set null,
  submitted_at       timestamptz not null default now(),
  -- The deterministic gate's result ({eligible: boolean, rules: [...]}),
  -- written by the grader with the service role; null until then.
  eligibility        jsonb,

  constraint hackathon_submission_versions_no_key unique (submission_id, version_no)
);

create index hackathon_submission_versions_doqtri_idx
  on public.hackathon_submission_versions (doqtri_snapshot_id);

comment on table public.hackathon_submission_versions is
  'Insert-only versions of an entry (D-115): the frozen qdit snapshot, the doqtri snapshot reference and the image paths. Only eligibility changes, through set_version_eligibility() (service_role).';


alter table public.hackathon_submissions
  add constraint hackathon_submissions_current_version_fkey
  foreign key (current_version_id)
  references public.hackathon_submission_versions (id)
  on delete set null;

create index hackathon_submissions_current_version_idx
  on public.hackathon_submissions (current_version_id);


create table public.hackathon_grading_jobs (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null references public.hackathon_submission_versions (id) on delete cascade,
  run_no          smallint not null check (run_no between 1 and 9),
  status          text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'failed', 'superseded')),
  -- Claims so far, the one in progress included. Only grows, so it is also
  -- the lease's fencing token: complete/fail/skip act only for the claim
  -- whose `attempts` they pass (p_attempt).
  attempts        integer not null default 0 check (attempts >= 0),
  -- Of those, the claims that do not count towards the limit of three
  -- (fail_grading_job with p_count_attempt false: provider overload, budget
  -- abort). Counted attempts = attempts - free_attempts. At most 20, after
  -- which a failure counts whatever is passed.
  free_attempts   integer not null default 0 check (free_attempts between 0 and 20),
  lease_until     timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error      text check (last_error is null or char_length(last_error) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint hackathon_grading_jobs_run_key unique (version_id, run_no),
  constraint hackathon_grading_jobs_counted_attempts
    check (attempts - free_attempts between 0 and 3)
);

create index hackathon_grading_jobs_due_idx
  on public.hackathon_grading_jobs (next_attempt_at)
  where status = 'pending';
create index hackathon_grading_jobs_running_idx
  on public.hackathon_grading_jobs (lease_until)
  where status = 'running';

create trigger hackathon_grading_jobs_set_updated_at
  before update on public.hackathon_grading_jobs
  for each row execute function public.set_updated_at();

comment on table public.hackathon_grading_jobs is
  'The AI grading queue (D-119). Leased by claim_grading_jobs(), settled by complete_grading_job() and fail_grading_job(). No client role can read it.';


create table public.hackathon_ai_runs (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.hackathon_submission_versions (id) on delete cascade,
  run_no      smallint not null check (run_no between 1 and 9),
  model       text not null check (char_length(model) between 1 and 200),
  criteria    jsonb not null check (jsonb_typeof(criteria) = 'object'),
  total       numeric(5, 2) not null check (total between 0 and 100),
  flags       text[] not null default '{}',
  summary     text check (summary is null or char_length(summary) <= 8000),
  stop_reason text,
  usage       jsonb,
  truncated   boolean not null default false,
  created_at  timestamptz not null default now(),

  constraint hackathon_ai_runs_run_key unique (version_id, run_no)
);

comment on table public.hackathon_ai_runs is
  'Sealed AI review results (D-116). No client policy and no client grant: admins reach them only through hackathon_leaderboard() after release.';


create table public.hackathon_finalists (
  hackathon_id  uuid not null references public.hackathons (id) on delete cascade,
  submission_id uuid not null,
  ai_rank       integer not null check (ai_rank >= 1),
  pitch_order   integer check (pitch_order >= 1),
  primary key (hackathon_id, submission_id),
  constraint hackathon_finalists_rank_key unique (hackathon_id, ai_rank),
  constraint hackathon_finalists_pitch_key unique (hackathon_id, pitch_order),
  constraint hackathon_finalists_submission_fkey
    foreign key (submission_id, hackathon_id)
    references public.hackathon_submissions (id, hackathon_id)
    on delete cascade
);

comment on table public.hackathon_finalists is
  'Written once by release_hackathon_grades() (top finalist_count eligible by AI score); pitch_order by set_pitch_order(). Clients read only hackathon_id, submission_id and pitch_order.';


create table public.hackathon_judge_scores (
  id            uuid primary key default gen_random_uuid(),
  hackathon_id  uuid not null,
  submission_id uuid not null,
  judge_id      uuid not null references auth.users (id) on delete cascade,
  clarity       smallint not null check (clarity between 1 and 5),
  structure     smallint not null check (structure between 1 and 5),
  accuracy      smallint not null check (accuracy between 1 and 5),
  connections   smallint not null check (connections between 1 and 5),
  pitch         smallint not null check (pitch between 1 and 5),
  note          text check (note is null or char_length(note) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint hackathon_judge_scores_key unique (submission_id, judge_id),
  -- Only a finalist can be scored, by construction.
  constraint hackathon_judge_scores_finalist_fkey
    foreign key (hackathon_id, submission_id)
    references public.hackathon_finalists (hackathon_id, submission_id)
    on delete cascade
);

create index hackathon_judge_scores_judge_idx on public.hackathon_judge_scores (judge_id);
create index hackathon_judge_scores_finalist_idx
  on public.hackathon_judge_scores (hackathon_id, submission_id);

create trigger hackathon_judge_scores_set_updated_at
  before update on public.hackathon_judge_scores
  for each row execute function public.set_updated_at();

comment on table public.hackathon_judge_scores is
  'A judge''s 5 x 1-5 scores for one finalist (D-119). Written only by upsert_judge_score(), after release.';


-- ----------------------------------------------------------------------------
-- 2. Insert-only rows stay what they were
--
-- For every role, the service role and the owner included: a frozen
-- snapshot that can be edited is not frozen. The one mutable column of each
-- is named.
-- ----------------------------------------------------------------------------

create or replace function public.hackathon_guard_frozen_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'hackathon_doqtri_snapshots' then
    if (to_jsonb(new) - 'chain_check') is distinct from (to_jsonb(old) - 'chain_check') then
      raise exception 'Hackathon doqtri snapshots are insert-only; only chain_check changes.'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'hackathon_submission_versions' then
    -- doqtri_snapshot_id may only go to null: the foreign key's
    -- `on delete set null` when retention removes the snapshot.
    if (to_jsonb(new) - 'eligibility' - 'doqtri_snapshot_id')
         is distinct from (to_jsonb(old) - 'eligibility' - 'doqtri_snapshot_id')
       or (new.doqtri_snapshot_id is not null
           and new.doqtri_snapshot_id is distinct from old.doqtri_snapshot_id) then
      raise exception 'Submission versions are insert-only; only eligibility changes.'
        using errcode = '42501';
    end if;
  else
    raise exception 'Rows of % are insert-only.', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.hackathon_guard_frozen_row() is
  'BEFORE UPDATE trigger: hackathon_doqtri_snapshots may change only chain_check, hackathon_submission_versions only eligibility (and doqtri_snapshot_id to null, by its foreign key), hackathon_ai_runs nothing.';

revoke all on function public.hackathon_guard_frozen_row() from public, anon, authenticated, service_role;

create trigger hackathon_doqtri_snapshots_frozen
  before update on public.hackathon_doqtri_snapshots
  for each row execute function public.hackathon_guard_frozen_row();

create trigger hackathon_submission_versions_frozen
  before update on public.hackathon_submission_versions
  for each row execute function public.hackathon_guard_frozen_row();

create trigger hackathon_ai_runs_frozen
  before update on public.hackathon_ai_runs
  for each row execute function public.hackathon_guard_frozen_row();


-- ----------------------------------------------------------------------------
-- 3. Helpers
-- ----------------------------------------------------------------------------

create or replace function public.hackathon_role_rank(p_role public.hackathon_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'judge' then 1 when 'admin' then 2 end;
$$;

comment on function public.hackathon_role_rank(public.hackathon_role) is
  'Orders hackathon_role for >= comparisons: judge(1) < admin(2).';


-- True when the caller is staff of p_hackathon_id with at least p_min_role.
-- SECURITY DEFINER for the same reason as is_project_member(): the
-- hackathon_staff read policy calls it. Answers about auth.uid() only.
create or replace function public.is_hackathon_staff(
  p_hackathon_id uuid,
  p_min_role     text default 'judge'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.hackathon_staff s
     where s.hackathon_id = p_hackathon_id
       and s.user_id = (select auth.uid())
       and public.hackathon_role_rank(s.role)
           >= public.hackathon_role_rank(p_min_role::public.hackathon_role)
  );
$$;

comment on function public.is_hackathon_staff(uuid, text) is
  'SECURITY DEFINER. Whether the caller is staff of p_hackathon_id with at least p_min_role (judge < admin). Always auth.uid(); returns only a boolean.';


-- not_open | open | closed for one project, at now(). A late pass in force
-- keeps a closed hackathon open for that project; nothing is open after
-- release. Internal: it reads late passes of any project.
create or replace function public.hackathon_window_state(
  p_hackathon_id uuid,
  p_project_id   uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when h.released_at is not null then 'closed'
           when now() < h.opens_at then 'not_open'
           when now() <= h.closes_at then 'open'
           when exists (
             select 1 from public.hackathon_late_passes lp
              where lp.hackathon_id = h.id
                and lp.project_id = p_project_id
                and lp.until >= now()
           ) then 'open'
           else 'closed'
         end
    from public.hackathons h
   where h.id = p_hackathon_id;
$$;

comment on function public.hackathon_window_state(uuid, uuid) is
  'not_open | open | closed for p_project_id in p_hackathon_id at now(): closes_at does not apply while a late pass is in force; nothing is open after release. Null for an unknown hackathon. Internal.';


-- Raises QD409 hackathon_not_open / hackathon_closed unless open.
create or replace function public.assert_hackathon_open(
  p_hackathon_id uuid,
  p_project_id   uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state text := public.hackathon_window_state(p_hackathon_id, p_project_id);
begin
  if v_state = 'not_open' then
    raise exception 'hackathon_not_open'
      using errcode = 'QD409', detail = 'This hackathon has not opened yet.';
  elsif v_state is distinct from 'open' then
    raise exception 'hackathon_closed'
      using errcode = 'QD409', detail = 'This hackathon is closed for this project.';
  end if;
end;
$$;


-- Whether an entry counts as eligible: the admin's override wins, otherwise
-- the gate's `eligible`, and no result yet is not eligible.
create or replace function public.hackathon_entry_eligible(
  p_override    boolean,
  p_eligibility jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_override, (p_eligibility -> 'eligible') = 'true'::jsonb, false);
$$;


-- Clips free text for the snapshot: at most 4,000 characters, the last 12
-- being the marker.
create or replace function public.hackathon_clip_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_text is null or char_length(p_text) <= 4000 then p_text
           else left(p_text, 4000 - 12) || ' [truncated]'
         end;
$$;


-- The AI grade of each entry's current version, from the runs whose job is
-- `done` (a regrade supersedes the rest), exactly as rubric.ts
-- combineRuns(): each criterion's score clamped to an integer 0-10; per
-- criterion the one run, the mean of two, or the median of three or more,
-- rounded to 2 decimals; total = sum of (value / 10 x 20), rounded to 2
-- decimals. Never the median of run totals. ai_mean is the plain mean of the
-- stored run totals, for display. Internal: callers check access.
create or replace function public.hackathon_current_ai(p_hackathon_id uuid)
returns table (
  submission_id uuid,
  version_id    uuid,
  run_count     integer,
  runs          jsonb,
  ai_mean       numeric,
  per_criterion jsonb,
  ai_total      numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with entries as (
    select s.id, s.current_version_id
      from public.hackathon_submissions s
     where s.hackathon_id = p_hackathon_id
  ),
  counted as (
    select r.*
      from entries e
      join public.hackathon_grading_jobs j
        on j.version_id = e.current_version_id and j.status = 'done'
      join public.hackathon_ai_runs r
        on r.version_id = j.version_id and r.run_no = j.run_no
  ),
  run_stats as (
    select c.version_id,
           count(*)::integer as run_count,
           jsonb_agg(jsonb_build_object(
             'run_no', c.run_no,
             'model', c.model,
             'total', c.total,
             'criteria', c.criteria,
             'flags', to_jsonb(c.flags),
             'summary', c.summary,
             'truncated', c.truncated,
             'created_at', c.created_at
           ) order by c.run_no) as runs,
           round(avg(c.total), 2) as ai_mean
      from counted c
     group by c.version_id
  ),
  scores as (
    -- clampScore(): round to an integer, then 0-10. A score that is not a
    -- number is left out (the grader stores only parsed runs).
    select c.version_id, k.key,
           least(10, greatest(0, round((c.criteria -> k.key ->> 'score')::numeric))) as score
      from counted c
     cross join unnest(array['clarity', 'structure', 'accuracy', 'connections', 'execution']) as k (key)
     where jsonb_typeof(c.criteria -> k.key -> 'score') = 'number'
  ),
  per_key as (
    select sc.version_id, sc.key,
           round(case
                   when rs.run_count >= 3
                     then (percentile_cont(0.5) within group (order by sc.score))::numeric
                   else avg(sc.score)
                 end, 2) as value
      from scores sc
      join run_stats rs on rs.version_id = sc.version_id
     group by sc.version_id, sc.key, rs.run_count
  ),
  combined as (
    select pk.version_id,
           jsonb_object_agg(pk.key, pk.value) as per_criterion,
           round(sum(pk.value / 10 * 20), 2) as ai_total
      from per_key pk
     group by pk.version_id
  )
  select e.id, e.current_version_id,
         coalesce(rs.run_count, 0),
         coalesce(rs.runs, '[]'::jsonb),
         rs.ai_mean,
         cb.per_criterion,
         cb.ai_total
    from entries e
    left join run_stats rs on rs.version_id = e.current_version_id
    left join combined cb on cb.version_id = e.current_version_id;
$$;

comment on function public.hackathon_current_ai(uuid) is
  'Internal, no client grant. Per entry of p_hackathon_id: the current version''s counted AI runs (job done) as jsonb, the mean of their totals, and the combined grade exactly as rubric.ts combineRuns (clamped integer scores; per criterion one run, mean of two or median of three; total = sum of value/10 x 20, 2 decimals).';


-- QditSnapshotV1 of one project, now. Internal: called by
-- submit_hackathon_entry() after its role check.
create or replace function public.build_hackathon_qdit_snapshot(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_truncated boolean;
  v_snapshot  jsonb;
begin
  v_truncated :=
       (select count(*) from public.milestones m where m.project_id = p_project_id) > 500
    or (select count(*) from public.tasks t where t.project_id = p_project_id) > 2000
    or (select count(*) from public.project_members pm where pm.project_id = p_project_id) > 2000
    or (select count(*) from public.milestone_reviews r where r.project_id = p_project_id) > 2000
    or (select count(*) from public.milestone_anchors a where a.project_id = p_project_id) > 2000
    or (select count(*) from public.stellar_proofs sp where sp.project_id = p_project_id) > 2000
    or (select count(*) from public.deployments d where d.project_id = p_project_id) > 2000
    or (select count(*) from public.project_doc_links dl where dl.project_id = p_project_id) > 2000
    or (select count(*) from public.milestone_external_links ml where ml.project_id = p_project_id) > 2000
    or exists (
      select 1 from public.projects p
       where p.id = p_project_id
         and greatest(char_length(p.description), char_length(p.repo_url),
                      char_length(p.demo_url), char_length(p.docs_url)) > 4000)
    or exists (
      select 1 from public.milestones m
       where m.project_id = p_project_id and char_length(m.description) > 4000)
    or exists (
      select 1 from public.tasks t
       where t.project_id = p_project_id and char_length(t.description) > 4000)
    or exists (
      select 1 from public.project_members pm
        join public.profiles pr on pr.id = pm.user_id
       where pm.project_id = p_project_id and char_length(pr.display_name) > 4000)
    or exists (
      select 1 from public.stellar_proofs sp
       where sp.project_id = p_project_id
         and greatest(char_length(sp.contract_id), char_length(sp.tx_hash),
                      char_length(sp.wallet_address), char_length(sp.proof_url),
                      char_length(sp.notes)) > 4000)
    or exists (
      select 1 from public.deployments d
       where d.project_id = p_project_id
         and greatest(char_length(d.contract_id), char_length(d.tx_hash),
                      char_length(d.release_notes)) > 4000)
    or exists (
      select 1 from public.milestone_anchors a
       where a.project_id = p_project_id
         and greatest(char_length(a.contract_id), char_length(a.signer_address)) > 4000);

  select jsonb_build_object(
    'schema_version', 1,
    'captured_at', now(),
    'truncated', v_truncated,
    'project', (
      select jsonb_build_object(
        'id', p.id,
        'slug', p.slug,
        'name', p.name,
        'description', public.hackathon_clip_text(p.description),
        'status', p.status,
        'repo_url', public.hackathon_clip_text(p.repo_url),
        'demo_url', public.hackathon_clip_text(p.demo_url),
        'docs_url', public.hackathon_clip_text(p.docs_url),
        'created_at', p.created_at,
        'chain_contract_id', p.chain_contract_id,
        'public_proofs', p.public_proofs
      )
      from public.projects p where p.id = p_project_id
    ),
    'members', (
      select coalesce(jsonb_agg(x.j order by x.joined_at, x.user_id), '[]'::jsonb)
        from (
          select pm.joined_at, pm.user_id,
                 jsonb_build_object(
                   'user_id', pm.user_id,
                   'role', pm.role,
                   'joined_at', pm.joined_at,
                   'username', pr.username,
                   'display_name', public.hackathon_clip_text(pr.display_name),
                   'wallet_address', pr.wallet_address
                 ) as j
            from public.project_members pm
            left join public.profiles pr on pr.id = pm.user_id
           where pm.project_id = p_project_id
           order by pm.joined_at, pm.user_id
           limit 2000
        ) x
    ),
    'milestones', (
      select coalesce(jsonb_agg(x.j order by x.order_index, x.created_at, x.id), '[]'::jsonb)
        from (
          select m.order_index, m.created_at, m.id,
                 jsonb_build_object(
                   'id', m.id,
                   'title', m.title,
                   'description', public.hackathon_clip_text(m.description),
                   'status', m.status,
                   'due_date', m.due_date,
                   'order_index', m.order_index,
                   'created_at', m.created_at,
                   'updated_at', m.updated_at
                 ) as j
            from public.milestones m
           where m.project_id = p_project_id
           order by m.order_index, m.created_at, m.id
           limit 500
        ) x
    ),
    'tasks', (
      select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb)
        from (
          select t.created_at, t.id,
                 jsonb_build_object(
                   'id', t.id,
                   'milestone_id', t.milestone_id,
                   'title', t.title,
                   'description', public.hackathon_clip_text(t.description),
                   'status', t.status,
                   'assignee_id', t.assignee_id,
                   'priority', t.priority,
                   'due_date', t.due_date,
                   'created_at', t.created_at,
                   'updated_at', t.updated_at
                 ) as j
            from public.tasks t
           where t.project_id = p_project_id
           order by t.created_at, t.id
           limit 2000
        ) x
    ),
    'milestone_reviews', (
      select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb)
        from (
          select r.created_at, r.id,
                 jsonb_build_object(
                   'id', r.id,
                   'milestone_id', r.milestone_id,
                   'from_status', r.from_status,
                   'to_status', r.to_status,
                   'reason', public.hackathon_clip_text(r.reason),
                   'reviewer_id', r.reviewer_id,
                   'created_at', r.created_at
                 ) as j
            from public.milestone_reviews r
           where r.project_id = p_project_id
           order by r.created_at, r.id
           limit 2000
        ) x
    ),
    'milestone_anchors', (
      select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb)
        from (
          select a.created_at, a.id,
                 jsonb_build_object(
                   'id', a.id,
                   'milestone_id', a.milestone_id,
                   'action', a.action,
                   'proof_hash', a.proof_hash,
                   'version', a.version,
                   'contract_id', public.hackathon_clip_text(a.contract_id),
                   'network', a.network,
                   'tx_hash', a.tx_hash,
                   'signer_address', public.hackathon_clip_text(a.signer_address),
                   'ledger', a.ledger,
                   'created_at', a.created_at
                 ) as j
            from public.milestone_anchors a
           where a.project_id = p_project_id
           order by a.created_at, a.id
           limit 2000
        ) x
    ),
    'stellar_proofs', (
      select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb)
        from (
          select sp.created_at, sp.id,
                 jsonb_build_object(
                   'id', sp.id,
                   'milestone_id', sp.milestone_id,
                   'contract_id', public.hackathon_clip_text(sp.contract_id),
                   'tx_hash', public.hackathon_clip_text(sp.tx_hash),
                   'network', sp.network,
                   'wallet_address', public.hackathon_clip_text(sp.wallet_address),
                   'proof_url', public.hackathon_clip_text(sp.proof_url),
                   'notes', public.hackathon_clip_text(sp.notes),
                   'created_at', sp.created_at
                 ) as j
            from public.stellar_proofs sp
           where sp.project_id = p_project_id
           order by sp.created_at, sp.id
           limit 2000
        ) x
    ),
    'deployments', (
      select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb)
        from (
          select d.created_at, d.id,
                 jsonb_build_object(
                   'id', d.id,
                   'status', d.status,
                   'network', d.network,
                   'contract_id', public.hackathon_clip_text(d.contract_id),
                   'tx_hash', public.hackathon_clip_text(d.tx_hash),
                   'release_notes', public.hackathon_clip_text(d.release_notes),
                   'deployed_at', d.deployed_at,
                   'created_at', d.created_at
                 ) as j
            from public.deployments d
           where d.project_id = p_project_id
           order by d.created_at, d.id
           limit 2000
        ) x
    ),
    'doc_links', (
      select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb)
        from (
          select dl.created_at, dl.id,
                 jsonb_build_object(
                   'doc_id', dl.doc_id,
                   'doc_title', dl.doc_title,
                   'doc_url', dl.doc_url
                 ) as j
            from public.project_doc_links dl
           where dl.project_id = p_project_id
           order by dl.created_at, dl.id
           limit 2000
        ) x
    ),
    'milestone_links', (
      select coalesce(jsonb_agg(x.j order by x.created_at, x.id), '[]'::jsonb)
        from (
          select ml.created_at, ml.id,
                 jsonb_build_object(
                   'milestone_id', ml.milestone_id,
                   'doc_id', ml.doc_id,
                   'node_id', ml.node_id,
                   'node_label', ml.node_label,
                   'doc_version', ml.doc_version
                 ) as j
            from public.milestone_external_links ml
           where ml.project_id = p_project_id
           order by ml.created_at, ml.id
           limit 2000
        ) x
    )
  ) into v_snapshot;

  return v_snapshot;
end;
$$;

comment on function public.build_hackathon_qdit_snapshot(uuid) is
  'Internal, no client grant. The QditSnapshotV1 (web/src/lib/hackathon/types.ts) of one project at now(): 500 milestones, 2,000 of every other list, free text clipped to 4,000 characters with " [truncated]"; truncated = any cap or clip applied.';


-- Storage path rules for bucket hackathon-mindmaps:
-- `<hackathon uuid>/<project uuid>/<uuid>.(png|jpg|jpeg|webp)`, lower case.
-- Returns {hackathon_id, project_id} or null when the name is not one.
create or replace function public.hackathon_mindmap_path(p_name text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select regexp_match(
    p_name,
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'
    '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$'
  );
$$;


-- May the caller upload this object? First-party session, admin or owner of
-- the project in segment 2, and the hackathon in segment 1 open for it.
create or replace function public.hackathon_mindmap_upload_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := public.hackathon_mindmap_path(p_name);
begin
  if v_parts is null or (auth.jwt() ->> 'client_id') is not null then
    return false;
  end if;

  return public.is_project_member(v_parts[2]::uuid, 'admin')
     and coalesce(public.hackathon_window_state(v_parts[1]::uuid, v_parts[2]::uuid) = 'open', false);
end;
$$;

comment on function public.hackathon_mindmap_upload_allowed(text) is
  'SECURITY DEFINER, for the hackathon-mindmaps INSERT policy: a well-formed path, a first-party session, admin+ of the path''s project, and the path''s hackathon open for that project (late pass honoured).';


-- May the caller read this object? Members of the project, or staff of the
-- hackathon.
create or replace function public.hackathon_mindmap_read_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := public.hackathon_mindmap_path(p_name);
begin
  if v_parts is null then
    return false;
  end if;

  return public.is_project_member(v_parts[2]::uuid, 'viewer')
      or public.is_hackathon_staff(v_parts[1]::uuid, 'judge');
end;
$$;

comment on function public.hackathon_mindmap_read_allowed(text) is
  'SECURITY DEFINER, for the hackathon-mindmaps SELECT policy: members of the path''s project and staff of the path''s hackathon.';


-- ----------------------------------------------------------------------------
-- 4. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.hackathons                    enable row level security;
alter table public.hackathon_staff               enable row level security;
alter table public.hackathon_late_passes         enable row level security;
alter table public.hackathon_doqtri_snapshots    enable row level security;
alter table public.hackathon_submissions         enable row level security;
alter table public.hackathon_team_members        enable row level security;
alter table public.hackathon_submission_versions enable row level security;
alter table public.hackathon_grading_jobs        enable row level security;
alter table public.hackathon_ai_runs             enable row level security;
alter table public.hackathon_finalists           enable row level security;
alter table public.hackathon_judge_scores        enable row level security;


-- Grants first: nothing for anon, reads only for authenticated, and nothing
-- at all on the queue and the grades.
revoke all on table public.hackathons                    from anon, authenticated;
revoke all on table public.hackathon_staff               from anon, authenticated;
revoke all on table public.hackathon_late_passes         from anon, authenticated;
revoke all on table public.hackathon_doqtri_snapshots    from anon, authenticated;
revoke all on table public.hackathon_submissions         from anon, authenticated;
revoke all on table public.hackathon_team_members        from anon, authenticated;
revoke all on table public.hackathon_submission_versions from anon, authenticated;
revoke all on table public.hackathon_grading_jobs        from anon, authenticated;
revoke all on table public.hackathon_ai_runs             from anon, authenticated;
revoke all on table public.hackathon_finalists           from anon, authenticated;
revoke all on table public.hackathon_judge_scores        from anon, authenticated;

grant select on table public.hackathons                    to authenticated;
grant select on table public.hackathon_staff               to authenticated;
grant select on table public.hackathon_late_passes         to authenticated;
grant select on table public.hackathon_doqtri_snapshots    to authenticated;
grant select on table public.hackathon_team_members        to authenticated;
-- Everything but eligibility and the override (header: not shown to teams).
grant select (id, hackathon_id, project_id, team_name, current_version_id,
              created_by, created_at, updated_at)
  on table public.hackathon_submissions to authenticated;
grant select (id, submission_id, version_no, team_name, member_ids, qdit_snapshot,
              doqtri_snapshot_id, image_paths, submitted_by, submitted_at)
  on table public.hackathon_submission_versions to authenticated;
grant select on table public.hackathon_judge_scores        to authenticated;
-- ai_rank is grade-derived (D-116): admins read it through the leaderboard.
grant select (hackathon_id, submission_id, pitch_order) on table public.hackathon_finalists to authenticated;


-- Permissive reads ---------------------------------------------------------

create policy "hackathons: read when signed in"
  on public.hackathons
  for select
  to authenticated
  using (true);

create policy "hackathon_staff: read as staff or own row"
  on public.hackathon_staff
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_hackathon_staff(hackathon_id, 'judge')
  );

create policy "hackathon_late_passes: read as admin or project member"
  on public.hackathon_late_passes
  for select
  to authenticated
  using (
    public.is_project_member(project_id, 'viewer')
    or public.is_hackathon_staff(hackathon_id, 'admin')
  );

create policy "hackathon_doqtri_snapshots: read as project member or staff"
  on public.hackathon_doqtri_snapshots
  for select
  to authenticated
  using (
    public.is_project_member(project_id, 'viewer')
    or public.is_hackathon_staff(hackathon_id, 'judge')
  );

create policy "hackathon_submissions: read as project member or staff"
  on public.hackathon_submissions
  for select
  to authenticated
  using (
    public.is_project_member(project_id, 'viewer')
    or public.is_hackathon_staff(hackathon_id, 'judge')
  );

create policy "hackathon_team_members: read as project member or staff"
  on public.hackathon_team_members
  for select
  to authenticated
  using (
    public.is_hackathon_staff(hackathon_id, 'judge')
    or exists (
      select 1 from public.hackathon_submissions s
       where s.id = hackathon_team_members.submission_id
         and public.is_project_member(s.project_id, 'viewer')
    )
  );

create policy "hackathon_submission_versions: read as project member or staff"
  on public.hackathon_submission_versions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.hackathon_submissions s
       where s.id = hackathon_submission_versions.submission_id
         and (public.is_project_member(s.project_id, 'viewer')
              or public.is_hackathon_staff(s.hackathon_id, 'judge'))
    )
  );

create policy "hackathon_finalists: read as staff"
  on public.hackathon_finalists
  for select
  to authenticated
  using (public.is_hackathon_staff(hackathon_id, 'judge'));

create policy "hackathon_judge_scores: read own after release"
  on public.hackathon_judge_scores
  for select
  to authenticated
  using (
    judge_id = (select auth.uid())
    and public.is_hackathon_staff(hackathon_id, 'judge')
    and exists (
      select 1 from public.hackathons h
       where h.id = hackathon_judge_scores.hackathon_id
         and h.released_at is not null
    )
  );

-- hackathon_grading_jobs, hackathon_ai_runs: no permissive policy (D-116).


-- Restrictive OAuth guards (20261024110000_oauth_client_guards.sql) --------
-- Four per table. SELECT is closed too: no table here is on D-03's list,
-- and a snapshot doqtri sent is not read back (D-117).

create policy "hackathons: no select by oauth clients"
  on public.hackathons
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathons: no insert by oauth clients"
  on public.hackathons
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathons: no update by oauth clients"
  on public.hackathons
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathons: no delete by oauth clients"
  on public.hackathons
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_staff: no select by oauth clients"
  on public.hackathon_staff
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_staff: no insert by oauth clients"
  on public.hackathon_staff
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_staff: no update by oauth clients"
  on public.hackathon_staff
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_staff: no delete by oauth clients"
  on public.hackathon_staff
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_late_passes: no select by oauth clients"
  on public.hackathon_late_passes
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_late_passes: no insert by oauth clients"
  on public.hackathon_late_passes
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_late_passes: no update by oauth clients"
  on public.hackathon_late_passes
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_late_passes: no delete by oauth clients"
  on public.hackathon_late_passes
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_doqtri_snapshots: no select by oauth clients"
  on public.hackathon_doqtri_snapshots
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_doqtri_snapshots: no insert by oauth clients"
  on public.hackathon_doqtri_snapshots
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_doqtri_snapshots: no update by oauth clients"
  on public.hackathon_doqtri_snapshots
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_doqtri_snapshots: no delete by oauth clients"
  on public.hackathon_doqtri_snapshots
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_submissions: no select by oauth clients"
  on public.hackathon_submissions
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_submissions: no insert by oauth clients"
  on public.hackathon_submissions
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_submissions: no update by oauth clients"
  on public.hackathon_submissions
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_submissions: no delete by oauth clients"
  on public.hackathon_submissions
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_team_members: no select by oauth clients"
  on public.hackathon_team_members
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_team_members: no insert by oauth clients"
  on public.hackathon_team_members
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_team_members: no update by oauth clients"
  on public.hackathon_team_members
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_team_members: no delete by oauth clients"
  on public.hackathon_team_members
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_submission_versions: no select by oauth clients"
  on public.hackathon_submission_versions
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_submission_versions: no insert by oauth clients"
  on public.hackathon_submission_versions
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_submission_versions: no update by oauth clients"
  on public.hackathon_submission_versions
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_submission_versions: no delete by oauth clients"
  on public.hackathon_submission_versions
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_grading_jobs: no select by oauth clients"
  on public.hackathon_grading_jobs
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_grading_jobs: no insert by oauth clients"
  on public.hackathon_grading_jobs
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_grading_jobs: no update by oauth clients"
  on public.hackathon_grading_jobs
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_grading_jobs: no delete by oauth clients"
  on public.hackathon_grading_jobs
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_ai_runs: no select by oauth clients"
  on public.hackathon_ai_runs
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_ai_runs: no insert by oauth clients"
  on public.hackathon_ai_runs
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_ai_runs: no update by oauth clients"
  on public.hackathon_ai_runs
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_ai_runs: no delete by oauth clients"
  on public.hackathon_ai_runs
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_finalists: no select by oauth clients"
  on public.hackathon_finalists
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_finalists: no insert by oauth clients"
  on public.hackathon_finalists
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_finalists: no update by oauth clients"
  on public.hackathon_finalists
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_finalists: no delete by oauth clients"
  on public.hackathon_finalists
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_judge_scores: no select by oauth clients"
  on public.hackathon_judge_scores
  as restrictive
  for select
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_judge_scores: no insert by oauth clients"
  on public.hackathon_judge_scores
  as restrictive
  for insert
  to public
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_judge_scores: no update by oauth clients"
  on public.hackathon_judge_scores
  as restrictive
  for update
  to public
  using (((select auth.jwt()) ->> 'client_id') is null)
  with check (((select auth.jwt()) ->> 'client_id') is null);

create policy "hackathon_judge_scores: no delete by oauth clients"
  on public.hackathon_judge_scores
  as restrictive
  for delete
  to public
  using (((select auth.jwt()) ->> 'client_id') is null);


-- ----------------------------------------------------------------------------
-- 5. Storage: bucket hackathon-mindmaps
--
-- Private, 5 MB, png/jpeg/webp. Browsers upload directly (Server Actions cap
-- bodies at 1 MB). INSERT: first-party, project admin+, window open (late
-- pass honoured), path `<hackathon>/<project>/<uuid>.<ext>`. SELECT: project
-- members and hackathon staff (signed URLs come from here). No UPDATE or
-- DELETE policy, so an uploaded map cannot be swapped after a submission
-- froze its path. OAuth tokens get nothing in this bucket.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('hackathon-mindmaps', 'hackathon-mindmaps', false)
on conflict (id) do nothing;

-- The limit columns come from Storage's own migrations; a database built
-- without them (no Storage service) still gets the bucket.
do $bucket$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets'
       and column_name in ('file_size_limit', 'allowed_mime_types')
    having count(*) = 2
  ) then
    execute $sql$
      update storage.buckets
         set public = false,
             file_size_limit = 5242880,
             allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
       where id = 'hackathon-mindmaps'
    $sql$;
  else
    raise notice 'storage.buckets has no file_size_limit/allowed_mime_types here; hackathon-mindmaps is created without them';
  end if;
end;
$bucket$;

create policy "hackathon-mindmaps: insert as project admin while open"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'hackathon-mindmaps'
    and public.hackathon_mindmap_upload_allowed(name)
  );

create policy "hackathon-mindmaps: read as project member or staff"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'hackathon-mindmaps'
    and public.hackathon_mindmap_read_allowed(name)
  );

create policy "hackathon-mindmaps: no oauth clients"
  on storage.objects
  as restrictive
  for all
  to public
  using (
    bucket_id <> 'hackathon-mindmaps'
    or ((select auth.jwt()) ->> 'client_id') is null
  )
  with check (
    bucket_id <> 'hackathon-mindmaps'
    or ((select auth.jwt()) ->> 'client_id') is null
  );


-- ----------------------------------------------------------------------------
-- 6. Participant RPC: submit an entry
-- ----------------------------------------------------------------------------

create or replace function public.submit_hackathon_entry(
  p_hackathon_id uuid,
  p_project_id   uuid,
  p_team_name    text,
  p_member_ids   uuid[],
  p_image_paths  text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_h          public.hackathons;
  v_team_name  text := btrim(coalesce(p_team_name, ''));
  v_members    uuid[];
  v_path       text;
  v_parts      text[];
  v_taken      text;
  v_snapshot   jsonb;
  v_size       integer;
  v_sub_id     uuid;
  v_version_no integer;
  v_doqtri_id  uuid;
  v_version_id uuid;
begin
  perform public.assert_first_party_session();

  if v_uid is null then
    raise exception 'Sign in to submit.' using errcode = '42501';
  end if;

  select * into v_h from public.hackathons h where h.id = p_hackathon_id;
  if not found then
    raise exception 'No such hackathon.' using errcode = 'P0002';
  end if;

  -- P0002 outside the project, 42501 below admin.
  perform public.assert_project_role(p_project_id, 'admin');

  perform public.assert_hackathon_open(v_h.id, p_project_id);

  if char_length(v_team_name) not between 1 and 80 then
    raise exception 'Team name must be 1 to 80 characters.'
      using errcode = '22023', hint = 'team_name';
  end if;

  select coalesce(array_agg(distinct m), '{}') into v_members
    from unnest(coalesce(p_member_ids, '{}'::uuid[])) as m
   where m is not null;

  if cardinality(v_members) <> cardinality(coalesce(p_member_ids, '{}'::uuid[])) then
    raise exception 'Each team member may be listed once.'
      using errcode = '22023', hint = 'member_ids';
  end if;

  if cardinality(v_members) not between v_h.team_min and v_h.team_max then
    raise exception 'A team has % to % members; this one has %.',
      v_h.team_min, v_h.team_max, cardinality(v_members)
      using errcode = '22023', hint = 'member_ids';
  end if;

  if exists (
    select 1 from unnest(v_members) as m
     where not exists (
       select 1 from public.project_members pm
        where pm.project_id = p_project_id and pm.user_id = m
     )
  ) then
    raise exception 'Every team member must be a member of the project.'
      using errcode = '22023', hint = 'member_ids';
  end if;

  select string_agg(coalesce(pr.username, tm.user_id::text), ', ' order by pr.username)
    into v_taken
    from public.hackathon_team_members tm
    join public.hackathon_submissions s on s.id = tm.submission_id
    left join public.profiles pr on pr.id = tm.user_id
   where tm.hackathon_id = v_h.id
     and tm.user_id = any (v_members)
     and s.project_id <> p_project_id;

  if v_taken is not null then
    raise exception 'member_on_other_team'
      using errcode = 'QD409',
            detail = format('Already on another team in this hackathon: %s.', v_taken);
  end if;

  if cardinality(coalesce(p_image_paths, '{}'::text[])) not between 1 and 3
     or array_position(p_image_paths, null) is not null
     or (select count(distinct x) from unnest(p_image_paths) as x) <> cardinality(p_image_paths) then
    raise exception 'Attach 1 to 3 different mindmap images.'
      using errcode = '22023', hint = 'image_paths';
  end if;

  foreach v_path in array p_image_paths loop
    v_parts := public.hackathon_mindmap_path(v_path);
    if v_parts is null
       or v_parts[1]::uuid <> v_h.id
       or v_parts[2]::uuid <> p_project_id then
      raise exception 'Image % is not a mindmap upload for this hackathon and project.', v_path
        using errcode = '22023', hint = 'image_paths';
    end if;

    -- Uploaded, and by someone in the project. `owner` is the column every
    -- Storage version fills; `owner_id` is read where it exists.
    if not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'hackathon-mindmaps'
         and o.name = v_path
         and exists (
           select 1 from public.project_members pm
            where pm.project_id = p_project_id
              and pm.user_id::text = coalesce(o.owner::text, to_jsonb(o) ->> 'owner_id')
         )
    ) then
      raise exception 'Image % was not uploaded for this project.', v_path
        using errcode = '22023', hint = 'image_paths';
    end if;
  end loop;

  v_snapshot := public.build_hackathon_qdit_snapshot(p_project_id);
  v_size := pg_column_size(v_snapshot);
  if v_size > 2 * 1024 * 1024 then
    raise exception 'snapshot_too_large'
      using errcode = 'QD413',
            detail = format('The project snapshot is %s bytes after trimming; the limit is 2 MB.', v_size);
  end if;

  -- The entry row, locked by the upsert for the rest of this transaction, so
  -- two submits of one entry take turns and version numbers stay dense.
  insert into public.hackathon_submissions as s (hackathon_id, project_id, team_name, created_by)
  values (v_h.id, p_project_id, v_team_name, v_uid)
  on conflict on constraint hackathon_submissions_entry_key do update
    set team_name = excluded.team_name,
        updated_at = now()
  returning s.id into v_sub_id;

  delete from public.hackathon_team_members tm where tm.submission_id = v_sub_id;

  begin
    insert into public.hackathon_team_members (hackathon_id, submission_id, user_id)
    select v_h.id, v_sub_id, m from unnest(v_members) as m;
  exception when unique_violation then
    -- Another entry took a member after the check above.
    raise exception 'member_on_other_team'
      using errcode = 'QD409',
            detail = 'A team member was just added to another team in this hackathon.';
  end;

  select coalesce(max(v.version_no), 0) + 1 into v_version_no
    from public.hackathon_submission_versions v
   where v.submission_id = v_sub_id;

  select ds.id into v_doqtri_id
    from public.hackathon_doqtri_snapshots ds
   where ds.hackathon_id = v_h.id
     and ds.project_id = p_project_id
   order by ds.received_at desc, ds.id desc
   limit 1;

  insert into public.hackathon_submission_versions
    (submission_id, version_no, team_name, member_ids, qdit_snapshot,
     doqtri_snapshot_id, image_paths, submitted_by)
  values
    (v_sub_id, v_version_no, v_team_name,
     (select array_agg(m order by m) from unnest(v_members) as m),
     v_snapshot, v_doqtri_id, p_image_paths, v_uid)
  returning id into v_version_id;

  update public.hackathon_submissions s
     set current_version_id = v_version_id
   where s.id = v_sub_id;

  update public.hackathon_grading_jobs j
     set status = 'superseded',
         lease_until = null
    from public.hackathon_submission_versions v
   where v.id = j.version_id
     and v.submission_id = v_sub_id
     and v.id <> v_version_id
     and j.status in ('pending', 'running');

  insert into public.hackathon_grading_jobs (version_id, run_no)
  values (v_version_id, 1), (v_version_id, 2);

  return v_version_id;
end;
$$;

comment on function public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[]) is
  'SECURITY DEFINER, first-party sessions, project admin+. Submits or resubmits the project''s entry: window (late pass honoured), team size, members in the project and on no other team, 1-3 uploaded mindmap paths; freezes the qdit snapshot and the newest doqtri snapshot into a new version, supersedes the old version''s open jobs and queues runs 1 and 2. Returns the version id. Errors: header of 20261110100000_hackathons.sql.';


-- ----------------------------------------------------------------------------
-- 7. doqtri's push (OAuth, doqtri's client only, D-117)
-- ----------------------------------------------------------------------------

create or replace function public.push_doqtri_hackathon_snapshot(
  p_hackathon_slug text,
  p_project_id     uuid,
  p_snapshot_id    uuid,
  p_workspace_id   uuid,
  p_payload        jsonb,
  p_payload_sha256 text,
  p_note_count     integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_client   text := auth.jwt() ->> 'client_id';
  v_doqtri   uuid;
  v_existing public.hackathon_doqtri_snapshots;
  v_h        public.hackathons;
  v_row      public.hackathon_doqtri_snapshots;
  v_replay   boolean := false;
  v_current  uuid;
  v_has_sub  boolean;
begin
  -- (0) Only through an app, and only doqtri's (D-117, D-61). A revoked
  -- token is refused before anything else (D-75, D-96).
  if v_client is null then
    raise exception 'Hackathon snapshots are sent from doqtri, through its connection to qdit.'
      using errcode = '42501';
  end if;

  if public.oauth_token_revoked() then
    raise exception 'This app''s access to qdit was revoked.' using errcode = '42501';
  end if;

  select s.doqtri_oauth_client_id into v_doqtri from public.integration_settings s;

  -- Nested, not OR-ed: SQL does not promise to test the shape before the
  -- cast. (A non-UUID client_id is already "revoked" above, D-96.)
  if v_doqtri is null
     or v_client !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Only doqtri can send hackathon snapshots.' using errcode = '42501';
  end if;
  if v_client::uuid <> v_doqtri then
    raise exception 'Only doqtri can send hackathon snapshots.' using errcode = '42501';
  end if;

  -- (1) P0002 outside the project, 42501 below admin.
  perform public.assert_project_role(p_project_id, 'admin');

  -- (2) Arguments. The route validated the payload's shape.
  if p_snapshot_id is null then
    raise exception 'snapshot_id is required.' using errcode = '22023', hint = 'snapshot_id';
  end if;
  if p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'payload_sha256 must be 64 lowercase hex characters.'
      using errcode = '22023', hint = 'payload_sha256';
  end if;
  if p_note_count is null or p_note_count not between 0 and 200 then
    raise exception 'note_count must be 0 to 200.' using errcode = '22023', hint = 'note_count';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_workspace_id is null then
    raise exception 'payload must be a JSON object with a workspace.'
      using errcode = '22023', hint = 'payload';
  end if;

  -- (3) Replay or conflict, before the slug and the window, so a retry of a
  -- send that landed before the close still answers 200.
  select * into v_existing
    from public.hackathon_doqtri_snapshots ds
   where ds.project_id = p_project_id
     and ds.snapshot_id = p_snapshot_id;

  if found then
    if v_existing.payload_sha256 <> p_payload_sha256 then
      raise exception 'snapshot_conflict'
        using errcode = 'QD409',
              detail = 'This snapshot_id was already sent to this project with a different body.';
    end if;
    v_row := v_existing;
    v_replay := true;
  else
    -- (4) The hackathon.
    select * into v_h from public.hackathons h where h.slug = p_hackathon_slug;
    if not found then
      raise exception 'No such hackathon.' using errcode = 'P0002';
    end if;

    -- (5) At most 30 per entry. Pushes for one (hackathon, project) take
    -- turns from here, so the count cannot be raced past.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('hackathon_doqtri_snapshots:' || v_h.id || ':' || p_project_id, 0)
    );

    if (select count(*) from public.hackathon_doqtri_snapshots ds
         where ds.hackathon_id = v_h.id and ds.project_id = p_project_id) >= 30 then
      raise exception 'snapshot_limit'
        using errcode = 'QD409',
              detail = 'This project has sent 30 snapshots to this hackathon, the most it may.';
    end if;

    -- (6) The window, late pass honoured.
    perform public.assert_hackathon_open(v_h.id, p_project_id);

    -- (7) One statement: of two concurrent sends with one key exactly one
    -- inserts; the other waits for it here and then answers as a replay or
    -- a conflict.
    insert into public.hackathon_doqtri_snapshots as ds
      (snapshot_id, hackathon_id, project_id, workspace_id, pushed_by, client_id,
       payload, payload_sha256, note_count)
    values
      (p_snapshot_id, v_h.id, p_project_id, p_workspace_id, auth.uid(), v_client::uuid,
       p_payload, p_payload_sha256, p_note_count)
    on conflict on constraint hackathon_doqtri_snapshots_key do nothing
    returning * into v_row;

    if v_row.id is null then
      select * into v_row
        from public.hackathon_doqtri_snapshots ds
       where ds.project_id = p_project_id
         and ds.snapshot_id = p_snapshot_id;
      if v_row.payload_sha256 <> p_payload_sha256 then
        raise exception 'snapshot_conflict'
          using errcode = 'QD409',
                detail = 'This snapshot_id was already sent to this project with a different body.';
      end if;
      v_replay := true;
    end if;
  end if;

  select s.current_version_id, true
    into v_current, v_has_sub
    from public.hackathon_submissions s
   where s.hackathon_id = v_row.hackathon_id
     and s.project_id = v_row.project_id;

  return jsonb_build_object(
    'id', v_row.id,
    'note_count', v_row.note_count,
    'received_at', v_row.received_at,
    'replay', v_replay,
    'submission_state',
      case
        when v_has_sub is null then 'none'
        when exists (
          select 1 from public.hackathon_submission_versions v
           where v.id = v_current and v.doqtri_snapshot_id = v_row.id
        ) then 'current'
        else 'submitted_older'
      end
  );
end;
$$;

comment on function public.push_doqtri_hackathon_snapshot(text, uuid, uuid, uuid, jsonb, text, integer) is
  'SECURITY DEFINER, doqtri''s OAuth client only (D-117, D-61), project admin+. POST /api/v1/projects/{id}/hackathon-snapshots: stores the snapshot once per (project, snapshot_id). Order: client and revoke (42501) -> project role (P0002/42501) -> replay (same hash: replay=true) or QD409 snapshot_conflict -> P0002 unknown slug -> QD409 snapshot_limit (30) -> QD409 hackathon_not_open/hackathon_closed (late pass honoured). Returns {id, note_count, received_at, submission_state: none|submitted_older|current, replay}.';


-- ----------------------------------------------------------------------------
-- 8. Hackathon admin RPCs (first-party sessions, hackathon admins)
-- ----------------------------------------------------------------------------

-- The admin check every RPC below opens with: P0002 for an unknown
-- hackathon, 42501 for anyone not its admin. Internal.
create or replace function public.assert_hackathon_admin(p_hackathon_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_first_party_session();

  if not exists (select 1 from public.hackathons h where h.id = p_hackathon_id) then
    raise exception 'No such hackathon.' using errcode = 'P0002';
  end if;

  if not public.is_hackathon_staff(p_hackathon_id, 'admin') then
    raise exception 'Only this hackathon''s admins can do that.' using errcode = '42501';
  end if;
end;
$$;


create or replace function public.hackathon_grading_status(p_hackathon_id uuid)
returns table (
  submission_id        uuid,
  project_id           uuid,
  project_slug         text,
  team_name            text,
  version_id           uuid,
  version_no           integer,
  submitted_at         timestamptz,
  jobs                 jsonb,
  eligibility          jsonb,
  eligibility_override boolean,
  override_reason      text,
  late_pass_until      timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_hackathon_admin(p_hackathon_id);

  -- Job state and eligibility only. Nothing from hackathon_ai_runs (D-116).
  return query
    select s.id, s.project_id, p.slug, s.team_name, v.id, v.version_no, v.submitted_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'run_no', j.run_no,
                      'status', j.status,
                      'attempts', j.attempts,
                      'free_attempts', j.free_attempts,
                      'next_attempt_at', j.next_attempt_at,
                      'last_error', j.last_error,
                      'updated_at', j.updated_at
                    ) order by j.run_no)
               from public.hackathon_grading_jobs j
              where j.version_id = v.id
                and j.status <> 'superseded'
           ), '[]'::jsonb),
           v.eligibility, s.eligibility_override, s.override_reason, lp.until
      from public.hackathon_submissions s
      join public.projects p on p.id = s.project_id
      left join public.hackathon_submission_versions v on v.id = s.current_version_id
      left join public.hackathon_late_passes lp
        on lp.hackathon_id = s.hackathon_id and lp.project_id = s.project_id
     where s.hackathon_id = p_hackathon_id
     order by v.submitted_at, s.id;
end;
$$;

comment on function public.hackathon_grading_status(uuid) is
  'SECURITY DEFINER, first-party, hackathon admin. Per entry: project slug, team, current version, submitted_at, non-superseded job states, eligibility and override. Never scores, totals or flags (D-116).';


create or replace function public.hackathon_leaderboard(p_hackathon_id uuid)
returns table (
  submission_id        uuid,
  project_id           uuid,
  project_slug         text,
  team_name            text,
  version_id           uuid,
  version_no           integer,
  submitted_at         timestamptz,
  eligibility          jsonb,
  eligibility_override boolean,
  override_reason      text,
  eligible             boolean,
  run_count            integer,
  runs                 jsonb,
  ai_mean              numeric,
  ai_criteria          jsonb,
  ai_total             numeric,
  finalist             boolean,
  ai_rank              integer,
  pitch_order          integer,
  judge_mean           numeric,
  judge_count          integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- First-party, then admin, then released, before anything is joined.
  perform public.assert_hackathon_admin(p_hackathon_id);

  if not exists (
    select 1 from public.hackathons h
     where h.id = p_hackathon_id and h.released_at is not null
  ) then
    raise exception 'grades_not_released'
      using errcode = 'QD409', detail = 'Grades are sealed until an admin releases them.';
  end if;

  return query
    select s.id, s.project_id, p.slug, s.team_name, v.id, v.version_no, v.submitted_at,
           v.eligibility, s.eligibility_override, s.override_reason,
           public.hackathon_entry_eligible(s.eligibility_override, v.eligibility),
           a.run_count, a.runs, a.ai_mean, a.per_criterion, a.ai_total,
           f.submission_id is not null, f.ai_rank, f.pitch_order,
           js.judge_mean, coalesce(js.judge_count, 0)
      from public.hackathon_submissions s
      join public.projects p on p.id = s.project_id
      left join public.hackathon_submission_versions v on v.id = s.current_version_id
      left join public.hackathon_current_ai(p_hackathon_id) a on a.submission_id = s.id
      left join public.hackathon_finalists f
        on f.hackathon_id = s.hackathon_id and f.submission_id = s.id
      left join lateral (
        select round(avg(js0.clarity + js0.structure + js0.accuracy + js0.connections + js0.pitch), 2) as judge_mean,
               count(*)::integer as judge_count
          from public.hackathon_judge_scores js0
         where js0.submission_id = s.id
      ) js on true
     where s.hackathon_id = p_hackathon_id
     order by f.ai_rank nulls last, a.ai_total desc nulls last, v.submitted_at, s.id;
end;
$$;

comment on function public.hackathon_leaderboard(uuid) is
  'SECURITY DEFINER, first-party, hackathon admin, after release only (QD409 grades_not_released). Per entry: eligibility, the counted AI runs (total, criteria, flags, summary), the mean of their totals, the combined per-criterion values and total (rubric.ts combineRuns), finalist rank and pitch order, judges'' mean /25 and count.';


create or replace function public.release_hackathon_grades(
  p_hackathon_id     uuid,
  p_allow_incomplete boolean default false
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_h       public.hackathons;
  v_pending integer;
  v_running integer;
  v_count   integer;
begin
  perform public.assert_hackathon_admin(p_hackathon_id);

  -- Locked: two presses release once.
  select * into v_h from public.hackathons h where h.id = p_hackathon_id for update;

  if v_h.released_at is not null then
    raise exception 'already_released'
      using errcode = 'QD409', detail = 'Grades for this hackathon were already released.';
  end if;

  if now() < v_h.closes_at then
    raise exception 'hackathon_not_closed'
      using errcode = 'QD409', detail = 'Grades can be released only after the hackathon closes.';
  end if;

  if exists (
    select 1 from public.hackathon_late_passes lp
     where lp.hackathon_id = v_h.id and lp.until >= now()
  ) then
    raise exception 'late_pass_active'
      using errcode = 'QD409',
            detail = 'A late pass is still in force; wait for it to end or shorten it first.';
  end if;

  select count(*) filter (where j.status = 'pending'),
         count(*) filter (where j.status = 'running')
    into v_pending, v_running
    from public.hackathon_submissions s
    join public.hackathon_grading_jobs j on j.version_id = s.current_version_id
   where s.hackathon_id = v_h.id;

  if (v_pending + v_running) > 0 and not coalesce(p_allow_incomplete, false) then
    raise exception 'grading_incomplete'
      using errcode = 'QD409',
            detail = format('%s grading runs pending and %s running.', v_pending, v_running);
  end if;

  update public.hackathons h
     set released_at = now(),
         released_by = auth.uid()
   where h.id = v_h.id;

  insert into public.hackathon_finalists (hackathon_id, submission_id, ai_rank)
  select v_h.id, ranked.submission_id, ranked.ai_rank
    from (
      select s.id as submission_id,
             row_number() over (order by a.ai_total desc, v.submitted_at, s.id)::integer as ai_rank
        from public.hackathon_submissions s
        join public.hackathon_submission_versions v on v.id = s.current_version_id
        join public.hackathon_current_ai(v_h.id) a on a.submission_id = s.id
       where s.hackathon_id = v_h.id
         and a.ai_total is not null
         and public.hackathon_entry_eligible(s.eligibility_override, v.eligibility)
    ) ranked
   where ranked.ai_rank <= v_h.finalist_count;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.release_hackathon_grades(uuid, boolean) is
  'SECURITY DEFINER, first-party, hackathon admin. Irreversible (D-116): after closes_at, with no late pass in force and (unless p_allow_incomplete) no pending or running current-version job, sets released_at and writes the top finalist_count eligible entries by AI total (tie: earlier submitted_at) as finalists. Returns the finalist count.';


create or replace function public.grant_late_pass(
  p_hackathon_id uuid,
  p_project_id   uuid,
  p_until        timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.assert_hackathon_admin(p_hackathon_id);

  if exists (select 1 from public.hackathons h where h.id = p_hackathon_id and h.released_at is not null) then
    raise exception 'already_released'
      using errcode = 'QD409', detail = 'Grades are released; no late pass applies any more.';
  end if;

  if p_until is null then
    raise exception 'until is required; a time in the past ends a pass.'
      using errcode = '22023', hint = 'until';
  end if;

  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'No such project.' using errcode = 'P0002';
  end if;

  insert into public.hackathon_late_passes as lp (hackathon_id, project_id, until, granted_by)
  values (p_hackathon_id, p_project_id, p_until, auth.uid())
  on conflict (hackathon_id, project_id) do update
    set until = excluded.until,
        granted_by = excluded.granted_by;
end;
$$;

comment on function public.grant_late_pass(uuid, uuid, timestamptz) is
  'SECURITY DEFINER, first-party, hackathon admin, before release. Sets the project''s late pass to p_until (a past time ends it).';


create or replace function public.set_eligibility_override(
  p_submission_id uuid,
  p_value         boolean,
  p_reason        text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hackathon uuid;
  v_version   uuid;
  v_next      integer;
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.assert_first_party_session();

  -- Locked: two overrides of one entry queue runs once.
  select s.hackathon_id, s.current_version_id into v_hackathon, v_version
    from public.hackathon_submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'No such submission.' using errcode = 'P0002';
  end if;

  perform public.assert_hackathon_admin(v_hackathon);

  if p_value is not null and (v_reason is null or char_length(v_reason) > 500) then
    raise exception 'Say why, in 1 to 500 characters.' using errcode = '22023', hint = 'reason';
  end if;

  update public.hackathon_submissions s
     set eligibility_override = p_value,
         override_reason = case when p_value is null then null else v_reason end,
         overridden_by = case when p_value is null then null else auth.uid() end
   where s.id = p_submission_id;

  -- Let in: a version the grader skipped as ineligible (every live job done,
  -- no AI run) gets runs 1 and 2 again, under the next two run numbers.
  -- Nothing after release, and nothing for false or null.
  if p_value is true
     and v_version is not null
     and not exists (select 1 from public.hackathons h where h.id = v_hackathon and h.released_at is not null)
     and exists (select 1 from public.hackathon_grading_jobs j
                  where j.version_id = v_version and j.status <> 'superseded')
     and not exists (select 1 from public.hackathon_grading_jobs j
                      where j.version_id = v_version and j.status not in ('done', 'superseded'))
     and not exists (select 1 from public.hackathon_ai_runs r where r.version_id = v_version) then
    select coalesce(max(j.run_no), 0) + 1 into v_next
      from public.hackathon_grading_jobs j where j.version_id = v_version;

    if v_next + 1 > 9 then
      raise exception 'regrade_limit'
        using errcode = 'QD409', detail = 'This version has been regraded as often as it can be.';
    end if;

    update public.hackathon_grading_jobs j
       set status = 'superseded'
     where j.version_id = v_version and j.status = 'done';

    insert into public.hackathon_grading_jobs (version_id, run_no)
    values (v_version, v_next), (v_version, v_next + 1);
  end if;
end;
$$;

comment on function public.set_eligibility_override(uuid, boolean, text) is
  'SECURITY DEFINER, first-party, hackathon admin. true/false overrides the computed eligibility (reason required, 1-500 chars); null clears the override. true on a version the grader skipped (every live job done, no AI run), before release, queues two fresh runs; false and null leave the jobs alone.';


create or replace function public.set_hackathon_staff(
  p_hackathon_id uuid,
  p_username     text,
  p_role         public.hackathon_role
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user    uuid;
  v_current public.hackathon_role;
  v_admins  integer;
begin
  perform public.assert_hackathon_admin(p_hackathon_id);

  select pr.id into v_user
    from public.profiles pr
   where pr.username = lower(btrim(coalesce(p_username, '')));
  if not found then
    raise exception 'No account uses that username.' using errcode = 'P0002';
  end if;

  -- Every staff row of this hackathon, locked, so two admins demoting each
  -- other cannot both pass the last-admin check.
  perform 1 from public.hackathon_staff s where s.hackathon_id = p_hackathon_id for update;

  select s.role into v_current
    from public.hackathon_staff s
   where s.hackathon_id = p_hackathon_id and s.user_id = v_user;

  if v_current = 'admin' and p_role is distinct from 'admin' then
    select count(*) into v_admins
      from public.hackathon_staff s
     where s.hackathon_id = p_hackathon_id and s.role = 'admin';
    if v_admins <= 1 then
      raise exception 'last_admin'
        using errcode = 'QD409', detail = 'A hackathon keeps at least one admin.';
    end if;
  end if;

  if p_role is null then
    delete from public.hackathon_staff s
     where s.hackathon_id = p_hackathon_id and s.user_id = v_user;
  else
    insert into public.hackathon_staff as s (hackathon_id, user_id, role, added_by)
    values (p_hackathon_id, v_user, p_role, auth.uid())
    on conflict (hackathon_id, user_id) do update
      set role = excluded.role;
  end if;

  return v_user;
end;
$$;

comment on function public.set_hackathon_staff(uuid, text, public.hackathon_role) is
  'SECURITY DEFINER, first-party, hackathon admin. Adds, changes (p_role) or removes (p_role null) the staff member with that username; QD409 last_admin when that would leave no admin. Returns their user id.';


create or replace function public.hackathon_staff_list(p_hackathon_id uuid)
returns table (
  user_id      uuid,
  username     text,
  display_name text,
  role         public.hackathon_role,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_hackathon_admin(p_hackathon_id);

  return query
    select s.user_id, pr.username, pr.display_name, s.role, s.created_at
      from public.hackathon_staff s
      left join public.profiles pr on pr.id = s.user_id
     where s.hackathon_id = p_hackathon_id
     order by s.role, pr.username, s.user_id;
end;
$$;

comment on function public.hackathon_staff_list(uuid) is
  'SECURITY DEFINER, first-party, hackathon admin. The staff with username and display name, which profiles RLS would not show across projects.';


create or replace function public.set_pitch_order(
  p_hackathon_id   uuid,
  p_submission_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.assert_hackathon_admin(p_hackathon_id);

  if not exists (select 1 from public.hackathons h where h.id = p_hackathon_id and h.released_at is not null) then
    raise exception 'grades_not_released'
      using errcode = 'QD409', detail = 'Finalists exist only once grades are released.';
  end if;

  -- Exactly the finalists, each once.
  if p_submission_ids is null
     or array_position(p_submission_ids, null) is not null
     or cardinality(p_submission_ids) <> (select count(distinct x) from unnest(p_submission_ids) as x)
     or (select array_agg(x order by x) from unnest(p_submission_ids) as x)
        is distinct from
        (select array_agg(f.submission_id order by f.submission_id)
           from public.hackathon_finalists f where f.hackathon_id = p_hackathon_id) then
    raise exception 'List every finalist exactly once.' using errcode = '22023', hint = 'submission_ids';
  end if;

  update public.hackathon_finalists f
     set pitch_order = null
   where f.hackathon_id = p_hackathon_id;

  update public.hackathon_finalists f
     set pitch_order = o.ord::integer
    from unnest(p_submission_ids) with ordinality as o (submission_id, ord)
   where f.hackathon_id = p_hackathon_id
     and f.submission_id = o.submission_id;
end;
$$;

comment on function public.set_pitch_order(uuid, uuid[]) is
  'SECURITY DEFINER, first-party, hackathon admin, after release. Sets pitch_order 1..n from a permutation of the finalists.';


create or replace function public.regrade_submission(p_submission_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sub  public.hackathon_submissions;
  v_next integer;
begin
  perform public.assert_first_party_session();

  select * into v_sub from public.hackathon_submissions s where s.id = p_submission_id for update;
  if not found or v_sub.current_version_id is null then
    raise exception 'No such submission.' using errcode = 'P0002';
  end if;

  perform public.assert_hackathon_admin(v_sub.hackathon_id);

  if exists (select 1 from public.hackathons h where h.id = v_sub.hackathon_id and h.released_at is not null) then
    raise exception 'already_released'
      using errcode = 'QD409', detail = 'Grades are released; finalists are fixed.';
  end if;

  select coalesce(max(j.run_no), 0) + 1 into v_next
    from public.hackathon_grading_jobs j
   where j.version_id = v_sub.current_version_id;

  if v_next + 1 > 9 then
    raise exception 'regrade_limit'
      using errcode = 'QD409', detail = 'This version has been regraded as often as it can be.';
  end if;

  update public.hackathon_grading_jobs j
     set status = 'superseded',
         lease_until = null
   where j.version_id = v_sub.current_version_id
     and j.status <> 'superseded';

  insert into public.hackathon_grading_jobs (version_id, run_no)
  values (v_sub.current_version_id, v_next), (v_sub.current_version_id, v_next + 1);

  return v_next;
end;
$$;

comment on function public.regrade_submission(uuid) is
  'SECURITY DEFINER, first-party, hackathon admin, before release. Supersedes every job of the current version (done ones included, so their runs no longer count) and queues two new runs with the next run numbers; QD409 regrade_limit past run 9. Returns the first new run_no.';


-- ----------------------------------------------------------------------------
-- 9. Judges (first-party, judge+, after release, finalists only)
-- ----------------------------------------------------------------------------

create or replace function public.upsert_judge_score(
  p_submission_id uuid,
  p_clarity       integer,
  p_structure     integer,
  p_accuracy      integer,
  p_connections   integer,
  p_pitch         integer,
  p_note          text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hackathon uuid;
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform public.assert_first_party_session();

  select s.hackathon_id into v_hackathon
    from public.hackathon_submissions s where s.id = p_submission_id;

  if not found or not public.is_hackathon_staff(v_hackathon, 'judge') then
    raise exception 'Only this hackathon''s judges can score its finalists.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.hackathons h where h.id = v_hackathon and h.released_at is not null) then
    raise exception 'grades_not_released'
      using errcode = 'QD409', detail = 'Judging opens when grades are released.';
  end if;

  if not exists (
    select 1 from public.hackathon_finalists f
     where f.hackathon_id = v_hackathon and f.submission_id = p_submission_id
  ) then
    raise exception 'not_finalist'
      using errcode = 'QD409', detail = 'Only finalists are judged.';
  end if;

  if p_clarity is null or p_structure is null or p_accuracy is null
     or p_connections is null or p_pitch is null
     or least(p_clarity, p_structure, p_accuracy, p_connections, p_pitch) < 1
     or greatest(p_clarity, p_structure, p_accuracy, p_connections, p_pitch) > 5 then
    raise exception 'Each score is a whole number from 1 to 5.' using errcode = '22023', hint = 'scores';
  end if;

  if char_length(v_note) > 2000 then
    raise exception 'A note is at most 2,000 characters.' using errcode = '22023', hint = 'note';
  end if;

  insert into public.hackathon_judge_scores as js
    (hackathon_id, submission_id, judge_id, clarity, structure, accuracy, connections, pitch, note)
  values
    (v_hackathon, p_submission_id, auth.uid(), p_clarity, p_structure, p_accuracy,
     p_connections, p_pitch, v_note)
  on conflict on constraint hackathon_judge_scores_key do update
    set clarity = excluded.clarity,
        structure = excluded.structure,
        accuracy = excluded.accuracy,
        connections = excluded.connections,
        pitch = excluded.pitch,
        note = excluded.note;
end;
$$;

comment on function public.upsert_judge_score(uuid, integer, integer, integer, integer, integer, text) is
  'SECURITY DEFINER, first-party, hackathon judge+ (admins included), after release, finalists only. Writes the caller''s own 5 x 1-5 scores and note for one finalist.';


-- ----------------------------------------------------------------------------
-- 10. Service-role RPCs: the grader and the snapshot route
-- ----------------------------------------------------------------------------

create or replace function public.record_doqtri_chain_check(
  p_snapshot_id uuid,
  p_chain_check jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_chain_check is null or jsonb_typeof(p_chain_check) not in ('object', 'array') then
    raise exception 'chain_check must be a JSON object or array.' using errcode = '22023', hint = 'chain_check';
  end if;

  update public.hackathon_doqtri_snapshots ds
     set chain_check = p_chain_check
   where ds.id = p_snapshot_id;

  if not found then
    raise exception 'No such snapshot.' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.record_doqtri_chain_check(uuid, jsonb) is
  'SECURITY DEFINER, service_role only. Stores the route''s per-note registry check on a doqtri snapshot (qdit id).';


create or replace function public.claim_grading_jobs(
  p_limit         integer default 5,
  p_lease_seconds integer default 200,
  p_version_id    uuid default null
)
returns table (
  job_id          uuid,
  version_id      uuid,
  run_no          smallint,
  attempts        integer,
  lease_until     timestamptz,
  submission_id   uuid,
  hackathon_id    uuid,
  project_id      uuid,
  team_name       text,
  member_ids      uuid[],
  image_paths     text[],
  submitted_at    timestamptz,
  qdit_snapshot   jsonb,
  doqtri_snapshot jsonb,
  opens_at        timestamptz,
  closes_at       timestamptz,
  team_min        integer,
  team_max        integer,
  -- So the grader can skip a stale version and an entry already decided.
  current_version_id   uuid,
  eligibility_override boolean,
  eligibility          jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_lease   interval := make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 200), 900)));
  v_running integer;
  v_limit   integer;
begin
  -- Claimers take turns, so the cap of 20 running holds across concurrent
  -- workers; the row locks below still skip a job another statement holds.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hackathon_grading_jobs:claim', 0));

  -- A lease that ran out: back to the queue, or failed after the third try.
  update public.hackathon_grading_jobs j
     set status = case when j.attempts - j.free_attempts >= 3 then 'failed' else 'pending' end,
         lease_until = null,
         next_attempt_at = now(),
         last_error = left(coalesce(j.last_error || '; ', '') || 'lease expired', 2000)
   where j.status = 'running'
     and j.lease_until < now();

  select count(*) into v_running
    from public.hackathon_grading_jobs j
   where j.status = 'running';

  v_limit := least(greatest(1, coalesce(p_limit, 5)), 20, 20 - v_running);
  if v_limit <= 0 then
    return;
  end if;

  return query
  with due as (
    select d.id
      from public.hackathon_grading_jobs d
     where d.status = 'pending'
       and d.next_attempt_at <= now()
       and d.attempts - d.free_attempts < 3
       and (p_version_id is null or d.version_id = p_version_id)
     order by d.next_attempt_at, d.created_at, d.id
     limit v_limit
     for update of d skip locked
  ),
  claimed as (
    update public.hackathon_grading_jobs j
       set status = 'running',
           attempts = j.attempts + 1,
           lease_until = now() + v_lease
      from due
     where j.id = due.id
    returning j.id, j.version_id, j.run_no, j.attempts, j.lease_until
  )
  select c.id, c.version_id, c.run_no, c.attempts, c.lease_until,
         s.id, s.hackathon_id, s.project_id, v.team_name, v.member_ids, v.image_paths,
         v.submitted_at, v.qdit_snapshot, ds.payload,
         h.opens_at, h.closes_at, h.team_min, h.team_max,
         s.current_version_id, s.eligibility_override, v.eligibility
    from claimed c
    join public.hackathon_submission_versions v on v.id = c.version_id
    join public.hackathon_submissions s on s.id = v.submission_id
    join public.hackathons h on h.id = s.hackathon_id
    left join public.hackathon_doqtri_snapshots ds on ds.id = v.doqtri_snapshot_id
   order by c.lease_until, c.id;
end;
$$;

comment on function public.claim_grading_jobs(integer, integer, uuid) is
  'SECURITY DEFINER, service_role only. Expires lapsed leases (failed after 3 attempts), then leases up to p_limit due pending jobs (optionally of one version) with skip locked, never more than 20 running in total. Returns each with the frozen version, its doqtri payload, the hackathon window, the entry''s current_version_id and eligibility_override, and the version''s stored eligibility.';


create or replace function public.complete_grading_job(
  p_job_id      uuid,
  p_attempt     integer,
  p_model       text,
  p_criteria    jsonb,
  p_total       numeric,
  p_flags       text[],
  p_summary     text,
  p_stop_reason text,
  p_usage       jsonb,
  p_truncated   boolean
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.hackathon_grading_jobs;
begin
  select * into v_job from public.hackathon_grading_jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'No such job.' using errcode = 'P0002';
  end if;

  -- Superseded, failed, settled, or leased again since this claim: nothing
  -- to record.
  if v_job.status <> 'running' or v_job.attempts is distinct from p_attempt then
    return 'stale';
  end if;

  if p_criteria is null or jsonb_typeof(p_criteria) <> 'object' then
    raise exception 'criteria must be a JSON object.' using errcode = '22023', hint = 'criteria';
  end if;
  if p_total is null or p_total not between 0 and 100 then
    raise exception 'total must be 0 to 100.' using errcode = '22023', hint = 'total';
  end if;

  insert into public.hackathon_ai_runs
    (version_id, run_no, model, criteria, total, flags, summary, stop_reason, usage, truncated)
  values
    (v_job.version_id, v_job.run_no, p_model, p_criteria, round(p_total, 2),
     coalesce(p_flags, '{}'), p_summary, p_stop_reason, p_usage, coalesce(p_truncated, false))
  on conflict on constraint hackathon_ai_runs_run_key do nothing;

  update public.hackathon_grading_jobs j
     set status = 'done',
         lease_until = null,
         last_error = null
   where j.id = p_job_id;

  return 'done';
end;
$$;

comment on function public.complete_grading_job(uuid, integer, text, jsonb, numeric, text[], text, text, jsonb, boolean) is
  'SECURITY DEFINER, service_role only. Records one AI run for a job still running under claim p_attempt and marks it done; returns done, or stale otherwise (nothing recorded).';


create or replace function public.fail_grading_job(
  p_job_id              uuid,
  p_attempt             integer,
  p_error               text,
  p_retry_after_seconds integer default 60,
  p_permanent           boolean default false,
  p_count_attempt       boolean default true
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job    public.hackathon_grading_jobs;
  v_status text;
begin
  select * into v_job from public.hackathon_grading_jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'No such job.' using errcode = 'P0002';
  end if;

  if v_job.status <> 'running' or v_job.attempts is distinct from p_attempt then
    return 'stale';
  end if;

  -- An uncounted attempt (overload, budget abort) is given back, while fewer
  -- than 20 have been; a permanent failure ignores it.
  if not coalesce(p_count_attempt, true)
     and not coalesce(p_permanent, false)
     and v_job.free_attempts < 20 then
    update public.hackathon_grading_jobs j
       set status = 'pending',
           free_attempts = j.free_attempts + 1,
           lease_until = null,
           next_attempt_at = now() + make_interval(secs => greatest(0, least(coalesce(p_retry_after_seconds, 60), 3600))),
           last_error = left(coalesce(p_error, 'unknown error'), 2000)
     where j.id = p_job_id;
    return 'pending';
  end if;

  update public.hackathon_grading_jobs j
     set status = case
                    when j.attempts - j.free_attempts < 3 and not coalesce(p_permanent, false) then 'pending'
                    else 'failed'
                  end,
         lease_until = null,
         next_attempt_at = now() + make_interval(secs => greatest(0, least(coalesce(p_retry_after_seconds, 60), 3600))),
         last_error = left(coalesce(p_error, 'unknown error'), 2000)
   where j.id = p_job_id
  returning j.status into v_status;

  return v_status;
end;
$$;

comment on function public.fail_grading_job(uuid, integer, text, integer, boolean, boolean) is
  'SECURITY DEFINER, service_role only. The claim p_attempt of a running job failed: back to pending after p_retry_after_seconds while counted attempts (attempts - free_attempts) < 3, else failed; p_permanent (refusal, invalid output) fails it at once; p_count_attempt false (overload, budget abort) returns it to pending without counting the attempt (free_attempts + 1, at most 20). Returns pending, failed or stale (not running under that claim).';


create or replace function public.skip_grading_job(
  p_job_id  uuid,
  p_attempt integer,
  p_reason  text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.hackathon_grading_jobs;
begin
  select * into v_job from public.hackathon_grading_jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'No such job.' using errcode = 'P0002';
  end if;

  if v_job.status <> 'running' or v_job.attempts is distinct from p_attempt then
    return 'stale';
  end if;

  -- Done with no hackathon_ai_runs row: nothing counts towards a grade.
  update public.hackathon_grading_jobs j
     set status = 'done',
         lease_until = null,
         last_error = left(coalesce(nullif(btrim(p_reason), ''), 'skipped'), 2000)
   where j.id = p_job_id;

  return 'done';
end;
$$;

comment on function public.skip_grading_job(uuid, integer, text) is
  'SECURITY DEFINER, service_role only. Settles a job running under claim p_attempt as done without an AI run (an ineligible entry is not scored); p_reason goes in last_error. Returns done, or stale otherwise. set_eligibility_override(true) queues fresh runs for such a version.';


create or replace function public.hackathon_version_progress(p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.hackathon_submission_versions v where v.id = p_version_id) then
    raise exception 'No such version.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'version_id', p_version_id,
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object('id', j.id, 'run_no', j.run_no, 'status', j.status) order by j.run_no)
        from public.hackathon_grading_jobs j
       where j.version_id = p_version_id
         and j.status <> 'superseded'
    ), '[]'::jsonb),
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'run_no', r.run_no,
               'criteria', r.criteria,
               'total', r.total,
               'flags', to_jsonb(r.flags),
               'model', r.model
             ) order by r.run_no)
        from public.hackathon_ai_runs r
        join public.hackathon_grading_jobs j
          on j.version_id = r.version_id and j.run_no = r.run_no and j.status = 'done'
       where r.version_id = p_version_id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.hackathon_version_progress(uuid) is
  'SECURITY DEFINER, service_role only. {version_id, jobs: [{id, run_no, status}] (not superseded), runs: [{run_no, criteria, total, flags, model}] (job done)}: what the grader needs to decide on a third run.';


create or replace function public.enqueue_third_run(p_version_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_active integer;
  v_next   integer;
  v_id     uuid;
begin
  if not exists (
    select 1 from public.hackathon_submissions s where s.current_version_id = p_version_id
  ) then
    return null;
  end if;

  select count(*) filter (where j.status <> 'superseded'), coalesce(max(j.run_no), 0) + 1
    into v_active, v_next
    from public.hackathon_grading_jobs j
   where j.version_id = p_version_id;

  if v_active >= 3 or v_next > 9 then
    return null;
  end if;

  begin
    insert into public.hackathon_grading_jobs (version_id, run_no)
    values (p_version_id, v_next)
    returning id into v_id;
  exception when unique_violation then
    -- A concurrent call queued it.
    return null;
  end;

  return v_id;
end;
$$;

comment on function public.enqueue_third_run(uuid) is
  'SECURITY DEFINER, service_role only. Queues the tie-break run for the current version p_version_id when it has fewer than three counted jobs; returns the new job id, or null when not needed or not current.';


create or replace function public.set_version_eligibility(
  p_version_id  uuid,
  p_eligibility jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_eligibility is null
     or jsonb_typeof(p_eligibility) <> 'object'
     or jsonb_typeof(p_eligibility -> 'eligible') is distinct from 'boolean' then
    raise exception 'eligibility must be an object with a boolean eligible.'
      using errcode = '22023', hint = 'eligibility';
  end if;

  update public.hackathon_submission_versions v
     set eligibility = p_eligibility
   where v.id = p_version_id;

  if not found then
    raise exception 'No such version.' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.set_version_eligibility(uuid, jsonb) is
  'SECURITY DEFINER, service_role only. Stores the eligibility gate result ({eligible: boolean, rules}) on a version.';


create or replace function public.prune_hackathon_doqtri_snapshots()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.hackathon_doqtri_snapshots ds
   where ds.id in (
     select d.id
       from public.hackathon_doqtri_snapshots d
       join public.hackathons h on h.id = d.hackathon_id
      where h.closes_at < now() - interval '90 days'
      limit 5000
   );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.prune_hackathon_doqtri_snapshots() is
  'Run daily by pg_cron (qdit-prune-hackathon-snapshots): deletes doqtri snapshots of hackathons that closed over 90 days ago, 5,000 per run. Versions keep a null reference. Returns the count.';


-- ----------------------------------------------------------------------------
-- 11. Grants
--
-- Supabase gives new functions to anon, authenticated and service_role by
-- default; every function here says who it is for.
-- ----------------------------------------------------------------------------

-- Pure helpers, harmless anywhere a policy needs them.
revoke all on function public.hackathon_role_rank(public.hackathon_role) from public, anon;
revoke all on function public.hackathon_entry_eligible(boolean, jsonb)   from public, anon;
revoke all on function public.hackathon_clip_text(text)                  from public, anon;
revoke all on function public.hackathon_mindmap_path(text)               from public, anon;
grant execute on function public.hackathon_role_rank(public.hackathon_role) to authenticated, service_role;
grant execute on function public.hackathon_entry_eligible(boolean, jsonb)   to authenticated, service_role;
grant execute on function public.hackathon_clip_text(text)                  to authenticated, service_role;
grant execute on function public.hackathon_mindmap_path(text)               to authenticated, service_role;

-- Called from policies as the signed-in user.
revoke all on function public.is_hackathon_staff(uuid, text)             from public, anon;
revoke all on function public.hackathon_mindmap_upload_allowed(text)     from public, anon;
revoke all on function public.hackathon_mindmap_read_allowed(text)       from public, anon;
grant execute on function public.is_hackathon_staff(uuid, text)          to authenticated, service_role;
grant execute on function public.hackathon_mindmap_upload_allowed(text)  to authenticated, service_role;
grant execute on function public.hackathon_mindmap_read_allowed(text)    to authenticated, service_role;

-- Internal: only the functions above call them, as their owner.
revoke all on function public.hackathon_window_state(uuid, uuid)        from public, anon, authenticated, service_role;
revoke all on function public.assert_hackathon_open(uuid, uuid)         from public, anon, authenticated, service_role;
revoke all on function public.assert_hackathon_admin(uuid)              from public, anon, authenticated, service_role;
revoke all on function public.hackathon_current_ai(uuid)                from public, anon, authenticated, service_role;
revoke all on function public.build_hackathon_qdit_snapshot(uuid)       from public, anon, authenticated, service_role;

-- Signed-in users (each checks session kind and role itself).
revoke all on function public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[]) from public, anon;
revoke all on function public.push_doqtri_hackathon_snapshot(text, uuid, uuid, uuid, jsonb, text, integer) from public, anon;
revoke all on function public.hackathon_grading_status(uuid)                 from public, anon;
revoke all on function public.hackathon_leaderboard(uuid)                    from public, anon;
revoke all on function public.release_hackathon_grades(uuid, boolean)        from public, anon;
revoke all on function public.grant_late_pass(uuid, uuid, timestamptz)       from public, anon;
revoke all on function public.set_eligibility_override(uuid, boolean, text)  from public, anon;
revoke all on function public.set_hackathon_staff(uuid, text, public.hackathon_role) from public, anon;
revoke all on function public.hackathon_staff_list(uuid)                     from public, anon;
revoke all on function public.set_pitch_order(uuid, uuid[])                  from public, anon;
revoke all on function public.regrade_submission(uuid)                       from public, anon;
revoke all on function public.upsert_judge_score(uuid, integer, integer, integer, integer, integer, text) from public, anon;

grant execute on function public.submit_hackathon_entry(uuid, uuid, text, uuid[], text[]) to authenticated;
grant execute on function public.push_doqtri_hackathon_snapshot(text, uuid, uuid, uuid, jsonb, text, integer) to authenticated;
grant execute on function public.hackathon_grading_status(uuid)                 to authenticated;
grant execute on function public.hackathon_leaderboard(uuid)                    to authenticated;
grant execute on function public.release_hackathon_grades(uuid, boolean)        to authenticated;
grant execute on function public.grant_late_pass(uuid, uuid, timestamptz)       to authenticated;
grant execute on function public.set_eligibility_override(uuid, boolean, text)  to authenticated;
grant execute on function public.set_hackathon_staff(uuid, text, public.hackathon_role) to authenticated;
grant execute on function public.hackathon_staff_list(uuid)                     to authenticated;
grant execute on function public.set_pitch_order(uuid, uuid[])                  to authenticated;
grant execute on function public.regrade_submission(uuid)                       to authenticated;
grant execute on function public.upsert_judge_score(uuid, integer, integer, integer, integer, integer, text) to authenticated;

-- The grader and the snapshot route, with the service role.
revoke all on function public.record_doqtri_chain_check(uuid, jsonb)         from public, anon, authenticated;
revoke all on function public.claim_grading_jobs(integer, integer, uuid)     from public, anon, authenticated;
revoke all on function public.complete_grading_job(uuid, integer, text, jsonb, numeric, text[], text, text, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function public.fail_grading_job(uuid, integer, text, integer, boolean, boolean) from public, anon, authenticated;
revoke all on function public.skip_grading_job(uuid, integer, text)          from public, anon, authenticated;
revoke all on function public.hackathon_version_progress(uuid)               from public, anon, authenticated;
revoke all on function public.enqueue_third_run(uuid)                        from public, anon, authenticated;
revoke all on function public.set_version_eligibility(uuid, jsonb)           from public, anon, authenticated;
revoke all on function public.prune_hackathon_doqtri_snapshots()             from public, anon, authenticated;

grant execute on function public.record_doqtri_chain_check(uuid, jsonb)      to service_role;
grant execute on function public.claim_grading_jobs(integer, integer, uuid)  to service_role;
grant execute on function public.complete_grading_job(uuid, integer, text, jsonb, numeric, text[], text, text, jsonb, boolean)
  to service_role;
grant execute on function public.fail_grading_job(uuid, integer, text, integer, boolean, boolean) to service_role;
grant execute on function public.skip_grading_job(uuid, integer, text)       to service_role;
grant execute on function public.hackathon_version_progress(uuid)            to service_role;
grant execute on function public.enqueue_third_run(uuid)                     to service_role;
grant execute on function public.set_version_eligibility(uuid, jsonb)        to service_role;
grant execute on function public.prune_hackathon_doqtri_snapshots()          to service_role;


-- ----------------------------------------------------------------------------
-- 12. The schedulers
--
-- qdit-grade-hackathon mirrors qdit-deliver-webhooks (20261024130000 section
-- 8, 20261025090000 section 2): the job runs request_hackathon_grading(),
-- which reads the URL and the CRON_SECRET from Vault at each run, warns
-- while either is missing, and returns the pg_net request id. It also sends
-- nothing while no job is pending or running, so an idle queue costs no
-- request. hackathon_grading_scheduler_health() is the route's signal.
-- Guarded like the webhook job: skipped where pg_cron, pg_net or Vault is
-- missing, and then the daily Vercel cron is all that grades.
-- ----------------------------------------------------------------------------

create or replace function public.hackathon_grading_missing_secrets()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
    select coalesce(array_agg(n.name order by n.ord), '{}')
      from (values (1, 'qdit_grade_hackathon_url'), (2, 'qdit_cron_secret')) as n (ord, name)
     where not exists (
       select 1 from vault.decrypted_secrets d
        where d.name = n.name
          and d.decrypted_secret is not null
     )
  );
end;
$$;

comment on function public.hackathon_grading_missing_secrets() is
  'Names of the Vault secrets the qdit-grade-hackathon job needs (qdit_grade_hackathon_url, qdit_cron_secret) that are not stored. Never returns a value.';


create or replace function public.request_hackathon_grading()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_missing text[] := public.hackathon_grading_missing_secrets();
begin
  if cardinality(v_missing) > 0 then
    raise warning 'qdit-grade-hackathon: Vault secret(s) % not stored; hackathon entries are not graded by the database, only by the daily Vercel cron',
      array_to_string(v_missing, ', ')
      using hint = 'Store them with vault.create_secret(), see supabase/migrations/20261110100000_hackathons.sql.';
    return null;
  end if;

  if not exists (
    select 1 from public.hackathon_grading_jobs j where j.status in ('pending', 'running')
  ) then
    return null;
  end if;

  return net.http_get(
    url := (select d.decrypted_secret from vault.decrypted_secrets d
             where d.name = 'qdit_grade_hackathon_url'),
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select d.decrypted_secret from vault.decrypted_secrets d
                     where d.name = 'qdit_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
end;
$$;

comment on function public.request_hackathon_grading() is
  'Run by the qdit-grade-hackathon pg_cron job: GETs /api/cron/grade-hackathon with the URL and bearer from Vault while any grading job is pending or running; RAISEs WARNING naming the missing secret(s) and sends nothing while one is missing.';


create or replace function public.hackathon_grading_scheduler_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job     boolean;
  v_missing text[];
begin
  if to_regclass('cron.job') is null
     or to_regnamespace('net') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return jsonb_build_object('status', 'unavailable', 'job', false, 'missing_secrets', '[]'::jsonb);
  end if;

  v_job := exists (
    select 1 from cron.job j
     where j.jobname = 'qdit-grade-hackathon'
       and j.active
  );
  v_missing := public.hackathon_grading_missing_secrets();

  return jsonb_build_object(
    'status', case when v_job and cardinality(v_missing) = 0 then 'configured' else 'missing' end,
    'job', v_job,
    'missing_secrets', to_jsonb(v_missing)
  );
end;
$$;

comment on function public.hackathon_grading_scheduler_health() is
  'SECURITY DEFINER, service_role only. {status: configured | missing | unavailable, job, missing_secrets}: whether the qdit-grade-hackathon job can run. Names only, never secret values.';


revoke all on function public.hackathon_grading_missing_secrets()  from public, anon, authenticated, service_role;
revoke all on function public.request_hackathon_grading()          from public, anon, authenticated, service_role;
revoke all on function public.hackathon_grading_scheduler_health() from public, anon, authenticated;
grant execute on function public.hackathon_grading_scheduler_health() to service_role;


do $schedule$
declare
  v_health jsonb;
begin
  if to_regprocedure('cron.schedule(text, text, text)') is null then
    raise notice 'hackathons: pg_cron is missing; grading and snapshot pruning are not scheduled in the database';
    return;
  end if;

  -- Daily, at an hour nothing else here uses. Needs only pg_cron.
  perform cron.schedule(
    'qdit-prune-hackathon-snapshots',
    '23 3 * * *',
    'select public.prune_hackathon_doqtri_snapshots()'
  );

  if to_regnamespace('net') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'hackathons: pg_net or Vault is missing; grading is not scheduled in the database';
    return;
  end if;

  -- Same name again replaces the job, so this is safe to re-run.
  perform cron.schedule(
    'qdit-grade-hackathon',
    '* * * * *',
    'select public.request_hackathon_grading()'
  );

  v_health := public.hackathon_grading_scheduler_health();
  if jsonb_array_length(v_health -> 'missing_secrets') > 0 then
    raise warning 'hackathons: the qdit-grade-hackathon job will send nothing until Vault holds %',
      (select string_agg(x, ', ') from jsonb_array_elements_text(v_health -> 'missing_secrets') as x)
      using hint = 'Store them with vault.create_secret(), see supabase/migrations/20261110100000_hackathons.sql.';
  end if;
end;
$schedule$;
