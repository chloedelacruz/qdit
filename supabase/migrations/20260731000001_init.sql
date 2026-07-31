-- ============================================================================
-- qdit — Stellar Builder Task Hub
-- 20260731000001_init.sql
--
-- Enum types, tables, indexes and triggers for the off-chain data layer.
-- Row Level Security lives in 20260731000002_rls.sql.
--
-- Ordering inside this file matters:
--   1. enum types          (referenced by table column definitions)
--   2. utility functions   (referenced by triggers created in step 5)
--   3. tables              (in FK dependency order)
--   4. indexes
--   5. triggers
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Enum types
-- ----------------------------------------------------------------------------

-- Lifecycle of a project. Mirrors the "Project status" MVP feature.
create type public.project_status as enum (
  'active',
  'paused',
  'completed',
  'archived'
);

-- Workspace membership levels, ordered least -> most privileged.
-- Ranking is done by public.member_role_rank() (see the RLS migration), not by
-- the enum's physical sort order, so that inserting a level later is safe.
create type public.member_role as enum (
  'viewer',
  'member',
  'admin',
  'owner'
);

-- Milestone lifecycle. Deliberately identical to the `MilestoneStatus` enum in
-- contracts/milestone_proof/src/lib.rs so off-chain and on-chain state can be
-- compared directly: Proposed -> Submitted -> Approved | Rejected.
create type public.milestone_status as enum (
  'proposed',
  'submitted',
  'approved',
  'rejected'
);

-- Task board columns: Todo -> In Progress -> Done.
create type public.task_status as enum (
  'todo',
  'in_progress',
  'done'
);

-- Stellar network a proof or deployment refers to.
create type public.stellar_network as enum (
  'testnet',
  'mainnet'
);

-- Deployment pipeline:
-- Not Started -> Deployed to Testnet -> Ready for Mainnet -> Mainnet Live.
create type public.deployment_status as enum (
  'not_started',
  'testnet',
  'ready_for_mainnet',
  'mainnet_live'
);


-- ----------------------------------------------------------------------------
-- 2. Utility functions used by triggers
-- ----------------------------------------------------------------------------

-- Generic `updated_at` stamper. Not security definer: it only mutates the row
-- already being written, so it needs no elevated privileges.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at with the current transaction time.';


-- Mirrors a newly created auth.users row into public.profiles.
--
-- SECURITY DEFINER because it is fired by a trigger on auth.users during
-- sign-up, at which point the effective role is `supabase_auth_admin`, which
-- has no rights on public.profiles. Running as the function owner lets the
-- insert through. search_path is pinned to '' and every identifier is
-- schema-qualified so a caller cannot shadow `profiles` with their own table.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name',
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT trigger on auth.users: creates the matching public.profiles row.';


-- Grants the creator of a project an `owner` membership row.
--
-- SECURITY DEFINER because the RLS policy on public.project_members requires
-- the caller to already be an admin of the project — which is impossible for
-- the very first row. This trigger is the bootstrap that breaks that cycle.
create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (project_id, user_id) do update set role = 'owner';

  return new;
end;
$$;

comment on function public.handle_new_project() is
  'AFTER INSERT trigger on public.projects: adds the owner as an owner member.';


-- ----------------------------------------------------------------------------
-- 3. Tables
-- ----------------------------------------------------------------------------

-- 3.1 profiles ---------------------------------------------------------------
-- One row per auth.users row. Holds the public-facing identity plus the
-- builder's Stellar wallet address.
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  display_name   text,
  avatar_url     text,
  wallet_address text,
  created_at     timestamptz not null default now()
);

comment on table public.profiles is
  'Public profile mirroring auth.users. Created automatically on sign-up.';
comment on column public.profiles.wallet_address is
  'Stellar account address (G...) used when attaching proof of work.';


-- 3.2 projects ---------------------------------------------------------------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete restrict,
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  -- Globally unique so /projects/[slug] resolves without an owner segment.
  slug        text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  status      public.project_status not null default 'active',
  repo_url    text,
  demo_url    text,
  docs_url    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.projects is
  'A builder workspace. Owns milestones, tasks, Stellar proofs and deployments.';


-- 3.3 project_members --------------------------------------------------------
create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.member_role not null default 'member',
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

comment on table public.project_members is
  'Membership + role join table. The single source of truth for all RLS checks.';


-- 3.4 milestones -------------------------------------------------------------
create table public.milestones (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 300),
  description text,
  status      public.milestone_status not null default 'proposed',
  due_date    date,
  order_index integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.milestones is
  'Milestone with an off-chain status that mirrors the milestone_proof contract.';


-- 3.5 tasks ------------------------------------------------------------------
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  -- Unlinking a milestone must not destroy its tasks, so SET NULL.
  milestone_id uuid references public.milestones (id) on delete set null,
  title        text not null check (char_length(btrim(title)) between 1 and 300),
  description  text,
  status       public.task_status not null default 'todo',
  -- Reference auth.users (not profiles) so an unconfirmed user is still valid.
  assignee_id  uuid references auth.users (id) on delete set null,
  due_date     date,
  order_index  integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.tasks is
  'Board card. Moves Todo -> In Progress -> Done, optionally linked to a milestone.';


-- 3.6 stellar_proofs ---------------------------------------------------------
-- Proof of work records. Always scoped to a project; optionally narrowed to a
-- single milestone. Dropping the milestone keeps the proof on the project.
create table public.stellar_proofs (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  milestone_id   uuid references public.milestones (id) on delete set null,
  contract_id    text,
  tx_hash        text,
  network        public.stellar_network not null default 'testnet',
  wallet_address text,
  proof_url      text,
  notes          text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  -- A proof with neither a contract id, a tx hash nor a URL proves nothing.
  constraint stellar_proofs_has_evidence check (
    coalesce(btrim(contract_id), '') <> ''
    or coalesce(btrim(tx_hash), '') <> ''
    or coalesce(btrim(proof_url), '') <> ''
  )
);

comment on table public.stellar_proofs is
  'Stellar-specific proof of work: contract id, tx hash, network, wallet, links.';


-- 3.7 deployments ------------------------------------------------------------
-- Append-only-ish history log. The project's current deployment state is the
-- most recent row ordered by coalesce(deployed_at, created_at).
create table public.deployments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  status        public.deployment_status not null default 'not_started',
  network       public.stellar_network,
  contract_id   text,
  tx_hash       text,
  release_notes text,
  deployed_by   uuid references auth.users (id) on delete set null,
  deployed_at   timestamptz,
  created_at    timestamptz not null default now(),
  -- Anything past 'not_started' has to say which network it happened on.
  constraint deployments_network_required check (
    status = 'not_started' or network is not null
  )
);

comment on table public.deployments is
  'Deployment history log. Latest row per project is the current release state.';


-- ----------------------------------------------------------------------------
-- 4. Indexes
--
-- Postgres indexes primary keys and UNIQUE constraints automatically, so only
-- foreign keys and the columns backing the spec's Search/Filter feature
-- (status, network, milestone, assignee) are indexed here.
-- ----------------------------------------------------------------------------

-- projects
create index projects_owner_id_idx on public.projects (owner_id);
create index projects_status_idx   on public.projects (status);

-- project_members (project_id is already the PK prefix)
create index project_members_user_id_idx on public.project_members (user_id);
create index project_members_role_idx    on public.project_members (project_id, role);

-- milestones
create index milestones_project_id_idx on public.milestones (project_id);
create index milestones_status_idx     on public.milestones (project_id, status);
create index milestones_due_date_idx   on public.milestones (project_id, due_date);
create index milestones_order_idx      on public.milestones (project_id, order_index);

-- tasks
create index tasks_project_id_idx   on public.tasks (project_id);
create index tasks_milestone_id_idx on public.tasks (milestone_id);
create index tasks_assignee_id_idx  on public.tasks (assignee_id);
create index tasks_status_idx       on public.tasks (project_id, status);
create index tasks_due_date_idx     on public.tasks (project_id, due_date);
create index tasks_board_idx        on public.tasks (project_id, status, order_index);

-- stellar_proofs
create index stellar_proofs_project_id_idx   on public.stellar_proofs (project_id);
create index stellar_proofs_milestone_id_idx on public.stellar_proofs (milestone_id);
create index stellar_proofs_created_by_idx   on public.stellar_proofs (created_by);
create index stellar_proofs_network_idx      on public.stellar_proofs (project_id, network);
-- Explorer lookups paste a raw contract id / tx hash, so index them directly.
create index stellar_proofs_contract_id_idx  on public.stellar_proofs (contract_id)
  where contract_id is not null;
create index stellar_proofs_tx_hash_idx      on public.stellar_proofs (tx_hash)
  where tx_hash is not null;

-- deployments
create index deployments_project_id_idx  on public.deployments (project_id);
create index deployments_deployed_by_idx on public.deployments (deployed_by);
create index deployments_status_idx      on public.deployments (project_id, status);
create index deployments_network_idx     on public.deployments (project_id, network);
-- Backs "current deployment state" = most recent row for the project.
create index deployments_history_idx
  on public.deployments (project_id, coalesce(deployed_at, created_at) desc);


-- ----------------------------------------------------------------------------
-- 5. Triggers
-- ----------------------------------------------------------------------------

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

create trigger milestones_set_updated_at
  before update on public.milestones
  for each row execute function public.set_updated_at();

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();
