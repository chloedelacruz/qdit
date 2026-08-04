/**
 * The data access layer. Every read in the app goes through here.
 *
 * Row Level Security does the scoping: these queries never filter by
 * membership themselves, because `project_members` policies already restrict
 * every table to projects the caller belongs to. A missing `.eq()` here is a
 * narrower result, not a leak.
 *
 * Each function returns a `Page<T>` — `total` (unfiltered), `matched` (after
 * filters) and `rows` (after the limit) — so a page can tell "you have nothing
 * yet" apart from "your filter matched nothing" without a second round trip.
 */

import { TASK_STATUS_ORDER, type TaskStatus } from "@/lib/constants";
import type { Filters } from "@/lib/filters";
import type { StellarNetwork } from "@/lib/stellar";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/supabase/server";

export type Page<T> = {
  rows: T[];
  total: number;
  matched: number;
};

/** PostgREST returns `{ count: n }[]` for an aggregated embed. */
type EmbeddedCount = { count: number }[];

function countOf(value: EmbeddedCount | null | undefined): number {
  return value?.[0]?.count ?? 0;
}

/** `%` and `_` are wildcards in `ilike`; escape them so a search is literal. */
function likeTerm(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Applies a multi-value facet only when the user selected something. */
function applyIn<T extends { in: (col: string, values: string[]) => T }>(
  builder: T,
  column: string,
  values: string[],
): T {
  return values.length > 0 ? builder.in(column, values) : builder;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export type Member = {
  id: string;
  name: string;
  initials: string;
  walletAddress: string | null;
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

function toMember(row: {
  id: string;
  display_name: string | null;
  wallet_address: string | null;
}): Member {
  const name = row.display_name?.trim() || "Unknown";
  return {
    id: row.id,
    name,
    initials: initialsOf(name),
    walletAddress: row.wallet_address,
  };
}

/**
 * Everyone visible to the caller. The `profiles` RLS policy already limits this
 * to themselves plus teammates, so no explicit join is needed.
 */
export async function listMembers(): Promise<Member[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, wallet_address")
    .order("display_name");

  return (data ?? []).map(toMember);
}

export type MemberMap = Map<string, Member>;

/**
 * `tasks.assignee_id`, `stellar_proofs.created_by` and `deployments.deployed_by`
 * all reference `auth.users`, not `public.profiles` — deliberately, so an
 * unconfirmed user is still a valid FK target. That means PostgREST has no
 * relationship to embed across, so display names are joined here instead. One
 * extra request, and `profiles` is small and RLS-scoped.
 */
export async function memberMap(): Promise<MemberMap> {
  return new Map((await listMembers()).map((member) => [member.id, member]));
}

export async function getCurrentUserId(): Promise<string | null> {
  return (await getUser())?.id ?? null;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "completed" | "archived";
  network: StellarNetwork;
  deployment: "not_started" | "testnet" | "ready_for_mainnet" | "mainnet_live";
  contractId: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  updatedAt: string;
  taskCount: number;
  doneCount: number;
  milestoneCount: number;
  openMilestoneCount: number;
  progress: number;
};

/**
 * Aggregates are embedded rather than fetched per project — one round trip
 * instead of N. `!inner` is deliberately avoided: a project with no tasks must
 * still appear.
 */
const PROJECT_SELECT = `
  id, slug, name, description, status, repo_url, demo_url, updated_at,
  tasks(count),
  done:tasks(count),
  milestones(count),
  open_milestones:milestones(count),
  deployments(status, network, contract_id, deployed_at, created_at)
`;

type ProjectRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: ProjectRow["status"];
  repo_url: string | null;
  demo_url: string | null;
  updated_at: string;
  tasks: EmbeddedCount;
  done: EmbeddedCount;
  milestones: EmbeddedCount;
  open_milestones: EmbeddedCount;
  deployments: {
    status: ProjectRow["deployment"];
    network: StellarNetwork | null;
    contract_id: string | null;
    deployed_at: string | null;
    created_at: string;
  }[];
};

function toProject(row: ProjectRecord): ProjectRow {
  const taskCount = countOf(row.tasks);
  const doneCount = countOf(row.done);

  // Current deployment state is the most recent row, matching the
  // deployments_history_idx ordering in the schema.
  const latest = [...(row.deployments ?? [])].sort((a, b) =>
    (b.deployed_at ?? b.created_at).localeCompare(a.deployed_at ?? a.created_at),
  )[0];

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    network: latest?.network ?? "testnet",
    deployment: latest?.status ?? "not_started",
    contractId: latest?.contract_id ?? null,
    repoUrl: row.repo_url,
    demoUrl: row.demo_url,
    updatedAt: row.updated_at,
    taskCount,
    doneCount,
    milestoneCount: countOf(row.milestones),
    openMilestoneCount: countOf(row.open_milestones),
    progress: taskCount === 0 ? 0 : doneCount / taskCount,
  };
}

export async function listProjects(filters: Filters): Promise<Page<ProjectRow>> {
  const supabase = await createClient();

  const { count: total } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true });

  let query = supabase
    .from("projects")
    .select(PROJECT_SELECT, { count: "exact" })
    .eq("done.status", "done")
    .in("open_milestones.status", ["proposed", "submitted"]);

  if (filters.q) query = query.or(`name.ilike.${likeTerm(filters.q)},description.ilike.${likeTerm(filters.q)}`);
  query = applyIn(query, "status", filters.status);

  const sorted =
    filters.sort === "name"
      ? query.order("name")
      : query.order("updated_at", { ascending: false });

  const { data, count } = await sorted.limit(filters.limit);
  const rows = ((data ?? []) as unknown as ProjectRecord[]).map(toProject);

  // Progress is derived from embedded counts, so it cannot be ordered in SQL.
  if (filters.sort === "progress") rows.sort((a, b) => b.progress - a.progress);

  // Network lives on deployments, so it is filtered after the fact.
  const filtered =
    filters.network.length > 0
      ? rows.filter((row) => filters.network.includes(row.network))
      : rows;

  return { rows: filtered, total: total ?? 0, matched: count ?? filtered.length };
}

export async function getProject(slug: string): Promise<ProjectRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("done.status", "done")
    .in("open_milestones.status", ["proposed", "submitted"])
    .eq("slug", slug)
    .maybeSingle();

  return data ? toProject(data as unknown as ProjectRecord) : null;
}

export async function listProjectOptions(): Promise<
  { id: string; slug: string; name: string; status: ProjectRow["status"] }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, slug, name, status")
    .order("name");

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskRow = {
  id: string;
  projectId: string;
  milestoneId: string | null;
  title: string;
  status: TaskStatus;
  assigneeId: string | null;
  dueDate: string | null;
  projectName: string;
  projectSlug: string;
  milestoneTitle: string | null;
  assigneeName: string;
  assigneeInitials: string | null;
};

const TASK_SELECT = `
  id, project_id, milestone_id, title, status, assignee_id, due_date,
  projects!inner(name, slug),
  milestones(title)
`;

type TaskRecord = {
  id: string;
  project_id: string;
  milestone_id: string | null;
  title: string;
  status: TaskStatus;
  assignee_id: string | null;
  due_date: string | null;
  projects: { name: string; slug: string };
  milestones: { title: string } | null;
};

function toTask(row: TaskRecord, members: MemberMap): TaskRow {
  const name = members.get(row.assignee_id ?? "")?.name;
  return {
    id: row.id,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    title: row.title,
    status: row.status,
    assigneeId: row.assignee_id,
    dueDate: row.due_date,
    projectName: row.projects.name,
    projectSlug: row.projects.slug,
    milestoneTitle: row.milestones?.title ?? null,
    assigneeName: name || "Unassigned",
    assigneeInitials: name ? initialsOf(name) : null,
  };
}

function taskQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scope: { projectId?: string },
  filters: Filters,
) {
  let query = supabase.from("tasks").select(TASK_SELECT, { count: "exact" });

  if (scope.projectId) query = query.eq("project_id", scope.projectId);
  if (filters.q) query = query.ilike("title", likeTerm(filters.q));

  query = applyIn(query, "status", filters.status);
  query = applyIn(query, "assignee_id", filters.assignee);
  query = applyIn(query, "milestone_id", filters.milestone);
  query = applyIn(query, "project_id", filters.project);

  return query;
}

async function taskTotal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scope: { projectId?: string },
): Promise<number> {
  let query = supabase.from("tasks").select("id", { count: "exact", head: true });
  if (scope.projectId) query = query.eq("project_id", scope.projectId);
  const { count } = await query;
  return count ?? 0;
}

export async function listTasks(
  scope: { projectId?: string },
  filters: Filters,
): Promise<Page<TaskRow>> {
  const supabase = await createClient();
  const [total, members] = await Promise.all([taskTotal(supabase, scope), memberMap()]);

  const query = taskQuery(supabase, scope, filters);
  const ordered =
    filters.sort === "name"
      ? query.order("title")
      : // Undated work sorts last: a missing due date is not "due first".
        query.order("due_date", { ascending: true, nullsFirst: false }).order("title");

  const { data, count } = await ordered.limit(filters.limit);

  return {
    rows: ((data ?? []) as unknown as TaskRecord[]).map((row) => toTask(row, members)),
    total,
    matched: count ?? 0,
  };
}

export type BoardColumn = { status: TaskStatus; rows: TaskRow[]; matched: number };

export async function listBoard(
  scope: { projectId?: string },
  filters: Filters,
): Promise<{ columns: BoardColumn[]; total: number; matched: number }> {
  const supabase = await createClient();
  const [total, members] = await Promise.all([taskTotal(supabase, scope), memberMap()]);

  // One request per column: each needs its own count and its own limit, so a
  // long column cannot starve the others.
  const columns = await Promise.all(
    TASK_STATUS_ORDER.map(async (status) => {
      // An explicit status filter that excludes this column makes it empty.
      // Return without querying — a sentinel value here would be rejected by
      // Postgres as an invalid `task_status` enum and fail the whole request.
      if (filters.status.length > 0 && !filters.status.includes(status)) {
        return { status, rows: [], matched: 0 };
      }

      // The column *is* the status filter.
      const { data, count } = await taskQuery(supabase, scope, {
        ...filters,
        status: [status],
      })
        .order("order_index")
        .order("title")
        .limit(filters.limit);

      return {
        status,
        rows: ((data ?? []) as unknown as TaskRecord[]).map((row) => toTask(row, members)),
        matched: count ?? 0,
      };
    }),
  );

  return {
    columns,
    total,
    matched: columns.reduce((sum, column) => sum + column.matched, 0),
  };
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export type MilestoneRow = {
  id: string;
  projectId: string;
  title: string;
  status: "proposed" | "submitted" | "approved" | "rejected";
  dueDate: string | null;
  orderIndex: number;
  projectName: string;
  projectSlug: string;
  taskCount: number;
  doneCount: number;
  progress: number;
  proofCount: number;
  network: StellarNetwork;
};

const MILESTONE_SELECT = `
  id, project_id, title, status, due_date, order_index,
  projects!inner(name, slug),
  tasks(count),
  done:tasks(count),
  stellar_proofs(count)
`;

type MilestoneRecord = {
  id: string;
  project_id: string;
  title: string;
  status: MilestoneRow["status"];
  due_date: string | null;
  order_index: number;
  projects: { name: string; slug: string };
  tasks: EmbeddedCount;
  done: EmbeddedCount;
  stellar_proofs: EmbeddedCount;
};

function toMilestone(row: MilestoneRecord): MilestoneRow {
  const taskCount = countOf(row.tasks);
  const doneCount = countOf(row.done);

  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    dueDate: row.due_date,
    orderIndex: row.order_index,
    projectName: row.projects.name,
    projectSlug: row.projects.slug,
    taskCount,
    doneCount,
    progress: taskCount === 0 ? 0 : doneCount / taskCount,
    proofCount: countOf(row.stellar_proofs),
    network: "testnet",
  };
}

export async function listMilestones(
  scope: { projectId?: string },
  filters: Filters,
): Promise<Page<MilestoneRow>> {
  const supabase = await createClient();

  let totalQuery = supabase.from("milestones").select("id", { count: "exact", head: true });
  if (scope.projectId) totalQuery = totalQuery.eq("project_id", scope.projectId);
  const { count: total } = await totalQuery;

  let query = supabase
    .from("milestones")
    .select(MILESTONE_SELECT, { count: "exact" })
    .eq("done.status", "done");

  if (scope.projectId) query = query.eq("project_id", scope.projectId);
  if (filters.q) query = query.ilike("title", likeTerm(filters.q));
  query = applyIn(query, "status", filters.status);
  query = applyIn(query, "project_id", filters.project);

  const ordered =
    filters.sort === "name"
      ? query.order("title")
      : filters.sort === "due"
        ? query.order("due_date", { ascending: true, nullsFirst: false })
        : query.order("order_index");

  const { data, count } = await ordered.limit(filters.limit);
  const rows = ((data ?? []) as unknown as MilestoneRecord[]).map(toMilestone);

  if (filters.sort === "progress") rows.sort((a, b) => b.progress - a.progress);

  return { rows, total: total ?? 0, matched: count ?? 0 };
}

export async function listMilestoneOptions(
  projectId?: string,
): Promise<{ id: string; title: string }[]> {
  const supabase = await createClient();
  let query = supabase.from("milestones").select("id, title").order("order_index");
  if (projectId) query = query.eq("project_id", projectId);
  const { data } = await query;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

export type ProofRow = {
  id: string;
  projectId: string;
  milestoneId: string | null;
  contractId: string | null;
  txHash: string | null;
  network: StellarNetwork;
  walletAddress: string | null;
  proofUrl: string | null;
  notes: string | null;
  createdAt: string;
  projectName: string;
  projectSlug: string;
  milestoneTitle: string | null;
  authorName: string;
};

const PROOF_SELECT = `
  id, project_id, milestone_id, contract_id, tx_hash, network,
  wallet_address, proof_url, notes, created_at, created_by,
  projects!inner(name, slug),
  milestones(title)
`;

type ProofRecord = {
  id: string;
  project_id: string;
  milestone_id: string | null;
  contract_id: string | null;
  tx_hash: string | null;
  network: StellarNetwork;
  wallet_address: string | null;
  proof_url: string | null;
  notes: string | null;
  created_at: string;
  projects: { name: string; slug: string };
  milestones: { title: string } | null;
  created_by: string | null;
};

function toProof(row: ProofRecord, members: MemberMap): ProofRow {
  return {
    id: row.id,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    contractId: row.contract_id,
    txHash: row.tx_hash,
    network: row.network,
    walletAddress: row.wallet_address,
    proofUrl: row.proof_url,
    notes: row.notes,
    createdAt: row.created_at,
    projectName: row.projects.name,
    projectSlug: row.projects.slug,
    milestoneTitle: row.milestones?.title ?? null,
    authorName: members.get(row.created_by ?? "")?.name ?? "Unknown",
  };
}

export async function listProofs(
  scope: { projectId?: string },
  filters: Filters,
): Promise<Page<ProofRow>> {
  const supabase = await createClient();

  const members = await memberMap();

  let totalQuery = supabase
    .from("stellar_proofs")
    .select("id", { count: "exact", head: true });
  if (scope.projectId) totalQuery = totalQuery.eq("project_id", scope.projectId);
  const { count: total } = await totalQuery;

  let query = supabase.from("stellar_proofs").select(PROOF_SELECT, { count: "exact" });

  if (scope.projectId) query = query.eq("project_id", scope.projectId);
  if (filters.q) {
    // Identifiers are searchable too, so a pasted hash finds its record.
    const term = likeTerm(filters.q);
    query = query.or(`notes.ilike.${term},contract_id.ilike.${term},tx_hash.ilike.${term}`);
  }
  query = applyIn(query, "network", filters.network);
  query = applyIn(query, "project_id", filters.project);
  query = applyIn(query, "milestone_id", filters.milestone);

  const { data, count } = await query
    .order("created_at", { ascending: false })
    .limit(filters.limit);

  return {
    rows: ((data ?? []) as unknown as ProofRecord[]).map((row) => toProof(row, members)),
    total: total ?? 0,
    matched: count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------

export type DeploymentRow = {
  id: string;
  projectId: string;
  status: ProjectRow["deployment"];
  network: StellarNetwork | null;
  contractId: string | null;
  txHash: string | null;
  releaseNotes: string | null;
  deployedAt: string;
  projectName: string;
  projectSlug: string;
  deployedByName: string;
  isCurrent: boolean;
};

const DEPLOYMENT_SELECT = `
  id, project_id, status, network, contract_id, tx_hash, release_notes,
  deployed_at, created_at, deployed_by,
  projects!inner(name, slug)
`;

type DeploymentRecord = {
  id: string;
  project_id: string;
  status: DeploymentRow["status"];
  network: StellarNetwork | null;
  contract_id: string | null;
  tx_hash: string | null;
  release_notes: string | null;
  deployed_at: string | null;
  created_at: string;
  projects: { name: string; slug: string };
  deployed_by: string | null;
};

export async function listDeployments(
  scope: { projectId?: string },
  filters: Filters,
): Promise<Page<DeploymentRow>> {
  const supabase = await createClient();

  const members = await memberMap();

  let query = supabase.from("deployments").select(DEPLOYMENT_SELECT);
  if (scope.projectId) query = query.eq("project_id", scope.projectId);
  query = applyIn(query, "status", filters.status);
  query = applyIn(query, "network", filters.network);
  query = applyIn(query, "project_id", filters.project);

  const { data } = await query.order("deployed_at", {
    ascending: false,
    nullsFirst: false,
  });

  const records = (data ?? []) as unknown as DeploymentRecord[];

  // "Current" is the most recent row per project.
  const newestByProject = new Map<string, string>();
  for (const row of records) {
    const stamp = row.deployed_at ?? row.created_at;
    const seen = newestByProject.get(row.project_id);
    if (!seen || stamp.localeCompare(seen) > 0) newestByProject.set(row.project_id, stamp);
  }

  const all: DeploymentRow[] = records.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    network: row.network,
    contractId: row.contract_id,
    txHash: row.tx_hash,
    releaseNotes: row.release_notes,
    deployedAt: row.deployed_at ?? row.created_at,
    projectName: row.projects.name,
    projectSlug: row.projects.slug,
    deployedByName: members.get(row.deployed_by ?? "")?.name ?? "Unknown",
    isCurrent: newestByProject.get(row.project_id) === (row.deployed_at ?? row.created_at),
  }));

  // Cross-project view shows current state per project; a project's own page
  // shows its full append-only history.
  const scoped = scope.projectId ? all : all.filter((row) => row.isCurrent);

  const matched = filters.q
    ? scoped.filter((row) =>
        [row.projectName, row.releaseNotes, row.contractId, row.txHash].some((value) =>
          value?.toLowerCase().includes(filters.q.toLowerCase()),
        ),
      )
    : scoped;

  return {
    rows: matched.slice(0, filters.limit),
    total: scoped.length,
    matched: matched.length,
  };
}

// ---------------------------------------------------------------------------
// Identifier resolution
// ---------------------------------------------------------------------------

export type IdentifierHit = {
  kind: "contract" | "tx";
  value: string;
  projectName: string;
  projectSlug: string;
  network: StellarNetwork;
  context: string;
};

export async function resolveIdentifier(value: string): Promise<IdentifierHit[]> {
  const needle = value.trim();
  if (needle.length < 6) return [];

  const supabase = await createClient();
  const members = await memberMap();
  const term = likeTerm(needle);

  const [proofs, deployments] = await Promise.all([
    supabase
      .from("stellar_proofs")
      .select(PROOF_SELECT)
      .or(`contract_id.ilike.${term},tx_hash.ilike.${term}`)
      .limit(20),
    supabase
      .from("deployments")
      .select(DEPLOYMENT_SELECT)
      .or(`contract_id.ilike.${term},tx_hash.ilike.${term}`)
      .limit(20),
  ]);

  const hits: IdentifierHit[] = [];

  for (const row of (proofs.data ?? []) as unknown as ProofRecord[]) {
    const proof = toProof(row, members);
    const isContract = proof.contractId?.toLowerCase() === needle.toLowerCase();
    hits.push({
      kind: isContract ? "contract" : "tx",
      value: isContract ? proof.contractId! : proof.txHash!,
      projectName: proof.projectName,
      projectSlug: proof.projectSlug,
      network: proof.network,
      context: proof.milestoneTitle ? `Proof · ${proof.milestoneTitle}` : "Proof record",
    });
  }

  for (const row of (deployments.data ?? []) as unknown as DeploymentRecord[]) {
    const isContract = row.contract_id?.toLowerCase() === needle.toLowerCase();
    hits.push({
      kind: isContract ? "contract" : "tx",
      value: (isContract ? row.contract_id : row.tx_hash) ?? needle,
      projectName: row.projects.name,
      projectSlug: row.projects.slug,
      network: row.network ?? "testnet",
      context: "Deployment record",
    });
  }

  return hits;
}

// ---------------------------------------------------------------------------
// Workspace rollup
// ---------------------------------------------------------------------------

export type WorkspaceSummary = {
  projectCount: number;
  activeProjectCount: number;
  taskCount: number;
  doneCount: number;
  openMilestoneCount: number;
  mainnetLiveCount: number;
  myOpenTaskCount: number;
};

export async function getWorkspaceSummary(): Promise<WorkspaceSummary> {
  const supabase = await createClient();
  const userId = await getCurrentUserId();

  const head = { count: "exact" as const, head: true };

  const [projects, active, tasks, done, openMilestones, mine, live] = await Promise.all([
    supabase.from("projects").select("id", head),
    supabase.from("projects").select("id", head).eq("status", "active"),
    supabase.from("tasks").select("id", head),
    supabase.from("tasks").select("id", head).eq("status", "done"),
    supabase.from("milestones").select("id", head).in("status", ["proposed", "submitted"]),
    userId
      ? supabase
          .from("tasks")
          .select("id", head)
          .eq("assignee_id", userId)
          .neq("status", "done")
      : Promise.resolve({ count: 0 }),
    supabase.from("deployments").select("project_id").eq("status", "mainnet_live"),
  ]);

  return {
    projectCount: projects.count ?? 0,
    activeProjectCount: active.count ?? 0,
    taskCount: tasks.count ?? 0,
    doneCount: done.count ?? 0,
    openMilestoneCount: openMilestones.count ?? 0,
    // Distinct projects, not deployment rows — a project can go live twice.
    mainnetLiveCount: new Set(
      ((live.data ?? []) as { project_id: string }[]).map((row) => row.project_id),
    ).size,
    myOpenTaskCount: mine.count ?? 0,
  };
}
