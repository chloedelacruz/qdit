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

/** The hint when no snapshot has arrived: there is nothing to resend yet. */
export const FIRST_SEND_HINT =
  "In doqtri, open the global mindmap and use Send to qdit hackathon, then Check again.";

/** What to do about the doqtri items, worded for whether a snapshot has arrived. */
export function doqtriHint(check: EntryCheck): string {
  return check.doqtri ? RESEND_HINT : FIRST_SEND_HINT;
}

/**
 * The checklist in two groups: what qdit reads from the project, and what it
 * reads from the doqtri snapshot. Rule order is kept within each group.
 */
export function groupEntryRules(check: EntryCheck): { qdit: EntryCheckRule[]; doqtri: EntryCheckRule[] } {
  return {
    qdit: check.rules.filter((r) => !DOQTRI_RULES.has(r.id)),
    doqtri: check.rules.filter((r) => DOQTRI_RULES.has(r.id)),
  };
}

/**
 * A rule's reason as the checklist shows it, or null when it would only
 * repeat the group's own line (every doqtri item says "no snapshot" when none
 * has arrived, and the group already says so once).
 */
export function ruleDetail(rule: EntryCheckRule, check: EntryCheck): string | null {
  if (!check.doqtri && DOQTRI_RULES.has(rule.id) && rule.passed === false) return null;
  return rule.reason;
}

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
