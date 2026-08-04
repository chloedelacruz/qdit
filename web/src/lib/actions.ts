"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import {
  milestoneSchema,
  projectSchema,
  proofSchema,
  taskSchema,
  type ProjectInput,
} from "@/lib/schemas";
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

// ---------------------------------------------------------------------------

export async function createTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = taskSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    status: String(formData.get("status") || "todo"),
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
    milestone_id: orNull(formData.get("milestoneId")),
    assignee_id: orNull(formData.get("assigneeId")),
    due_date: orNull(formData.get("dueDate")),
  });

  if (error) return { error: friendly(error.message, error.code) };

  // The task appears on the board, the project overview, the dashboard rollup
  // and /tasks — revalidate the whole tree rather than guessing.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateTaskStatus(taskId: string, status: string): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status: status as "todo" | "in_progress" | "done" })
    .eq("id", taskId);

  if (error) return { error: friendly(error.message, error.code) };

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function createProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = projectSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    status: String(formData.get("status") || "active"),
    repoUrl: String(formData.get("repoUrl") ?? ""),
    demoUrl: String(formData.get("demoUrl") ?? ""),
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
  });

  if (error) return { error: friendly(error.message, error.code) };

  revalidatePath("/", "layout");
  return { ok: true };
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

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function createProof(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = proofSchema.safeParse({
    projectId: String(formData.get("projectId") ?? ""),
    milestoneId: String(formData.get("milestoneId") ?? ""),
    contractId: String(formData.get("contractId") ?? ""),
    txHash: String(formData.get("txHash") ?? ""),
    network: String(formData.get("network") || "testnet"),
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
    proof_url: orNull(formData.get("proofUrl")),
    notes: orNull(formData.get("notes")),
    created_by: user.id,
  });

  if (error) return { error: friendly(error.message, error.code) };

  revalidatePath("/", "layout");
  return { ok: true };
}
