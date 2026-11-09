/**
 * Plain copy for every error the hackathon staff RPCs raise (WP-4.7,
 * QDIT-48). The SQL contract (20261110100000_hackathons.sql, "ERRORS THE APP
 * MAPS"): 42501 not allowed, P0002 not found, 22023 invalid argument with the
 * parameter in HINT, QD409 a state conflict with the machine token in MESSAGE
 * and a sentence in DETAIL.
 *
 * Every token has its own sentence here, written for the admin or judge
 * looking at the screen, saying what to do next. A code nobody mapped gets a
 * generic sentence with the code, never the raw database message.
 */

export interface RpcError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/** QD409 tokens, by MESSAGE. Kept complete: the test walks this list against the migration. */
export const CONFLICT_COPY: Readonly<Record<string, string>> = {
  hackathon_not_open: "This hackathon has not opened yet.",
  hackathon_closed: "This hackathon is closed for that project.",
  member_on_other_team: "A team member is already on another team in this hackathon.",
  member_is_staff: "A team member is staff of this hackathon. Staff cannot be on a team.",
  staff_on_team: "That person is on a team in this hackathon, so they cannot be staff. Remove them from the team first.",
  snapshot_conflict: "doqtri sent a different snapshot with the same id.",
  snapshot_limit: "This project has sent the most doqtri snapshots allowed for this hackathon.",
  hackathon_not_closed: "The hackathon has not closed yet. Grades can be released once it closes.",
  already_released: "Grades are already released. That can no longer be changed.",
  grading_incomplete: "Grading is not finished.",
  late_pass_active: "A late pass is still running. Wait for it to end, or end it now from the submissions table, then release.",
  grades_not_released: "Grades are sealed until an admin releases them.",
  not_finalist: "Only finalists can be scored.",
  last_admin: "A hackathon keeps at least one admin. Make someone else an admin first.",
  regrade_limit: "This version has been regraded as many times as allowed.",
};

/** 22023 by HINT. */
export const ARGUMENT_COPY: Readonly<Record<string, string>> = {
  reason: "Say why, in 1 to 500 characters.",
  until: "Choose when the late pass ends.",
  role: "Choose admin or judge.",
  submission_ids: "The pitch order must list every finalist once. Reload and try again.",
  scores: "Each score is a whole number from 1 to 5.",
  note: "Keep the note to 2,000 characters.",
  team_name: "Team names are 1 to 80 characters.",
  member_ids: "Check the team members.",
  image_paths: "Check the uploaded images.",
};

/** SQL's DETAIL for grading_incomplete: "N entries still grading" (entries, never runs). */
const ENTRIES_STILL_GRADING = /^(\d+) (entry|entries) still grading\.?$/;

/**
 * Generic copy plus the entry count from DETAIL. The DETAIL is used only
 * when it is the entry-count sentence: per-run counts would say how many
 * runs an entry has, which hints at a third run and so at disagreement
 * (D-116), so anything else falls back to the generic sentence.
 */
export function gradingIncompleteCopy(details: string | null | undefined): string {
  const m = ENTRIES_STILL_GRADING.exec((details ?? "").trim());
  const tail = "Release anyway only if you accept that those entries may miss the finals.";
  return m
    ? `${CONFLICT_COPY.grading_incomplete} ${m[1]} ${m[1] === "1" ? "entry" : "entries"} still grading. ${tail}`
    : `${CONFLICT_COPY.grading_incomplete} ${tail}`;
}

/** Override after release: the generic already_released, said for eligibility. */
export const OVERRIDE_RELEASED_COPY = "Grades are released, so eligibility can no longer be changed.";

export function staffErrorMessage(error: RpcError): string {
  const code = error.code ?? "";
  const message = (error.message ?? "").trim();

  if (code === "QD409") {
    if (message === "grading_incomplete") return gradingIncompleteCopy(error.details);
    return CONFLICT_COPY[message] ?? "That cannot be done right now. Reload the page and try again.";
  }
  if (code === "QD413") {
    return message === "payload_too_large"
      ? "The doqtri snapshot is over 2 MiB."
      : "The project is too large to snapshot, even with long text clipped.";
  }
  if (code === "22023") {
    return (error.hint && ARGUMENT_COPY[error.hint]) || "Check the values and try again.";
  }
  if (code === "42501" || code === "PGRST301") {
    return "You are not allowed to do that here. Only this hackathon's staff can.";
  }
  if (code === "P0002") {
    if (/username/i.test(message)) return "No account uses that username.";
    if (/hackathon/i.test(message)) return "That hackathon no longer exists.";
    if (/project/i.test(message)) return "That project no longer exists.";
    return "That entry no longer exists. Reload the page.";
  }
  if (code === "PGRST116") return "That entry no longer exists. Reload the page.";
  return `Something went wrong${code ? ` (${code})` : ""}. Try again.`;
}
