import { z } from "zod";

/**
 * Input rules for "Add submission to hackathon" (WP-4.7, QDIT-47, D-115).
 *
 * Shared by the dialog and the server action. The dialog's copy is a
 * convenience; the action's is the boundary, and `submit_hackathon_entry`
 * behind it is the real one. Every bound here mirrors that function or the
 * `hackathon-mindmaps` bucket in 20261110100000_hackathons.sql, so a value
 * that passes here does not then fail in Postgres with an opaque error.
 *
 * `z.guid()`, not `z.uuid()`, for the reason given in lib/schemas.ts.
 */

/** The private Storage bucket the mindmap images go to. */
export const MINDMAP_BUCKET = "hackathon-mindmaps";

/** `hackathon_submissions.team_name`: trimmed, 1–80 characters. */
export const TEAM_NAME_MAX = 80;

/** `hackathon_submission_versions.image_paths`: 1 to 3, the first the global map. */
export const MAX_IMAGES = 3;

/** The bucket's `file_size_limit`. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The bucket's `allowed_mime_types`, and the extension each one is stored under. */
export const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type ImageType = keyof typeof IMAGE_TYPES;

/** What the file input offers. */
export const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES).join(",");

/**
 * The three image slots, in the order `image_paths` stores them. The first is
 * required; it is the one every entry is judged by.
 */
export const IMAGE_SLOTS = [
  { name: "image_global", label: "Global mindmap", required: true },
  { name: "image_note_1", label: "Note map", required: false },
  { name: "image_note_2", label: "Note map", required: false },
] as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `hackathon_mindmap_path()`: `<hackathon>/<project>/<uuid>.<ext>`, lower case. */
const MINDMAP_PATH = new RegExp(`^(${UUID})/(${UUID})/${UUID}\\.(png|jpg|jpeg|webp)$`);

/** The Storage object name for one upload. Lower-cased, as the policy requires. */
export function mindmapPath(
  hackathonId: string,
  projectId: string,
  objectId: string,
  ext: string,
): string {
  return `${hackathonId}/${projectId}/${objectId}.${ext}`.toLowerCase();
}

/** True when `path` is a mindmap upload for exactly this hackathon and project. */
export function isMindmapPathFor(path: string, hackathonId: string, projectId: string): boolean {
  const match = MINDMAP_PATH.exec(path);
  return (
    match !== null &&
    match[1] === hackathonId.toLowerCase() &&
    match[2] === projectId.toLowerCase()
  );
}

export type ImageCheck = { ok: true; ext: string } | { ok: false; error: string };

/**
 * Checks a picked file before it is uploaded, so a wrong file fails in the
 * browser with a sentence instead of a Storage 4xx. Takes only the two
 * properties it reads, so it can be tested without a DOM `File`.
 */
export function checkImageFile(file: { type: string; size: number }): ImageCheck {
  const ext = (IMAGE_TYPES as Record<string, string>)[file.type];
  if (!ext) return { ok: false, error: "Use a PNG, JPEG or WebP image." };
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "The image is over 5 MB. Export a smaller one." };
  return { ok: true, ext };
}

/**
 * Storage's refusals, in words. The bucket's INSERT policy refuses with an
 * RLS message (or a 403); its limits with "too large" or a mime-type message.
 */
export function uploadErrorMessage(message: string): string {
  if (/row-level security|unauthori[sz]ed|403/i.test(message)) {
    return "The upload was refused. Only the project's owner or an admin can attach images, and only while submissions are open.";
  }
  if (/too large|exceeded|413/i.test(message)) return "The image is over 5 MB. Export a smaller one.";
  if (/mime|type/i.test(message)) return "Use a PNG, JPEG or WebP image.";
  return "The upload did not finish. Try again.";
}

/** `hackathon_submission_versions.slides_url`: at most this many characters. */
export const SLIDES_URL_MAX = 2048;

/**
 * `hackathon_slides_url_ok()` in 20261112120000_hackathon_slides_link.sql,
 * character for character (QDIT-63, D-123): https, then Google Slides, a deck
 * file on Google Drive, OneDrive or SharePoint, with the host followed by `/`
 * so a look-alike host never matches. Case-insensitive, as `~*` is there.
 */
const SLIDES_URL = new RegExp(
  "^https://(" +
    "docs\\.google\\.com/presentation/(u/[0-9]+/)?d/[A-Za-z0-9_-]+" +
    "|drive\\.google\\.com/file/d/[A-Za-z0-9_-]+" +
    "|onedrive\\.live\\.com/" +
    "|1drv\\.ms/" +
    "|[a-z0-9-]+(\\.[a-z0-9-]+)*\\.sharepoint\\.com/" +
    ")[^\\s\\p{Cc}]*$",
  "iu",
);

/** True when the database will take `url` (already trimmed) as a Slides link. */
export function isSlidesUrl(url: string): boolean {
  return url.length <= SLIDES_URL_MAX && SLIDES_URL.test(url);
}

/** The field's error for a trimmed link, or null when it is fine. Shared by the schema and the dialog. */
export function slidesUrlProblem(url: string): string | null {
  if (url === "") return "Add the link to your slides.";
  if (url.length > SLIDES_URL_MAX) return `Keep the link to ${SLIDES_URL_MAX} characters.`;
  if (!/^https:\/\//i.test(url)) return "Use the https:// link your slides app gives you.";
  if (!SLIDES_URL.test(url)) return "Use a Google Slides or PowerPoint (OneDrive or SharePoint) link.";
  return null;
}

/** The raw form, as the dialog posts it. */
export type SubmitEntryInput = {
  hackathonId: string;
  projectId: string;
  teamName: string;
  memberIds: string[];
  /** Slot order: global map first, then the note maps. Empty slots are "". */
  images: string[];
  slidesUrl: string;
};

/** Reads the dialog's fields out of `FormData`. Never throws. */
export function readSubmitForm(formData: FormData): SubmitEntryInput {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    hackathonId: text("hackathonId"),
    projectId: text("projectId"),
    teamName: text("teamName"),
    memberIds: formData.getAll("memberIds").filter((v): v is string => typeof v === "string"),
    images: IMAGE_SLOTS.map((slot) => text(slot.name).trim()),
    slidesUrl: text("slidesUrl"),
  };
}

/** Just the ids, for the action to know which hackathon's bounds to apply. */
export const submitTargetSchema = z.object({
  hackathonId: z.guid("Choose a hackathon."),
  projectId: z.guid("Choose the team project."),
});

export type TeamBounds = { teamMin: number; teamMax: number };

export type SubmitEntry = {
  hackathonId: string;
  projectId: string;
  teamName: string;
  memberIds: string[];
  /** 1 to 3 paths, the global map first. */
  imagePaths: string[];
  /** Trimmed; `isSlidesUrl` holds. */
  slidesUrl: string;
};

function teamSizeMessage({ teamMin, teamMax }: TeamBounds): string {
  return teamMin === teamMax
    ? `Choose ${teamMin} team members.`
    : `Choose ${teamMin} to ${teamMax} team members.`;
}

/**
 * The image slots, in slot order, to the `image_paths` the RPC takes: the
 * global map first, then whichever note maps were attached.
 */
const imagesSchema = z
  .array(z.string())
  .max(MAX_IMAGES, "Attach at most three images.")
  .transform((slots, ctx) => {
    const [global = "", ...notes] = slots;
    const paths = [global, ...notes.filter((path) => path !== "")];
    // One message per field: the first problem is the one to fix.
    const problem =
      global === ""
        ? "Attach the global mindmap image."
        : new Set(paths).size !== paths.length
          ? "Attach each image once."
          : !paths.every((path) => MINDMAP_PATH.test(path))
            ? "An image did not finish uploading. Remove it and attach it again."
            : null;
    if (problem) ctx.addIssue({ code: "custom", message: problem });
    return paths;
  });

/**
 * The whole entry, with the hackathon's own team size. Field keys are the ones
 * the dialog shows errors under: `projectId`, `teamName`, `memberIds`,
 * `images`, `slidesUrl`. Every field is checked on its own, so one submit shows every
 * problem at once.
 */
export function submitEntrySchema(bounds: TeamBounds) {
  return submitTargetSchema
    .extend({
      teamName: z
        .string()
        .trim()
        .min(1, "Enter a team name.")
        .max(TEAM_NAME_MAX, `Keep the team name to ${TEAM_NAME_MAX} characters.`),
      memberIds: z
        .array(z.guid("Choose team members from the project."))
        .refine((ids) => new Set(ids).size === ids.length, "Each person can be on the team once.")
        .refine(
          (ids) => ids.length >= bounds.teamMin && ids.length <= bounds.teamMax,
          teamSizeMessage(bounds),
        ),
      images: imagesSchema,
      slidesUrl: z
        .string()
        .trim()
        .superRefine((url, ctx) => {
          const problem = slidesUrlProblem(url);
          if (problem) ctx.addIssue({ code: "custom", message: problem });
        }),
    })
    .refine(
      (entry) =>
        !Array.isArray(entry.images) ||
        entry.images.every(
          // Malformed paths are the images field's own error; this one is
          // only for a well-formed path under another project.
          (path) => !MINDMAP_PATH.test(path) || isMindmapPathFor(path, entry.hackathonId, entry.projectId),
        ),
      {
        path: ["images"],
        message: "An image was uploaded for another project. Remove it and attach it again.",
      },
    )
    .transform(
      (entry): SubmitEntry => ({
        hackathonId: entry.hackathonId,
        projectId: entry.projectId,
        teamName: entry.teamName,
        memberIds: entry.memberIds,
        imagePaths: entry.images,
        slidesUrl: entry.slidesUrl,
      }),
    );
}
