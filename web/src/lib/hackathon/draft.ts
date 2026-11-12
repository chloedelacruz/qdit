import { IMAGE_SLOTS, isMindmapPathFor, SLIDES_URL_MAX, TEAM_NAME_MAX } from "@/lib/hackathon/schemas";

/**
 * The submit dialog's unsent draft (WP-4.7, QDIT-62).
 *
 * Teams open the dialog over and over to run the check while they work
 * towards the criteria. What they typed since the last submit is kept in this
 * browser's localStorage, one draft per signed-in user, hackathon and project,
 * so closing the dialog or reloading the page loses nothing.
 *
 * Browser-only on purpose: no table, no migration. A draft does not follow the
 * person to another device or to another admin of the same team.
 *
 * Images are kept by Storage path. They are uploaded the moment they are
 * picked and the bucket allows no delete, so the object a path names is still
 * there when the draft comes back.
 *
 * The Mindmap link (QDIT-66) is kept only once the team has typed one. Until
 * then the field follows the project's newest doqtri snapshot
 * (`startingMindmapUrl`), so a Send in doqtri after the draft was saved is
 * picked up the next time the dialog opens.
 */

/** What the dialog's fields hold. `imagePaths` has one entry per slot. */
export type DraftFields = {
  teamName: string;
  memberIds: string[];
  imagePaths: (string | null)[];
  /** As typed (QDIT-63). A draft saved before the field existed reads as "". */
  slidesUrl: string;
  /**
   * QDIT-66. As typed, or null while the team has not typed one: the field
   * then shows `startingMindmapUrl`. A draft saved before the field existed
   * reads as null.
   */
  mindmapUrl: string | null;
};

export type EntryDraft = DraftFields & {
  /** When the draft was last written, in ms since the epoch. */
  savedAt: number;
};

/** The submitted entry a draft is compared against, or null for none yet. */
export type DraftBase = {
  teamName: string;
  memberIds: readonly string[];
  imagePaths: readonly string[];
  /** Null on a version from before QDIT-63. */
  slidesUrl: string | null;
  /** The current version's Mindmap link; null for none (QDIT-66). */
  mindmapUrl: string | null;
  /** When the current version was submitted, ISO. */
  submittedAt: string | null;
} | null;

const PREFIX = "qdit:hackathon-draft:v1";

export function draftKey(userId: string, hackathonId: string, projectId: string): string {
  return `${PREFIX}:${userId}:${hackathonId}:${projectId}`.toLowerCase();
}

/**
 * localStorage, or null where the browser refuses it (private mode, blocked
 * site data, the server). Every caller then behaves as if there were no draft.
 */
export function draftStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The fields the dialog starts from without a draft: the submitted entry, or empty. The Mindmap link is untouched. */
export function baseFields(base: DraftBase): DraftFields {
  return {
    teamName: base?.teamName ?? "",
    memberIds: [...(base?.memberIds ?? [])],
    imagePaths: IMAGE_SLOTS.map((_, index) => base?.imagePaths[index] ?? null),
    slidesUrl: base?.slidesUrl ?? "",
    mindmapUrl: null,
  };
}

/**
 * What an untouched Mindmap link field shows (QDIT-66): the link of the
 * project's newest doqtri snapshot for this hackathon; without one, the
 * current version's link; else empty.
 */
export function startingMindmapUrl(snapshotLink: string | null, base: DraftBase): string {
  return snapshotLink || base?.mindmapUrl || "";
}

/**
 * The Mindmap link as a draft keeps it: null (untouched, follow the
 * snapshot) when what the team typed says the same as the field would show
 * by itself, compared trimmed; otherwise the text as typed.
 */
export function typedMindmapUrl(value: string, starting: string): string | null {
  return value.trim() === starting.trim() ? null : value;
}

/**
 * Whether the fields say the same as the base, so there is nothing to keep.
 * Member order does not matter; the slot an image sits in does. The team name
 * is compared trimmed, as the submit stores it, so a stray space typed before
 * submitting does not bring a draft back afterwards. The Slides link is
 * compared trimmed for the same reason. A typed Mindmap link always counts
 * (`typedMindmapUrl` already turned one equal to the starting link into
 * null).
 */
export function sameAsBase(fields: DraftFields, base: DraftBase): boolean {
  const start = baseFields(base);
  if (fields.teamName.trim() !== start.teamName.trim()) return false;
  if (fields.slidesUrl.trim() !== start.slidesUrl.trim()) return false;
  // Typed is a change; untouched follows the snapshot and is never one.
  if (fields.mindmapUrl !== null) return false;
  const members = new Set(fields.memberIds);
  if (members.size !== new Set(start.memberIds).size) return false;
  if (!start.memberIds.every((id) => members.has(id))) return false;
  return IMAGE_SLOTS.every((_, index) => (fields.imagePaths[index] ?? null) === start.imagePaths[index]);
}

/**
 * A stored draft, checked: anything malformed is no draft at all, and an
 * image path for another hackathon or project is dropped from its slot (the
 * submit would refuse it anyway).
 */
export function parseDraft(raw: string | null, hackathonId: string, projectId: string): EntryDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { teamName, memberIds, imagePaths, slidesUrl, mindmapUrl, savedAt } = value as Record<string, unknown>;
  if (typeof teamName !== "string") return null;
  if (!Array.isArray(memberIds) || !memberIds.every((id) => typeof id === "string")) return null;
  if (!Array.isArray(imagePaths)) return null;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  if (slidesUrl !== undefined && typeof slidesUrl !== "string") return null;
  if (mindmapUrl !== undefined && mindmapUrl !== null && typeof mindmapUrl !== "string") return null;

  return {
    teamName: teamName.slice(0, TEAM_NAME_MAX),
    memberIds: [...new Set(memberIds as string[])],
    imagePaths: IMAGE_SLOTS.map((_, index) => {
      const path: unknown = imagePaths[index];
      return typeof path === "string" && isMindmapPathFor(path, hackathonId, projectId) ? path : null;
    }),
    // Kept as typed, so a half-pasted link comes back to be finished; capped
    // a little over the limit so the field still shows why it is too long.
    slidesUrl: (typeof slidesUrl === "string" ? slidesUrl : "").slice(0, SLIDES_URL_MAX + 1),
    // The same cap: a doqtri link is far shorter, so the field still says why.
    mindmapUrl: typeof mindmapUrl === "string" ? mindmapUrl.slice(0, SLIDES_URL_MAX + 1) : null,
    savedAt,
  };
}

/**
 * The draft to start from, or null. A draft older than the current version is
 * dropped: someone submitted since it was saved (another admin, another
 * device), and bringing it back would quietly undo that submission.
 */
export function usableDraft(draft: EntryDraft | null, base: DraftBase): EntryDraft | null {
  if (!draft) return null;
  const submittedMs = base?.submittedAt ? Date.parse(base.submittedAt) : NaN;
  if (Number.isFinite(submittedMs) && draft.savedAt < submittedMs) return null;
  if (sameAsBase(draft, base)) return null;
  return draft;
}

export function readDraft(
  storage: Storage | null,
  ids: { userId: string; hackathonId: string; projectId: string },
): EntryDraft | null {
  if (!storage) return null;
  try {
    return parseDraft(storage.getItem(draftKey(ids.userId, ids.hackathonId, ids.projectId)), ids.hackathonId, ids.projectId);
  } catch {
    return null;
  }
}

/**
 * Keeps the fields as the project's draft, or removes the draft when they say
 * the same as the submitted entry. Never throws: a full or blocked storage only
 * means nothing is kept.
 */
export function saveDraft(
  storage: Storage | null,
  ids: { userId: string; hackathonId: string; projectId: string },
  fields: DraftFields,
  base: DraftBase,
  now: number = Date.now(),
): void {
  if (!storage) return;
  const key = draftKey(ids.userId, ids.hackathonId, ids.projectId);
  try {
    if (sameAsBase(fields, base)) {
      storage.removeItem(key);
      return;
    }
    const draft: EntryDraft = {
      teamName: fields.teamName,
      memberIds: fields.memberIds,
      imagePaths: IMAGE_SLOTS.map((_, index) => fields.imagePaths[index] ?? null),
      slidesUrl: fields.slidesUrl,
      mindmapUrl: fields.mindmapUrl,
      savedAt: now,
    };
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    // Quota or a blocked storage: the dialog works as it did before drafts.
  }
}

export function clearDraft(
  storage: Storage | null,
  ids: { userId: string; hackathonId: string; projectId: string },
): void {
  if (!storage) return;
  try {
    storage.removeItem(draftKey(ids.userId, ids.hackathonId, ids.projectId));
  } catch {
    // Nothing to do: the next save or a successful submit tries again.
  }
}
