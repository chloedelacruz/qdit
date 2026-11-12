"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import type { ActionState } from "@/lib/actions";
import { checkEntry } from "@/lib/hackathon/entry-check";
import { MINDMAP_LINK_DEAD_ERROR } from "@/lib/hackathon/mindmap-link";
import { checkMindmapLinks } from "@/lib/hackathon/mindmap-link-status";
import { runGradingFor } from "@/lib/hackathon/grading-worker";
import {
  readSubmitForm,
  submitEntrySchema,
  submitTargetSchema,
  type SubmitEntry,
} from "@/lib/hackathon/schemas";
import { submitErrorState } from "@/lib/hackathon/submit-errors";
import { fieldErrorsOf } from "@/lib/schemas";

/**
 * The follow-up's own budget. `after()` runs inside the page's
 * `maxDuration = 300`; 200 s leaves room for the action itself and for the
 * worker to settle what it started. Anything unfinished is picked up again
 * by the minute sweep once its lease runs out.
 */
const FOLLOW_UP_BUDGET_MS = 200_000;
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
  const checked = await validateEntry(formData);
  if (!checked.ok) return checked.state;
  const { supabase, hackathon, entry } = checked;

  const { data: versionId, error } = await supabase.rpc("submit_hackathon_entry", {
    p_hackathon_id: entry.hackathonId,
    p_project_id: entry.projectId,
    p_team_name: entry.teamName,
    p_member_ids: entry.memberIds,
    p_image_paths: entry.imagePaths,
    p_slides_url: entry.slidesUrl,
    // "" is no link (QDIT-66); the function stores null for it.
    p_mindmap_url: entry.mindmapUrl,
  });

  if (error) return submitErrorState(error);
  if (typeof versionId !== "string") {
    return { error: "The submission did not go through. Try again in a moment." };
  }

  after(() => startFollowUp(versionId));

  revalidatePath(`/hackathons/${hackathon.slug}`);
  return { ok: true };
}

type ValidatedEntry =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      hackathon: { id: string; slug: string; opens_at: string; closes_at: string; team_min: number; team_max: number };
      entry: SubmitEntry;
    }
  | { ok: false; state: ActionState };

/** The dialog's fields, checked with the hackathon's own team size. Shared by submit and the check. */
async function validateEntry(formData: FormData): Promise<ValidatedEntry> {
  const user = await getUser();
  if (!user) return { ok: false, state: { error: "Sign in to submit." } };

  const input = readSubmitForm(formData);

  const target = submitTargetSchema.safeParse(input);
  if (!target.success) return { ok: false, state: { fieldErrors: fieldErrorsOf(target.error) } };

  const supabase = await createClient();

  const { data: hackathon } = await supabase
    .from("hackathons")
    .select("id, slug, opens_at, closes_at, team_min, team_max")
    .eq("id", target.data.hackathonId)
    .maybeSingle();
  if (!hackathon) return { ok: false, state: { error: "That hackathon was not found." } };

  const parsed = submitEntrySchema({
    teamMin: hackathon.team_min,
    teamMax: hackathon.team_max,
  }).safeParse(input);
  if (!parsed.success) return { ok: false, state: { fieldErrors: fieldErrorsOf(parsed.error) } };

  // A Mindmap link doqtri says is revoked or expired is refused before
  // anything is submitted (QDIT-67). Unknown (doqtri slow or down, at most
  // 2 s) lets it through, as before.
  const link = parsed.data.mindmapUrl;
  if (link !== "") {
    const statuses = await checkMindmapLinks([link]);
    if (statuses.get(link) === "dead") {
      return { ok: false, state: { fieldErrors: { mindmapUrl: MINDMAP_LINK_DEAD_ERROR } } };
    }
  }

  return { ok: true, supabase, hackathon, entry: parsed.data };
}

/**
 * The pre-submit check (QDIT-55): the eligibility gate on what a submit would
 * freeze right now. Writes nothing. Returns `entryCheck` (never `ok`),
 * or the same errors a submit would give for the same fields and checks.
 */
export async function checkHackathonEntry(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const checked = await validateEntry(formData);
  if (!checked.ok) return checked.state;
  const { supabase, hackathon, entry } = checked;

  const { data: preview, error } = await supabase.rpc("preview_hackathon_entry", {
    p_hackathon_id: entry.hackathonId,
    p_project_id: entry.projectId,
  });
  if (error) return submitErrorState(error);

  try {
    const entryCheck = await checkEntry({
      window: hackathon,
      memberIds: entry.memberIds,
      hasGlobalMindmapImage: entry.imagePaths.length > 0,
      preview,
    });
    return { entryCheck };
  } catch {
    console.error(`hackathon check: the preview for project ${entry.projectId} could not be read`);
    // The dialog submits on any error that is not a field error (check-then-submit.ts).
    return { error: "Couldn't check the entry right now." };
  }
}

/**
 * Never throws and never logs submission content: a failure here is picked up
 * by the minute sweep, so the version id is all the log needs.
 */
async function startFollowUp(versionId: string): Promise<void> {
  try {
    // `undefined` keeps the worker's default (production) dependencies.
    await runGradingFor(versionId, undefined, { budgetMs: FOLLOW_UP_BUDGET_MS });
  } catch {
    console.error(`hackathon submit: follow-up for version ${versionId} did not start`);
  }
}
