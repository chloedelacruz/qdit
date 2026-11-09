"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import type { ActionState } from "@/lib/actions";
import { runGradingFor } from "@/lib/hackathon/grading-worker";
import {
  readSubmitForm,
  submitEntrySchema,
  submitTargetSchema,
} from "@/lib/hackathon/schemas";
import { submitErrorState } from "@/lib/hackathon/submit-errors";
import { fieldErrorsOf } from "@/lib/schemas";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * "Add submission to hackathon" (WP-4.7, QDIT-47, D-115).
 *
 * Validates the dialog's fields with the hackathon's own team size, then calls
 * `submit_hackathon_entry`, which re-checks all of it and freezes the project.
 * The images are already in Storage: the browser uploaded them straight to the
 * bucket, because a Server Action body is capped at 1 MB.
 *
 * On success the follow-up work for the new version is started in `after()`,
 * so the person gets "Received" without waiting for it. The page sets
 * `maxDuration = 300`, which is the budget `after()` runs in here. Whatever
 * that work does, it never reaches this response: the result is `ok` only.
 */
export async function submitHackathonEntry(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "Sign in to submit." };

  const input = readSubmitForm(formData);

  const target = submitTargetSchema.safeParse(input);
  if (!target.success) return { fieldErrors: fieldErrorsOf(target.error) };

  const supabase = await createClient();

  const { data: hackathon } = await supabase
    .from("hackathons")
    .select("id, slug, team_min, team_max")
    .eq("id", target.data.hackathonId)
    .maybeSingle();
  if (!hackathon) return { error: "That hackathon was not found." };

  const parsed = submitEntrySchema({
    teamMin: hackathon.team_min,
    teamMax: hackathon.team_max,
  }).safeParse(input);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const entry = parsed.data;
  const { data: versionId, error } = await supabase.rpc("submit_hackathon_entry", {
    p_hackathon_id: entry.hackathonId,
    p_project_id: entry.projectId,
    p_team_name: entry.teamName,
    p_member_ids: entry.memberIds,
    p_image_paths: entry.imagePaths,
  });

  if (error) return submitErrorState(error);
  if (typeof versionId !== "string") {
    return { error: "The submission did not go through. Try again in a moment." };
  }

  after(() => startFollowUp(versionId));

  revalidatePath(`/hackathons/${hackathon.slug}`);
  return { ok: true };
}

/**
 * Never throws and never logs submission content: a failure here is picked up
 * by the minute sweep, so the version id is all the log needs.
 */
async function startFollowUp(versionId: string): Promise<void> {
  try {
    await runGradingFor(versionId);
  } catch {
    console.error(`hackathon submit: follow-up for version ${versionId} did not start`);
  }
}
