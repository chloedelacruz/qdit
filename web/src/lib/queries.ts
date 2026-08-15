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

import {
  TASK_STATUS_ORDER,
  type MemberRole,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/constants";
import type { Filters } from "@/lib/filters";
import { isMilestoneAnchorStale } from "@/lib/milestone-hash";
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
  /**
   * Populated by `handle_new_user` from the OAuth provider's metadata, so it is
   * null for anyone who signed up with a password. Every consumer treats it as
   * an enhancement over `initials` rather than a replacement — see
   * `MemberAvatar` in `rows.tsx`.
   */
  avatarUrl: string | null;
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
  avatar_url: string | null;
}): Member {
  const name = row.display_name?.trim() || "Unknown";
  return {
    id: row.id,
    name,
    initials: initialsOf(name),
    walletAddress: row.wallet_address,
    avatarUrl: row.avatar_url,
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
    .select("id, display_name, wallet_address, avatar_url")
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

/**
 * The caller's own sign-in identity: the three things that open this account,
 * plus the name attached to them.
 *
 * Separate from `Member` on purpose. `Member` is how somebody appears *to
 * other people* — a name, initials, an avatar — and it is fetched for whole
 * rosters at a time. This is the account itself, it is only ever about the
 * caller, and it carries the email, which is not a roster field and should not
 * become one by accident.
 */
export type OwnIdentity = {
  id: string;
  /** Null only in the moment between a session expiring and a redirect. */
  email: string | null;
  displayName: string;
  /** Null on accounts created before registration existed. */
  username: string | null;
  /** Immutable once set — see profiles_freeze_wallet_address. */
  walletAddress: string | null;
};

export async function getOwnIdentity(): Promise<OwnIdentity | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("display_name, username, wallet_address")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email,
    displayName: data?.display_name?.trim() || "Unknown",
    username: data?.username ?? null,
    walletAddress: data?.wallet_address ?? null,
  };
}

export type ProjectMember = Member & {
  role: MemberRole;
  joinedAt: string;
};

/** Mirrors `member_role_rank()` in the RLS migration, for display ordering. */
const ROLE_RANK: Record<MemberRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

/**
 * The roster for one project.
 *
 * Readable by anyone in the project — `project_members: read as member` is
 * viewer+, and only the three write actions are admin-gated. So this is a list
 * everybody sees and a few people can change.
 *
 * `project_members.user_id` references `auth.users`, not `public.profiles`, so
 * PostgREST has no relationship to embed across and names are joined through
 * `memberMap()` — the same reason it exists for tasks and proofs. A member with
 * no readable profile still shows: RLS could in principle hide one, and a row
 * missing from the roster would be worse than a row without a name.
 */
export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const supabase = await createClient();
  const [{ data }, profiles] = await Promise.all([
    supabase
      .from("project_members")
      .select("user_id, role, joined_at")
      .eq("project_id", projectId),
    memberMap(),
  ]);

  const rows: ProjectMember[] = (data ?? []).map((row) => {
    const profile = profiles.get(row.user_id);
    return {
      id: row.user_id,
      name: profile?.name ?? "Unknown",
      initials: profile?.initials ?? "?",
      walletAddress: profile?.walletAddress ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      role: row.role as MemberRole,
      joinedAt: row.joined_at,
    };
  });

  // Owner first, then by rank, then alphabetically — the roster answers "who
  // decides here" before it answers "who is here".
  return rows.sort(
    (a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name),
  );
}

/**
 * Who an admin can actually add to a project.
 *
 * This is where RLS sets the ceiling. `profiles: read own or teammate` narrows
 * `profiles` to yourself plus anyone `shares_project_with()` says you already
 * share a project with, so `listMembers()` is the complete set of people this
 * caller can resolve to a user id at all. There is no query that turns an
 * arbitrary email or wallet address into a uuid without a new SECURITY DEFINER
 * function, so the picker offers exactly the people RLS admits exist — minus
 * whoever is already on this project.
 */
export async function listAddableMembers(projectId: string): Promise<Member[]> {
  const [everyone, existing] = await Promise.all([
    listMembers(),
    listProjectMembers(projectId),
  ]);

  const taken = new Set(existing.map((member) => member.id));
  return everyone.filter((member) => !taken.has(member.id));
}

/**
 * The caller's role in one project, or null if they are not a member.
 *
 * Needed because the RLS layer is not uniform: tasks and milestones are
 * editable by any member, projects and deployments only by an admin or the
 * owner, proofs by their creator or an admin. Without this the UI would offer
 * controls that fail at submit time with a 42501 — which `friendly()` does
 * translate, but late and after the user filled in a form.
 *
 * This gates the UI only. The server actions re-check and RLS is the actual
 * boundary; a hidden button is courtesy, not security.
 */
export async function getProjectRole(projectId: string): Promise<MemberRole | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  return data?.role ?? null;
}

/**
 * Every project the caller belongs to, mapped to their role in it.
 *
 * The cross-project lists (/tasks, /milestones, /proofs) show rows from many
 * projects at once, and the caller can hold a different role in each. One
 * request for the whole membership set, rather than `getProjectRole` per row.
 */
export async function listProjectRoles(): Promise<Map<string, MemberRole>> {
  const userId = await getCurrentUserId();
  if (!userId) return new Map();

  const supabase = await createClient();
  const { data } = await supabase
    .from("project_members")
    .select("project_id, role")
    .eq("user_id", userId);

  return new Map((data ?? []).map((row) => [row.project_id, row.role as MemberRole]));
}

/**
 * Project id → owner id, for the cross-project views.
 *
 * Approving a milestone is the owner's alone — the contract checks
 * `approver == owner`, so the UI has to know who that is before offering the
 * control. Scoped views read `project.ownerId` directly and do not need this.
 */
export async function listProjectOwners(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("id, owner_id");

  return new Map((data ?? []).map((row) => [row.id, row.owner_id]));
}

/** Manage the project itself, its deployments and its members. */
export function canAdminister(role: MemberRole | null): boolean {
  return role === "owner" || role === "admin";
}

/** Create and edit tasks, milestones and proofs. Viewers cannot. */
export function canContribute(role: MemberRole | null): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

/**
 * A proof is editable by whoever recorded it, or by an admin — mirroring the
 * `stellar_proofs: update own or as admin` policy.
 */
export function canEditProof(
  role: MemberRole | null,
  authorId: string | null,
  userId: string | null,
): boolean {
  return canAdminister(role) || (authorId !== null && authorId === userId);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectRow = {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "completed" | "archived";
  network: StellarNetwork;
  deployment: "not_started" | "testnet" | "ready_for_mainnet" | "mainnet_live";
  contractId: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  docsUrl: string | null;
  updatedAt: string;
  /** Milestone proofs are readable at /p/[slug]/[milestone] by anyone. */
  publicProofs: boolean;
  taskCount: number;
  doneCount: number;
  milestoneCount: number;
  openMilestoneCount: number;
  progress: number;
  /** `create_project_ref` transaction, or null if never registered. */
  chainRegistration: {
    contractId: string;
    network: StellarNetwork;
    ownerAddress: string;
    txHash: string;
    registeredAt: string;
  } | null;
};

/**
 * Aggregates are embedded rather than fetched per project — one round trip
 * instead of N. `!inner` is deliberately avoided: a project with no tasks must
 * still appear.
 */
const PROJECT_SELECT = `
  id, owner_id, slug, name, description, status, repo_url, demo_url, docs_url, updated_at,
  public_proofs,
  chain_contract_id, chain_network, chain_owner_address, chain_registered_tx, chain_registered_at,
  tasks(count),
  done:tasks(count),
  milestones(count),
  open_milestones:milestones(count),
  deployments(status, network, contract_id, deployed_at, created_at)
`;

type ProjectRecord = {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  description: string | null;
  status: ProjectRow["status"];
  repo_url: string | null;
  demo_url: string | null;
  docs_url: string | null;
  updated_at: string;
  public_proofs: boolean;
  chain_contract_id: string | null;
  chain_network: StellarNetwork | null;
  chain_owner_address: string | null;
  chain_registered_tx: string | null;
  chain_registered_at: string | null;
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
    ownerId: row.owner_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status,
    network: latest?.network ?? "testnet",
    deployment: latest?.status ?? "not_started",
    contractId: latest?.contract_id ?? null,
    repoUrl: row.repo_url,
    demoUrl: row.demo_url,
    docsUrl: row.docs_url,
    updatedAt: row.updated_at,
    publicProofs: row.public_proofs,
    taskCount,
    doneCount,
    milestoneCount: countOf(row.milestones),
    openMilestoneCount: countOf(row.open_milestones),
    progress: taskCount === 0 ? 0 : doneCount / taskCount,
    // The schema constrains these five to be all-null or all-set, so one null
    // check settles it.
    chainRegistration: row.chain_contract_id
      ? {
          contractId: row.chain_contract_id,
          network: row.chain_network ?? "testnet",
          ownerAddress: row.chain_owner_address ?? "",
          txHash: row.chain_registered_tx ?? "",
          registeredAt: row.chain_registered_at ?? "",
        }
      : null,
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
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  dueDate: string | null;
  projectName: string;
  projectSlug: string;
  milestoneTitle: string | null;
  /** The task's milestone has at least one anchor on the ledger. */
  milestoneAnchored: boolean;
  assigneeName: string;
  assigneeInitials: string | null;
  assigneeAvatarUrl: string | null;
};

/*
  `milestone_anchors(action)` is embedded two levels deep on purpose.

  A tester put it plainly: the board showed nothing about what was anchored, so
  finding out meant opening every milestone one at a time. Anchor state is a
  property of the milestone, not the task, but the board is where people look
  at the work — so the task carries the flag and the milestone owns the fact.

  Only the existence of a row matters here, never its contents, which is why
  one column comes back rather than the anchor itself. The list rows show the
  full badge; a board card shows a mark.
*/
const TASK_SELECT = `
  id, project_id, milestone_id, title, description, status, priority, assignee_id, due_date,
  projects!inner(name, slug),
  milestones(title, milestone_anchors(action))
`;

type TaskRecord = {
  id: string;
  project_id: string;
  milestone_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_date: string | null;
  projects: { name: string; slug: string };
  milestones: {
    title: string;
    milestone_anchors: { action: MilestoneAnchor["action"] }[];
  } | null;
};

function toTask(row: TaskRecord, members: MemberMap): TaskRow {
  const member = members.get(row.assignee_id ?? "");
  const name = member?.name;
  return {
    id: row.id,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    dueDate: row.due_date,
    projectName: row.projects.name,
    projectSlug: row.projects.slug,
    milestoneTitle: row.milestones?.title ?? null,
    // Anchored at all, not anchored-and-current: a card has room for a mark,
    // and "is any of this on the ledger" is the question the board is being
    // asked. Staleness is a milestone-level nuance and stays on the list row.
    milestoneAnchored: (row.milestones?.milestone_anchors?.length ?? 0) > 0,
    assigneeName: name || "Unassigned",
    assigneeInitials: name ? initialsOf(name) : null,
    // Only when there is someone to attribute it to: an unassigned task shows
    // the dashed placeholder, never a stale photo.
    assigneeAvatarUrl: name ? (member?.avatarUrl ?? null) : null,
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
  query = applyIn(query, "priority", filters.priority);
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
      : filters.sort === "priority"
        ? // `task_priority` is declared low → urgent, so Postgres sorts the
          // enum in that order and descending is what puts P0 at the top. Due
          // date breaks the tie, because within one priority the question is
          // still which of these is due first.
          query
            .order("priority", { ascending: false })
            .order("due_date", { ascending: true, nullsFirst: false })
            .order("title")
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
  description: string | null;
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
  /** Whether the project is registered on chain; null until it is. */
  chainContractId: string | null;
  /** The project publishes proof pages, so this milestone has a public link. */
  publicProofs: boolean;
  /** Most recent milestone_anchors row, or null if never anchored. */
  anchor: MilestoneAnchor | null;
  /**
   * The milestone changed after its hash was anchored, so the ledger entry is
   * still valid evidence of what it *was* and no longer describes what it is.
   * False when there is no anchor at all — nothing to be stale against.
   */
  anchorStale: boolean;
  /**
   * Decisions on this milestone, newest first. Empty until someone approves or
   * rejects it — a submission is not a decision.
   */
  reviews: MilestoneReview[];
};

/**
 * One approval or rejection, with the reason given.
 *
 * The ledger records that a decision happened and which key signed it; this
 * records why. Kept off chain because `reject_milestone` takes no memo and
 * adding one would mean redeploying the contract — see the migration header in
 * `20260815094500_milestone_reviews.sql`.
 */
export type MilestoneReview = {
  id: string;
  fromStatus: MilestoneRow["status"];
  toStatus: MilestoneRow["status"];
  reason: string | null;
  reviewerId: string | null;
  reviewerName: string;
  createdAt: string;
};

export type MilestoneAnchor = {
  action: "submit" | "approve" | "reject";
  proofHash: string | null;
  version: number;
  txHash: string;
  network: StellarNetwork;
  signerAddress: string;
  createdAt: string;
};

// `stellar_proofs` is embedded as rows rather than a count because the anchor
// digest covers them: adding a proof to a milestone changes its hash, which is
// what makes an existing anchor stale. The count falls out of `.length`.
const MILESTONE_SELECT = `
  id, project_id, title, description, status, due_date, order_index,
  projects!inner(name, slug, chain_contract_id, public_proofs),
  tasks(count),
  done:tasks(count),
  stellar_proofs(id, contract_id, tx_hash, network, wallet_address, proof_url),
  milestone_anchors(action, proof_hash, version, tx_hash, network, signer_address, created_at),
  milestone_reviews(id, from_status, to_status, reason, reviewer_id, created_at)
`;

type MilestoneRecord = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: MilestoneRow["status"];
  due_date: string | null;
  order_index: number;
  projects: {
    name: string;
    slug: string;
    chain_contract_id: string | null;
    public_proofs: boolean;
  };
  tasks: EmbeddedCount;
  done: EmbeddedCount;
  stellar_proofs: {
    id: string;
    contract_id: string | null;
    tx_hash: string | null;
    network: StellarNetwork;
    wallet_address: string | null;
    proof_url: string | null;
  }[];
  milestone_anchors: {
    action: MilestoneAnchor["action"];
    proof_hash: string | null;
    version: number;
    tx_hash: string;
    network: StellarNetwork;
    signer_address: string;
    created_at: string;
  }[];
  milestone_reviews: {
    id: string;
    from_status: MilestoneRow["status"];
    to_status: MilestoneRow["status"];
    reason: string | null;
    reviewer_id: string | null;
    created_at: string;
  }[];
};

function toMilestone(row: MilestoneRecord, members: MemberMap): MilestoneRow {
  const taskCount = countOf(row.tasks);
  const doneCount = countOf(row.done);

  // The embed comes back unordered; the newest row is the current anchor state.
  // Sorted here rather than in the query because PostgREST cannot order an
  // embedded resource and limit it to one row in the same select.
  const latest = [...(row.milestone_anchors ?? [])].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  )[0];

  // Only a `submit` carries a hash — approve and reject attest to one already
  // on chain — so staleness is measured against the last submission, not the
  // last action.
  const anchoredHash = [...(row.milestone_anchors ?? [])]
    .filter((entry) => entry.action === "submit")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))[0]
    ?.proof_hash;

  const proofs = row.stellar_proofs ?? [];

  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    dueDate: row.due_date,
    orderIndex: row.order_index,
    projectName: row.projects.name,
    projectSlug: row.projects.slug,
    taskCount,
    doneCount,
    progress: taskCount === 0 ? 0 : doneCount / taskCount,
    proofCount: proofs.length,
    network: "testnet",
    chainContractId: row.projects.chain_contract_id,
    publicProofs: row.projects.public_proofs,
    anchor: latest
      ? {
          action: latest.action,
          proofHash: latest.proof_hash,
          version: latest.version,
          txHash: latest.tx_hash,
          network: latest.network,
          signerAddress: latest.signer_address,
          createdAt: latest.created_at,
        }
      : null,
    anchorStale: anchoredHash
      ? isMilestoneAnchorStale(
          {
            id: row.id,
            projectId: row.project_id,
            title: row.title,
            description: row.description,
            status: row.status,
            dueDate: row.due_date,
            proofs: proofs.map((proof) => ({
              id: proof.id,
              contractId: proof.contract_id,
              txHash: proof.tx_hash,
              network: proof.network,
              walletAddress: proof.wallet_address,
              proofUrl: proof.proof_url,
            })),
          },
          anchoredHash,
        )
      : false,
    // Newest first, sorted here for the same reason the anchors are: PostgREST
    // cannot order an embedded resource.
    reviews: [...(row.milestone_reviews ?? [])]
      .sort((a, b) =>
        a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
      )
      .map((review) => ({
        id: review.id,
        fromStatus: review.from_status,
        toStatus: review.to_status,
        reason: review.reason,
        reviewerId: review.reviewer_id,
        // A reviewer who has left the project is still the person who decided.
        reviewerName: members.get(review.reviewer_id ?? "")?.name || "A former member",
        createdAt: review.created_at,
      })),
  };
}

export async function listMilestones(
  scope: { projectId?: string },
  filters: Filters,
): Promise<Page<MilestoneRow>> {
  const supabase = await createClient();
  // Reviews name their reviewer, and a raw uuid names nobody.
  const members = await memberMap();

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
  const rows = ((data ?? []) as unknown as MilestoneRecord[]).map((row) =>
    toMilestone(row, members),
  );

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

/**
 * Milestone options for every visible project, keyed by project id.
 *
 * The cross-project lists let a row be edited in place, and a task's milestone
 * select may only offer milestones from that task's own project. One request
 * for all of them beats one per project — `milestones` is small and RLS-scoped.
 */
export async function listMilestoneOptionsByProject(): Promise<
  Map<string, { id: string; title: string }[]>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("milestones")
    .select("id, title, project_id")
    .order("order_index");

  const byProject = new Map<string, { id: string; title: string }[]>();
  for (const row of data ?? []) {
    const list = byProject.get(row.project_id) ?? [];
    list.push({ id: row.id, title: row.title });
    byProject.set(row.project_id, list);
  }

  return byProject;
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
  createdBy: string | null;
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
    createdBy: row.created_by,
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

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export type NotificationRow = {
  id: string;
  kind: "milestone_submitted" | "milestone_approved" | "milestone_rejected";
  body: string;
  projectSlug: string;
  milestoneId: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * The bell's contents: this account's notifications, newest first.
 *
 * RLS does the scoping — `notifications: read own` matches on
 * `recipient_id = auth.uid()` — so there is no user filter here and adding one
 * would only invite the belief that the filter is what protects the table.
 *
 * Capped rather than paginated. A bell is for what happened recently; anything
 * older is a question about a milestone, and the milestone is where it should
 * be asked.
 */
export async function listNotifications(limit = 20): Promise<NotificationRow[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("notifications")
    .select("id, kind, body, milestone_id, read_at, created_at, projects!inner(slug)")
    .order("created_at", { ascending: false })
    .limit(limit);

  type Record = {
    id: string;
    kind: NotificationRow["kind"];
    body: string;
    milestone_id: string | null;
    read_at: string | null;
    created_at: string;
    projects: { slug: string } | { slug: string }[];
  };

  return ((data ?? []) as unknown as Record[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    // PostgREST describes a many-to-one embed as an array in some shapes.
    projectSlug: (Array.isArray(row.projects) ? row.projects[0] : row.projects).slug,
    milestoneId: row.milestone_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

/** How many are unread. Its own query, because it is rendered on every page. */
export async function countUnreadNotifications(): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Public proofs
// ---------------------------------------------------------------------------

export type PublicProof = {
  projectName: string;
  projectSlug: string;
  milestoneId: string;
  title: string;
  status: MilestoneRow["status"];
  dueDate: string | null;
  network: StellarNetwork | null;
  contractId: string | null;
  registeredTx: string | null;
  ownerAddress: string | null;
  anchors: {
    action: MilestoneAnchor["action"];
    proofHash: string | null;
    version: number;
    txHash: string;
    network: StellarNetwork;
    signerAddress: string;
    ledger: number | null;
    createdAt: string;
  }[];
  reviews: {
    fromStatus: MilestoneRow["status"];
    toStatus: MilestoneRow["status"];
    reason: string | null;
    createdAt: string;
  }[];
};

/**
 * One milestone, as a signed-out visitor sees it.
 *
 * Goes through `public_milestone_proof()` rather than the tables. RLS is
 * unchanged and anon holds no membership row, so a direct read returns nothing;
 * the function is a SECURITY DEFINER window with a hand-listed set of columns
 * and a `public_proofs` check, and it is the only way in.
 *
 * Null covers every failure — not published, no such milestone, wrong project.
 * They are the same answer on purpose: distinguishing them would confirm that
 * private work exists.
 */
export async function getPublicProof(
  slug: string,
  milestoneId: string,
): Promise<PublicProof | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("public_milestone_proof", {
    p_slug: slug,
    p_milestone_id: milestoneId,
  });

  if (error || !data) return null;

  return data as unknown as PublicProof;
}
