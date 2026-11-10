import { HACKATHON_TIMEZONE, type EntryCheck, type EntryCheckRule } from "@/lib/hackathon/types";

type RuleId = EntryCheckRule["id"];

/**
 * Wording for the submission dialog's pre-submit check (QDIT-55). Client-safe:
 * the check itself is server-only (`entry-check.ts`).
 */

export const CHAIN_RULES: ReadonlySet<RuleId> = new Set(["notes_on_chain", "milestones_on_chain"]);

/** The rules read from the doqtri snapshot, which is only as new as the last push. */
export const DOQTRI_RULES: ReadonlySet<RuleId> = new Set([
  "notes_during_event",
  "notes_connected",
  "notes_on_chain",
]);

export const CHAIN_UNCHECKED_REASON = "Couldn't check on-chain anchoring right now";

export const RESEND_HINT =
  "qdit reads your notes from the last snapshot doqtri sent. To include newer notes, use Send to qdit hackathon in doqtri again, then Check again.";

/** Some doqtri rule did not pass (or could not be checked): the snapshot line and resend hint are worth showing. */
export function needsDoqtriHint(check: EntryCheck): boolean {
  return check.rules.some((r) => DOQTRI_RULES.has(r.id) && r.passed !== true);
}

/** "Checked the doqtri snapshot from 10:42 (6 notes)." in the event's own zone, or that none arrived. */
export function doqtriSnapshotLine(doqtri: EntryCheck["doqtri"], timeZone: string = HACKATHON_TIMEZONE): string {
  if (!doqtri) return "No doqtri snapshot has arrived for this project yet.";
  const at = new Date(doqtri.receivedAt);
  const time = Number.isNaN(at.getTime())
    ? "an unknown time"
    : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(at);
  const notes = `${doqtri.noteCount} ${doqtri.noteCount === 1 ? "note" : "notes"}`;
  return `Checked the doqtri snapshot from ${time} (${notes}).`;
}
