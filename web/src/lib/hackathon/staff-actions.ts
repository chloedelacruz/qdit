"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionState } from "@/lib/actions";
import { staffErrorMessage, type RpcError } from "@/lib/hackathon/staff-errors";
import { manilaLocalToIso } from "@/lib/hackathon/staff-view";
import { MAX_JUDGE_SCORE, MIN_JUDGE_SCORE } from "@/lib/hackathon/leaderboard";
import { createClient } from "@/lib/supabase/server";

/**
 * Mutations for the hackathon staff consoles (WP-4.7, QDIT-48; D-115, D-116,
 * D-119). Each one re-validates its input, calls one RPC as the caller, and
 * turns every SQLSTATE and QD409 token into a sentence (staff-errors.ts).
 * The RPCs are the boundary: they check first-party session, staff role and
 * release state themselves; nothing here is trusted to.
 */

export type StaffActionState = ActionState & {
  /** Release only: the RPC said grading_incomplete, so the dialog may offer "allow incomplete". */
  needsAllowIncomplete?: boolean;
  /** Release only: how many finalists the release wrote. */
  finalists?: number;
};

const uuid = z.guid("That entry is not valid. Reload the page.");

function fail(error: RpcError): StaffActionState {
  const state: StaffActionState = { error: staffErrorMessage(error) };
  if (error.code === "QD409" && error.message === "grading_incomplete") state.needsAllowIncomplete = true;
  return state;
}

function revalidate(): void {
  revalidatePath("/hackathons", "layout");
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/* -------------------------------------------------------------------------- */
/* Eligibility override                                                       */
/* -------------------------------------------------------------------------- */

const overrideSchema = z
  .object({
    submissionId: uuid,
    value: z.enum(["true", "false", "clear"], { message: "Choose eligible, not eligible or clear." }),
    reason: z.string().max(500, "Keep the reason to 500 characters."),
  })
  .refine((v) => v.value === "clear" || v.reason.length > 0, {
    path: ["reason"],
    message: "Say why you are overriding the rules.",
  });

export async function setEligibilityOverride(
  _prev: StaffActionState,
  formData: FormData,
): Promise<StaffActionState> {
  const parsed = overrideSchema.safeParse({
    submissionId: text(formData, "submissionId"),
    value: text(formData, "value"),
    reason: text(formData, "reason"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const { submissionId, value, reason } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_eligibility_override", {
    p_submission_id: submissionId,
    p_value: value === "clear" ? null : value === "true",
    p_reason: value === "clear" ? null : reason,
  });
  if (error) return fail(error);

  revalidate();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Regrade                                                                    */
/* -------------------------------------------------------------------------- */

export async function regradeSubmission(submissionId: string): Promise<StaffActionState> {
  const parsed = uuid.safeParse(submissionId);
  if (!parsed.success) return { error: "That entry is not valid. Reload the page." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("regrade_submission", { p_submission_id: parsed.data });
  if (error) return fail(error);

  revalidate();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Late pass                                                                  */
/* -------------------------------------------------------------------------- */

export async function grantLatePass(_prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  const hackathonId = uuid.safeParse(text(formData, "hackathonId"));
  const projectId = uuid.safeParse(text(formData, "projectId"));
  if (!hackathonId.success || !projectId.success) {
    return { error: "That entry is not valid. Reload the page." };
  }
  const until = manilaLocalToIso(text(formData, "until"));
  if (!until) return { fieldErrors: { until: "Choose a date and time (Manila)." } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_late_pass", {
    p_hackathon_id: hackathonId.data,
    p_project_id: projectId.data,
    p_until: until,
  });
  if (error) return fail(error);

  revalidate();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Staff                                                                      */
/* -------------------------------------------------------------------------- */

const staffSchema = z.object({
  hackathonId: uuid,
  username: z
    .string()
    .min(1, "Enter a username.")
    .max(64, "That username is too long.")
    .transform((u) => u.replace(/^@/, "").toLowerCase()),
  role: z.enum(["admin", "judge"], { message: "Choose admin or judge." }),
});

export async function addHackathonStaff(_prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  const parsed = staffSchema.safeParse({
    hackathonId: text(formData, "hackathonId"),
    username: text(formData, "username"),
    role: text(formData, "role"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_hackathon_staff", {
    p_hackathon_id: parsed.data.hackathonId,
    p_username: parsed.data.username,
    p_role: parsed.data.role,
  });
  if (error) return fail(error);

  revalidate();
  return { ok: true };
}

export async function removeHackathonStaff(hackathonId: string, username: string): Promise<StaffActionState> {
  const id = uuid.safeParse(hackathonId);
  const name = username.trim().replace(/^@/, "").toLowerCase();
  if (!id.success || name === "") return { error: "That staff member is not valid. Reload the page." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_hackathon_staff", {
    p_hackathon_id: id.data,
    p_username: name,
    p_role: null,
  });
  if (error) return fail(error);

  revalidate();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Release grades                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Irreversible (D-116). The typed slug is checked against the hackathon's
 * own, read here rather than taken from the form. `allowIncomplete` is sent
 * only once the RPC has said grading_incomplete and the admin ticked it.
 */
export async function releaseGrades(_prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  const hackathonId = uuid.safeParse(text(formData, "hackathonId"));
  if (!hackathonId.success) return { error: "That hackathon is not valid. Reload the page." };
  const typed = text(formData, "confirmSlug");
  const allowIncomplete = formData.get("allowIncomplete") === "on";

  const supabase = await createClient();
  const { data: hackathon, error: readError } = await supabase
    .from("hackathons")
    .select("slug")
    .eq("id", hackathonId.data)
    .maybeSingle();
  if (readError) return fail(readError);
  if (!hackathon) return { error: "No such hackathon." };
  if (typed !== hackathon.slug) {
    return { fieldErrors: { confirmSlug: `Type ${hackathon.slug} exactly to confirm.` } };
  }

  const { data, error } = await supabase.rpc("release_hackathon_grades", {
    p_hackathon_id: hackathonId.data,
    p_allow_incomplete: allowIncomplete,
  });
  if (error) return fail(error);

  revalidate();
  return { ok: true, finalists: typeof data === "number" ? data : 0 };
}

/* -------------------------------------------------------------------------- */
/* Pitch order                                                                */
/* -------------------------------------------------------------------------- */

export async function savePitchOrder(hackathonId: string, submissionIds: string[]): Promise<StaffActionState> {
  const parsed = z.object({ hackathonId: uuid, ids: z.array(uuid).min(1).max(100) }).safeParse({
    hackathonId,
    ids: submissionIds,
  });
  if (!parsed.success || new Set(submissionIds).size !== submissionIds.length) {
    return { error: "The pitch order must list every finalist once. Reload and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_pitch_order", {
    p_hackathon_id: parsed.data.hackathonId,
    p_submission_ids: parsed.data.ids,
  });
  if (error) return fail(error);

  revalidate();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Judge score                                                                */
/* -------------------------------------------------------------------------- */

const scoreField = z.coerce
  .number({ message: `Choose ${MIN_JUDGE_SCORE} to ${MAX_JUDGE_SCORE}.` })
  .int(`Choose a whole number from ${MIN_JUDGE_SCORE} to ${MAX_JUDGE_SCORE}.`)
  .min(MIN_JUDGE_SCORE, `Choose ${MIN_JUDGE_SCORE} to ${MAX_JUDGE_SCORE}.`)
  .max(MAX_JUDGE_SCORE, `Choose ${MIN_JUDGE_SCORE} to ${MAX_JUDGE_SCORE}.`);

const judgeSchema = z.object({
  submissionId: uuid,
  clarity: scoreField,
  structure: scoreField,
  accuracy: scoreField,
  connections: scoreField,
  pitch: scoreField,
  note: z.string().max(2000, "Keep the note to 2,000 characters."),
});

export async function saveJudgeScore(_prev: StaffActionState, formData: FormData): Promise<StaffActionState> {
  const raw = (key: string) => {
    const v = text(formData, key);
    // Empty is "not chosen", not zero (z.coerce would read "" as 0).
    return v === "" ? undefined : v;
  };
  const parsed = judgeSchema.safeParse({
    submissionId: text(formData, "submissionId"),
    clarity: raw("clarity"),
    structure: raw("structure"),
    accuracy: raw("accuracy"),
    connections: raw("connections"),
    pitch: raw("pitch"),
    note: text(formData, "note"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_judge_score", {
    p_submission_id: d.submissionId,
    p_clarity: d.clarity,
    p_structure: d.structure,
    p_accuracy: d.accuracy,
    p_connections: d.connections,
    p_pitch: d.pitch,
    p_note: d.note === "" ? null : d.note,
  });
  if (error) return fail(error);

  revalidate();
  return { ok: true };
}

/* -------------------------------------------------------------------------- */

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
