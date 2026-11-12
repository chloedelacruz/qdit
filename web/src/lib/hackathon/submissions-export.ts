import "server-only";

import { csvField } from "@/lib/hackathon/leaderboard";
import { mindmapLink } from "@/lib/hackathon/mindmap-link";
import { MINDMAP_BUCKET, MAX_IMAGES } from "@/lib/hackathon/schemas";
import { StaffQueryError, type Db } from "@/lib/hackathon/staff-queries";

/**
 * The admin console's "Export submissions" CSV (WP-4.7, QDIT-63, D-123).
 *
 * One row per entry: its team name, Slides link, mindmap images and Mindmap
 * link (QDIT-66, after the global mindmap image), as the current version
 * froze them. The link is read from the version, not the snapshot, so it is
 * still there after the snapshot is pruned. Nothing the organisers decide about an entry
 * (eligibility, an override, a grade) is selected, so the export is the same
 * before and after release and never touches the sealed grades (D-116).
 *
 * The images are in a private bucket, so each cell is a signed URL made under
 * the admin's own session (the bucket's read policy admits hackathon staff).
 * It opens the image for whoever holds the file, until it expires
 * (EXPORT_IMAGE_SECONDS, the product owner's call in D-123).
 */

/** Seven days: long enough to judge from, then the links stop working. */
export const EXPORT_IMAGE_SECONDS = 7 * 24 * 60 * 60;

export const SUBMISSIONS_CSV_HEADER = [
  "Team name",
  "Slides link",
  "Global mindmap",
  "Mindmap link",
  "Note map 1",
  "Note map 2",
] as const;

export interface SubmissionExportRow {
  team_name: string;
  /** Empty for a version from before QDIT-63. */
  slides_url: string;
  /** One per image slot, the global map first; "" where none was attached or it could not be signed. */
  images: string[];
  /** The version's doqtri mindmap link; "" for none (QDIT-66). */
  mindmap_url: string;
}

/** Header plus one line per row, CRLF line endings, trailing CRLF, every cell formula-guarded. */
export function submissionsCsv(rows: readonly SubmissionExportRow[]): string {
  const lines = [SUBMISSIONS_CSV_HEADER.join(",")];
  for (const row of rows) {
    const [global, ...notes] = Array.from({ length: MAX_IMAGES }, (_, i) => row.images[i] ?? "");
    lines.push([row.team_name, row.slides_url, global, row.mindmap_url, ...notes].map(csvField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

type VersionRow = {
  id: string;
  team_name: string;
  slides_url: string | null;
  mindmap_url: string | null;
  image_paths: string[] | null;
};

/**
 * Every entry of this hackathon with a current version, by team name. Reads
 * under the caller's session: the row policy shows staff every entry. Throws
 * StaffQueryError when a read or the signing fails, so the file is never
 * missing rows or links without saying so.
 */
export async function loadSubmissionsExport(db: Db, hackathonId: string): Promise<SubmissionExportRow[]> {
  const { data: subs, error: subError } = await db
    .from("hackathon_submissions")
    .select("id, current_version_id")
    .eq("hackathon_id", hackathonId);
  if (subError) throw new StaffQueryError("read submissions", subError.code);

  const versionIds = ((subs ?? []) as { id: string; current_version_id: string | null }[])
    .map((s) => s.current_version_id)
    .filter((id): id is string => id !== null);
  if (versionIds.length === 0) return [];

  const { data: vers, error: verError } = await db
    .from("hackathon_submission_versions")
    .select("id, team_name, slides_url, mindmap_url, image_paths")
    .in("id", versionIds);
  if (verError) throw new StaffQueryError("read versions", verError.code);
  const versions = (vers ?? []) as VersionRow[];

  const paths = versions.flatMap((v) => (Array.isArray(v.image_paths) ? v.image_paths : []));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed, error: signError } = await db.storage
      .from(MINDMAP_BUCKET)
      .createSignedUrls(paths, EXPORT_IMAGE_SECONDS);
    if (signError) throw new StaffQueryError("sign mindmap images", null);
    // A single object Storage cannot sign (removed by an operator) leaves its cell empty.
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl && !s.error) urls.set(s.path, s.signedUrl);
    }
  }

  return versions
    .map((v) => ({
      team_name: v.team_name,
      slides_url: v.slides_url ?? "",
      images: (Array.isArray(v.image_paths) ? v.image_paths : []).map((path) => urls.get(path) ?? ""),
      // Checked against DOQTRI_ORIGIN again, as the pages do.
      mindmap_url: mindmapLink(v.mindmap_url) ?? "",
    }))
    .sort(
      (a, b) =>
        a.team_name.localeCompare(b.team_name, "en", { sensitivity: "base" }) ||
        (a.team_name < b.team_name ? -1 : a.team_name > b.team_name ? 1 : 0),
    );
}
