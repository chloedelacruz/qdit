import { isMindmapPathFor } from "@/lib/hackathon/schemas";

/**
 * Small rules the submit dialog applies to what it starts from (QDIT-47).
 */

/**
 * The saved team, minus anyone who has since left the project. Submitting
 * them would only fail ("Every team member must be a member of the
 * project."), and the person could not untick a name the list no longer
 * shows.
 */
export function rosterMembers(
  memberIds: readonly string[],
  roster: readonly { id: string }[],
): { kept: string[]; removed: number } {
  const inRoster = new Set(roster.map((member) => member.id));
  const kept = memberIds.filter((id) => inRoster.has(id));
  return { kept, removed: memberIds.length - kept.length };
}

/** "1 former member removed from the team list.", or null for none. */
export function formerMembersNote(removed: number): string | null {
  if (removed <= 0) return null;
  return `${removed} former ${removed === 1 ? "member" : "members"} removed from the team list.`;
}

/**
 * Whether an upload that just finished may still land in the form. An upload
 * started for one project can finish after the person picked another, or
 * after the dialog closed; its path then belongs to a project this form is
 * not submitting, so it is dropped. (The object stays in Storage: the bucket
 * allows no delete, and an unused object is never part of an entry.)
 */
export function acceptsUpload(
  value: { path: string } | null,
  hackathonId: string,
  selectedProjectId: string,
  dialogOpen: boolean,
): boolean {
  if (!dialogOpen) return false;
  return value === null || isMindmapPathFor(value.path, hackathonId, selectedProjectId);
}
