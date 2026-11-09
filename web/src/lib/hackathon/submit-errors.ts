import type { ActionState } from "@/lib/actions";

/**
 * `submit_hackathon_entry()`'s errors, in plain words (WP-4.7, QDIT-47).
 *
 * The codes are the ones in the header of 20261110100000_hackathons.sql:
 *
 *   42501  not allowed (not the project's owner or admin, or not a
 *          first-party session)
 *   P0002  no such hackathon, or no such project for this caller
 *   QD409  MESSAGE is the reason: hackathon_not_open | hackathon_closed |
 *          member_on_other_team, DETAIL a sentence
 *   QD413  snapshot_too_large
 *   22023  HINT names the field: team_name | member_ids | image_paths
 *
 * Field errors use the dialog's keys (`teamName`, `memberIds`, `images`).
 * Kept out of `actions.ts`, whose "use server" exports must all be actions.
 */

export type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const HINT_FIELD: Record<string, string> = {
  team_name: "teamName",
  member_ids: "memberIds",
  image_paths: "images",
};

/** The usernames in "Already on another team in this hackathon: ada, lin.", or []. */
export function namesOnOtherTeam(details: string | null | undefined): string[] {
  const match = /^Already on another team in this hackathon: (.+?)\.?$/.exec(details ?? "");
  if (!match) return [];
  return match[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function otherTeamMessage(names: string[]): string {
  if (names.length === 0) {
    return "A team member just joined another team in this hackathon. Check the team and submit again.";
  }
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "is" : "are";
  return `${list} ${verb} already on another team in this hackathon. A person can be on one team only.`;
}

function fieldMessage(field: string, message: string): string {
  // The image errors name the storage path, which means nothing to a person.
  if (field === "images" && /^Image /.test(message)) {
    return "An image did not finish uploading for this project. Remove it and attach it again.";
  }
  return message;
}

export function submitErrorState(error: PostgrestLikeError): ActionState {
  const code = error.code ?? "";
  const message = error.message ?? "";

  if (code === "42501") {
    return { error: "Only the project's owner or an admin can submit it to the hackathon." };
  }

  if (code === "P0002") {
    return {
      error: "That hackathon or project was not found. It may have been removed, or you are no longer a member.",
    };
  }

  if (code === "QD409") {
    if (message === "hackathon_not_open") {
      return { error: "This hackathon is not open yet. Submit once it opens." };
    }
    if (message === "hackathon_closed") {
      return { error: "Submissions for this hackathon are closed." };
    }
    if (message === "member_on_other_team") {
      return { fieldErrors: { memberIds: otherTeamMessage(namesOnOtherTeam(error.details)) } };
    }
  }

  if (code === "QD413") {
    return {
      error:
        "This project is too large to submit (over 2 MB). Shorten long task and milestone descriptions, then submit again.",
    };
  }

  if (code === "22023") {
    const field = HINT_FIELD[error.hint ?? ""];
    if (field) return { fieldErrors: { [field]: fieldMessage(field, message) } };
    if (message) return { error: message };
  }

  return { error: "The submission did not go through. Try again in a moment." };
}
