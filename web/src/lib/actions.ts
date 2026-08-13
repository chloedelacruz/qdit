"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import {
  deploymentSchema,
  milestoneSchema,
  profileSchema,
  classifyMemberIdentifier,
  projectMemberIdentifierSchema,
  projectMemberSchema,
  projectSchema,
  projectUpdateSchema,
  proofSchema,
  taskSchema,
  type ProjectInput,
} from "@/lib/schemas";
import {
  MILESTONE_OWNER_ONLY,
  MILESTONE_STATUS,
  MILESTONE_TRANSITIONS,
  type MilestoneStatus,
} from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/supabase/server";

/**
 * Every mutation returns this shape rather than throwing, so a form can render
 * the failure inline instead of blowing up to an error boundary.
 *
 * These actions re-validate with the same zod schema the client used. The
 * client copy is a convenience; this one is the boundary, because a POST can be
 * made without ever loading the form.
 */
export type ActionState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

function toFieldErrors(error: ZodError): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { fieldErrors };
}

/** Empty strings from a form mean "not set", not "set to empty". */
function orNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

/**
 * Turns a Postgres error into something a person can act on. Anything
 * unrecognised is passed through rather than replaced with a generic message,
 * which would hide the cause.
 */
function friendly(message: string, code?: string): string {
  if (code === "23505") return "That already exists — try a different name or slug.";
  if (code === "42501" || code === "PGRST301") {
    return "You do not have permission to do that in this project.";
  }
  if (code === "23514") return "That value is not allowed by the database constraints.";
  return message;
}

/**
 * Every mutation revalidates the same way.
 *
 * A row shows up on the board, the project overview, the dashboard rollup and
 * the cross-project list at once, so scoping the path would just be guessing
 * which of the four to leave stale.
 */
function revalidateAll(): void {
  revalidatePath("/", "layout");
}

/**
 * Deletes are all the same shape — an id, one table, RLS deciding whether it
 * lands. Returning `{ ok: true }` on a no-op row is deliberate: a delete whose
 * target is already gone got what it asked for.
 */
async function deleteRow(
  table: "tasks" | "projects" | "milestones" | "stellar_proofs" | "deployments",
  id: string,
): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.from(table).delete().eq("id", id);

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

// ---------------------------------------------------------------------------

export async function createTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = taskSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    status: String(formData.get("status") || "todo"),
    priority: String(formData.get("priority") || "medium"),
    milestoneId: String(formData.get("milestoneId") ?? ""),
    assigneeId: String(formData.get("assigneeId") ?? ""),
    dueDate: String(formData.get("dueDate") ?? ""),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert({
    project_id: parsed.data.projectId,
    title: parsed.data.title,
    description: orNull(formData.get("description")),
    status: parsed.data.status,
    priority: parsed.data.priority,
    milestone_id: orNull(formData.get("milestoneId")),
    assignee_id: orNull(formData.get("assigneeId")),
    due_date: orNull(formData.get("dueDate")),
  });

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

export async function updateTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return { error: "Missing task." };

  const parsed = taskSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    status: String(formData.get("status") || "todo"),
    priority: String(formData.get("priority") || "medium"),
    milestoneId: String(formData.get("milestoneId") ?? ""),
    assigneeId: String(formData.get("assigneeId") ?? ""),
    dueDate: String(formData.get("dueDate") ?? ""),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  // project_id is not updatable: moving a task between projects would strand
  // its milestone, which belongs to the old one.
  const { error } = await supabase
    .from("tasks")
    .update({
      title: parsed.data.title,
      description: orNull(formData.get("description")),
      status: parsed.data.status,
      priority: parsed.data.priority,
      milestone_id: orNull(formData.get("milestoneId")),
      assignee_id: orNull(formData.get("assigneeId")),
      due_date: orNull(formData.get("dueDate")),
    })
    .eq("id", taskId);

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

export async function updateTaskStatus(taskId: string, status: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status: status as "todo" | "in_progress" | "done" })
    .eq("id", taskId);

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

/**
 * A drag on the board: the task's new column, plus the order of every card in
 * that column after the drop.
 *
 * Order is sent as the whole column rather than one index because a drop shifts
 * everything below it — writing only the moved row would leave the rest holding
 * stale positions that collide on the next read. `order_index` is what
 * `listBoard` sorts by, so these writes are what make the arrangement stick.
 */
export async function moveTask(
  taskId: string,
  status: string,
  orderedIds: string[],
): Promise<ActionState> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("tasks")
    .update({ status: status as "todo" | "in_progress" | "done" })
    .eq("id", taskId);

  if (error) return { error: friendly(error.message, error.code) };

  // Positions are a nicety: if one fails the card is still in the right column,
  // so a failure here is reported but does not undo the move.
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("tasks").update({ order_index: index }).eq("id", id),
    ),
  );

  const failed = results.find((result) => result.error);

  revalidateAll();

  if (failed?.error) {
    return { error: friendly(failed.error.message, failed.error.code) };
  }

  return { ok: true };
}

export async function deleteTask(taskId: string): Promise<ActionState> {
  return deleteRow("tasks", taskId);
}

export async function createProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = projectSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    status: String(formData.get("status") || "active"),
    repoUrl: String(formData.get("repoUrl") ?? ""),
    demoUrl: String(formData.get("demoUrl") ?? ""),
    docsUrl: String(formData.get("docsUrl") ?? ""),
  } satisfies Record<keyof ProjectInput, string>);

  if (!parsed.success) return toFieldErrors(parsed.error);

  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  const supabase = await createClient();
  // owner_id must be the caller: the projects INSERT policy checks
  // `owner_id = auth.uid()`, and the on_project_created trigger then grants the
  // owner membership row that every other policy keys off.
  const { error } = await supabase.from("projects").insert({
    owner_id: user.id,
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: orNull(formData.get("description")),
    status: parsed.data.status,
    repo_url: orNull(formData.get("repoUrl")),
    demo_url: orNull(formData.get("demoUrl")),
    docs_url: orNull(formData.get("docsUrl")),
  });

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

export async function updateProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project." };

  // projectUpdateSchema, not projectSchema: the slug is fixed after creation.
  const parsed = projectUpdateSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    status: String(formData.get("status") || "active"),
    repoUrl: String(formData.get("repoUrl") ?? ""),
    demoUrl: String(formData.get("demoUrl") ?? ""),
    docsUrl: String(formData.get("docsUrl") ?? ""),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  // Neither owner_id nor slug is in this payload. Transferring ownership is a
  // separate operation, and the slug is in every URL for this project.
  const { error } = await supabase
    .from("projects")
    .update({
      name: parsed.data.name,
      description: orNull(formData.get("description")),
      status: parsed.data.status,
      repo_url: orNull(formData.get("repoUrl")),
      demo_url: orNull(formData.get("demoUrl")),
      docs_url: orNull(formData.get("docsUrl")),
    })
    .eq("id", projectId);

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

export async function deleteProject(projectId: string): Promise<ActionState> {
  return deleteRow("projects", projectId);
}

export async function createMilestone(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = milestoneSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    status: String(formData.get("status") || "proposed"),
    dueDate: String(formData.get("dueDate") ?? ""),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("milestones").insert({
    project_id: parsed.data.projectId,
    title: parsed.data.title,
    description: orNull(formData.get("description")),
    status: parsed.data.status,
    due_date: orNull(formData.get("dueDate")),
  });

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

/**
 * Title, description and due date. Status is deliberately absent — it moves
 * through `updateMilestoneStatus`, which enforces the contract's transitions.
 */
export async function updateMilestone(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const milestoneId = String(formData.get("milestoneId") ?? "");
  if (!milestoneId) return { error: "Missing milestone." };

  const parsed = milestoneSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    status: String(formData.get("status") || "proposed"),
    dueDate: String(formData.get("dueDate") ?? ""),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase
    .from("milestones")
    .update({
      title: parsed.data.title,
      description: orNull(formData.get("description")),
      due_date: orNull(formData.get("dueDate")),
    })
    .eq("id", milestoneId);

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

/**
 * Moves a milestone through the contract's state machine.
 *
 * Every rule checked here is one `milestone_proof` enforces on-chain: the
 * transition must be legal (MILESTONE_TRANSITIONS), and approve/reject require
 * the caller to be the project owner. Postgres enforces none of it, so this
 * function is the only thing keeping the database in a state the contract can
 * later reproduce. When the Soroban call is wired up it goes here, after these
 * checks pass and before the row is written.
 */
export async function updateMilestoneStatus(
  milestoneId: string,
  next: MilestoneStatus,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  const supabase = await createClient();
  const { data: milestone, error: readError } = await supabase
    .from("milestones")
    .select("status, project_id, projects(owner_id)")
    .eq("id", milestoneId)
    .maybeSingle();

  if (readError) return { error: friendly(readError.message, readError.code) };
  if (!milestone) return { error: "That milestone no longer exists." };

  const current = milestone.status as MilestoneStatus;
  if (current === next) return { ok: true };

  if (!MILESTONE_TRANSITIONS[current].includes(next)) {
    return {
      error:
        current === "approved"
          ? "An approved milestone is final and cannot be changed."
          : `A ${MILESTONE_STATUS[current].label.toLowerCase()} milestone cannot become ${MILESTONE_STATUS[next].label.toLowerCase()}.`,
    };
  }

  // `projects` embeds as an object here (many-to-one), but PostgREST's generated
  // types describe it as an array for some shapes — normalise before reading.
  const project = Array.isArray(milestone.projects)
    ? milestone.projects[0]
    : milestone.projects;

  if (MILESTONE_OWNER_ONLY.includes(next) && project?.owner_id !== user.id) {
    return { error: "Only the project owner can approve or reject a milestone." };
  }

  const { error } = await supabase
    .from("milestones")
    .update({ status: next })
    .eq("id", milestoneId);

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

export async function deleteMilestone(milestoneId: string): Promise<ActionState> {
  return deleteRow("milestones", milestoneId);
}

export async function createProof(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = proofSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    milestoneId: String(formData.get("milestoneId") ?? ""),
    contractId: String(formData.get("contractId") ?? ""),
    txHash: String(formData.get("txHash") ?? ""),
    network: String(formData.get("network") || "testnet"),
    walletAddress: String(formData.get("walletAddress") ?? ""),
    proofUrl: String(formData.get("proofUrl") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  const supabase = await createClient();
  const { error } = await supabase.from("stellar_proofs").insert({
    project_id: parsed.data.projectId,
    milestone_id: orNull(formData.get("milestoneId")),
    contract_id: orNull(formData.get("contractId")),
    tx_hash: orNull(formData.get("txHash")),
    network: parsed.data.network,
    wallet_address: orNull(formData.get("walletAddress")),
    proof_url: orNull(formData.get("proofUrl")),
    notes: orNull(formData.get("notes")),
    created_by: user.id,
  });

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

export async function updateProof(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const proofId = String(formData.get("proofId") ?? "");
  if (!proofId) return { error: "Missing proof." };

  const parsed = proofSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    milestoneId: String(formData.get("milestoneId") ?? ""),
    contractId: String(formData.get("contractId") ?? ""),
    txHash: String(formData.get("txHash") ?? ""),
    network: String(formData.get("network") || "testnet"),
    walletAddress: String(formData.get("walletAddress") ?? ""),
    proofUrl: String(formData.get("proofUrl") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  // created_by is left alone: it is who recorded the proof, not who last
  // touched it, and the "update own or as admin" policy keys off it.
  const { error } = await supabase
    .from("stellar_proofs")
    .update({
      milestone_id: orNull(formData.get("milestoneId")),
      contract_id: orNull(formData.get("contractId")),
      tx_hash: orNull(formData.get("txHash")),
      network: parsed.data.network,
      wallet_address: orNull(formData.get("walletAddress")),
      proof_url: orNull(formData.get("proofUrl")),
      notes: orNull(formData.get("notes")),
    })
    .eq("id", proofId);

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

export async function deleteProof(proofId: string): Promise<ActionState> {
  return deleteRow("stellar_proofs", proofId);
}

// ---------------------------------------------------------------------------

/**
 * The deployment log is append-only by design: the latest row for a project is
 * its current state, and the rows before it are the history. So this creates,
 * and there is no update — correcting a release means recording the next one.
 */
export async function createDeployment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = deploymentSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    status: String(formData.get("status") || "not_started"),
    network: String(formData.get("network") ?? ""),
    contractId: String(formData.get("contractId") ?? ""),
    txHash: String(formData.get("txHash") ?? ""),
    releaseNotes: String(formData.get("releaseNotes") ?? ""),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  const supabase = await createClient();
  const { error } = await supabase.from("deployments").insert({
    project_id: parsed.data.projectId,
    status: parsed.data.status,
    network: (orNull(formData.get("network")) as "testnet" | "mainnet" | null) ?? null,
    contract_id: orNull(formData.get("contractId")),
    tx_hash: orNull(formData.get("txHash")),
    release_notes: orNull(formData.get("releaseNotes")),
    deployed_by: user.id,
    deployed_at: new Date().toISOString(),
  });

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

export async function deleteDeployment(deploymentId: string): Promise<ActionState> {
  return deleteRow("deployments", deploymentId);
}

// ---------------------------------------------------------------------------
// Members
//
// `project_members` is what every RLS policy in the app derives from, so these
// three actions are the only writes that can change what anyone else is allowed
// to do. RLS admits an admin to all of them; the extra rules below are the ones
// Postgres does not encode.
// ---------------------------------------------------------------------------

/**
 * Refuses any member write aimed at the project owner.
 *
 * `project_members: update/delete as admin` lets an admin touch *any* row in
 * the project, including the owner's — so without this an admin could demote or
 * remove the one person `projects: delete as owner` and the contract's
 * `approver == owner` check depend on, and nothing could put it back (the
 * bootstrap trigger only fires on project creation).
 *
 * Both records of ownership are consulted, because they are separate columns
 * that can in principle disagree: `projects.owner_id` is what the contract will
 * authenticate, and the `owner` membership row is what `member_role_rank()`
 * orders. Either one is enough to protect the row.
 */
async function ownerBlock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  userId: string,
): Promise<string | null> {
  const [{ data: project }, { data: membership }] = await Promise.all([
    supabase.from("projects").select("owner_id").eq("id", projectId).maybeSingle(),
    supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (project?.owner_id === userId || membership?.role === "owner") {
    return "The project owner's role cannot be changed or revoked.";
  }

  return null;
}

/**
 * Adds someone the caller can already see — a teammate from another project.
 *
 * Kept alongside `addProjectMemberByEmail` because picking a known name beats
 * typing an address, and `profiles` carries no email column, so the picker
 * cannot offer one. In a single-project workspace this path finds nobody by
 * construction (`listAddableMembers()` is the visible set minus the current
 * roster, and the visible set *is* the roster), which is exactly the hole the
 * email path fills.
 */
export async function addProjectMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = projectMemberSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    userId: String(formData.get("userId") ?? ""),
    role: String(formData.get("role") || "member"),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("project_members").insert({
    project_id: parsed.data.projectId,
    user_id: parsed.data.userId,
    role: parsed.data.role,
  });

  // (project_id, user_id) is the primary key, so a duplicate arrives as 23505 —
  // which `friendly()` phrases for names and slugs and would read as nonsense.
  if (error?.code === "23505") {
    return { error: "They are already a member of this project." };
  }
  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

/**
 * Adds someone by username, email address or wallet address — including someone
 * the caller has never shared a project with.
 *
 * The resolution happens inside one of three SECURITY DEFINER functions,
 * because RLS makes a stranger's `profiles` row invisible to every query this
 * client is allowed to make — there is no id to insert. Each of them authorizes
 * the caller as an admin of the target project *before* it looks the identifier
 * up, and performs the insert itself rather than handing back a user id, so
 * none can be turned into a directory. Their headers carry the full argument.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE ACTION AND ONE FIELD RATHER THAN THREE OF EACH
 * ---------------------------------------------------------------------------
 * The three formats are mutually exclusive by construction — see
 * `classifyMemberIdentifier` — so the server can tell what it was given. Asking
 * an admin to pick "by email / by wallet / by username" before they may paste
 * something is asking them to classify it on the app's behalf, and they can
 * already see what they are holding.
 *
 * Which one is *primary* has moved once already and would have moved again:
 * `member_invite_by_wallet` made the wallet address primary on the grounds that
 * it was the only universal identifier, which registration then made false.
 * Dispatching on shape means there is no primary to get wrong.
 *
 * The failures below are the ones a user can act on, so each gets its own
 * sentence rather than a generic "could not add member". They are distinguished
 * by SQLSTATE rather than by message text, which is free to be reworded.
 */
export async function addProjectMemberByIdentifier(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = projectMemberIdentifierSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    identifier: String(formData.get("identifier") ?? ""),
    role: String(formData.get("role") || "member"),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const subject = classifyMemberIdentifier(parsed.data.identifier);

  if (subject.kind === "invalid") {
    return { fieldErrors: { identifier: subject.message } };
  }

  const supabase = await createClient();

  // One call per shape. The argument names differ, so this is a switch rather
  // than a lookup table — and a table would have to be typed as the union of
  // three Args shapes to satisfy the generated client anyway.
  const { error } =
    subject.kind === "wallet"
      ? await supabase.rpc("add_project_member_by_wallet", {
          p_project_id: parsed.data.projectId,
          p_address: subject.value,
          p_role: parsed.data.role,
        })
      : subject.kind === "email"
        ? await supabase.rpc("add_project_member_by_email", {
            p_project_id: parsed.data.projectId,
            p_email: subject.value,
            p_role: parsed.data.role,
          })
        : await supabase.rpc("add_project_member_by_username", {
            p_project_id: parsed.data.projectId,
            p_username: subject.value,
            p_role: parsed.data.role,
          });

  if (error) {
    // 42501 insufficient_privilege — not an admin of this project.
    if (error.code === "42501") {
      return { error: "You need admin rights on this project to add members." };
    }

    // P0002 no_data_found — the identifier resolved to nobody. Named by kind,
    // because "no account matches that" leaves the admin wondering whether the
    // app even understood which of the three they typed.
    if (error.code === "P0002") {
      const missing = {
        wallet: "No qdit account has linked that wallet address.",
        email: "No qdit account uses that email. They need to sign up first.",
        username: "No qdit account uses that username.",
      } as const;

      return { fieldErrors: { identifier: missing[subject.kind] } };
    }

    // 22023 invalid_parameter_value — the function's own shape check. Reachable
    // only if this file and the migrations disagree about what a valid
    // identifier looks like, which is worth surfacing rather than hiding.
    if (error.code === "22023") {
      return { fieldErrors: { identifier: friendly(error.message, error.code) } };
    }

    // 23505 unique_violation — (project_id, user_id) is the primary key.
    if (error.code === "23505") {
      return { error: "They are already a member of this project." };
    }

    return { error: friendly(error.message, error.code) };
  }

  revalidateAll();
  return { ok: true };
}

export async function updateProjectMemberRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = projectMemberSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    userId: String(formData.get("userId") ?? ""),
    role: String(formData.get("role") || "member"),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  // Self-demotion is the other way to lock a project's administration out:
  // `admin` is the minimum for this whole surface, so an admin who set
  // themselves to `viewer` could not undo it.
  if (user.id === parsed.data.userId) {
    return { error: "You cannot change your own role. Ask an admin or the owner." };
  }

  const supabase = await createClient();
  const blocked = await ownerBlock(supabase, parsed.data.projectId, parsed.data.userId);
  if (blocked) return { error: blocked };

  const { error } = await supabase
    .from("project_members")
    .update({ role: parsed.data.role })
    .eq("project_id", parsed.data.projectId)
    .eq("user_id", parsed.data.userId);

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

/**
 * Not `deleteRow()`: `project_members` has a composite primary key, so it is
 * matched on both columns rather than on an `id`.
 */
export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  if (user.id === userId) {
    return { error: "You cannot remove yourself from a project you administer." };
  }

  const supabase = await createClient();
  const blocked = await ownerBlock(supabase, projectId, userId);
  if (blocked) return { error: blocked };

  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", userId);

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

// ---------------------------------------------------------------------------

/**
 * The caller's own profile. `profiles: update own` is the policy, so this needs
 * no role check — RLS cannot be talked into writing anyone else's row.
 *
 * ---------------------------------------------------------------------------
 * THE WALLET ADDRESS IS NOT HERE ANY MORE
 * ---------------------------------------------------------------------------
 * It used to be: `EditProfileDialog` had a free-text `G…` box and this action
 * wrote whatever came out of it. Typing an address claims one; signing a
 * challenge proves one — and every address on every profile is now a proved
 * one, because the only things that write the column are registration and the
 * one-time link in `linkWalletToProfile`.
 *
 * Dropping it from the *action* and not merely from the form is the same
 * defence `projectMemberSchema` applies to the `owner` role: a hand-made POST
 * cannot set what is never read. And below both,
 * `profiles_freeze_wallet_address` refuses the write outright, so this is the
 * polite layer rather than the load-bearing one.
 *
 * `profileSchema.walletAddress` stays. The server still validates the shape of
 * an address elsewhere; nothing feeds it from a form.
 */
export async function updateProfile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = profileSchema.safeParse({
    displayName: String(formData.get("displayName") ?? ""),
  });

  if (!parsed.success) return toFieldErrors(parsed.error);

  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName })
    .eq("id", user.id);

  if (error) return { error: friendly(error.message, error.code) };

  revalidateAll();
  return { ok: true };
}

/*
 * `saveWalletAddress()` was here and is deleted.
 *
 * It took a bare address and wrote it to the caller's profile — no signature,
 * no proof, just whatever the wallet kit had reported. Its own comment argued
 * that a form field would be "the only way it could be wrong", which was true
 * of typos and silent about everything else: the address was a claim either
 * way, and the account it named did not have to belong to the person claiming
 * it.
 *
 * Its replacement is `POST /api/auth/wallet/verify` with `intent: "link"`,
 * which accepts the same address only when it arrives inside a signed
 * challenge, and only once per account.
 */
