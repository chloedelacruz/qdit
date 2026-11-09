import { MINDMAP_BUCKET } from "@/lib/hackathon/schemas";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Reads for the participant hackathon page (WP-4.7, QDIT-47, D-115, D-116).
 *
 * A participant sees what they sent and that it arrived, and nothing about how
 * it is assessed. So every select below names its columns, from the lists in
 * `PAGE_COLUMNS`, and none of them is anything the organisers decide about an
 * entry. The database hides those columns from clients as well
 * (20261110100000_hackathons.sql grants the rest by name); naming columns
 * here is what keeps this page from asking for them in the first place, and
 * queries.test.ts holds it to that.
 *
 * Row Level Security scopes every read to the caller's projects, except that
 * hackathon staff can read every entry. This page is the caller's own view,
 * so entries are also filtered to the caller's projects.
 */

/** Every column this page reads, per table. The test checks this list. */
export const PAGE_COLUMNS = {
  hackathons: "id, slug, name, description, opens_at, closes_at, team_min, team_max, released_at",
  project_members: "project_id, user_id, role",
  projects: "id, slug, name",
  hackathon_submissions: "id, project_id, team_name, current_version_id",
  hackathon_submission_versions: "id, submission_id, version_no, submitted_at, image_paths, doqtri_snapshot_id",
  hackathon_team_members: "submission_id, user_id",
  hackathon_doqtri_snapshots: "id, project_id, note_count, received_at",
  hackathon_late_passes: "project_id, until",
  profiles: "id, display_name, username",
} as const;

/** Signed image links last ten minutes: long enough to look, short enough not to share. */
export const SIGNED_URL_SECONDS = 600;

export type HackathonInfo = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  opensAt: string;
  closesAt: string;
  teamMin: number;
  teamMax: number;
  releasedAt: string | null;
};

export type Person = { id: string; name: string; username: string | null };

export type DoqtriSnapshotInfo = { id: string; noteCount: number; receivedAt: string };

export type EntryImage = { path: string; url: string | null };

export type MyEntry = {
  submissionId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  teamName: string;
  members: Person[];
  versionCount: number;
  lastSubmittedAt: string | null;
  /** The doqtri snapshot the current version froze, if any. */
  snapshotId: string | null;
  /** The current version's images, the global map first. */
  images: EntryImage[];
};

export type MyProject = {
  id: string;
  slug: string;
  name: string;
  /** Owner or admin: may submit this project. */
  canSubmit: boolean;
  /** The project's members, for the team picker. Empty unless `canSubmit`. */
  members: Person[];
  latePassUntil: string | null;
  latestSnapshot: DoqtriSnapshotInfo | null;
  entry: MyEntry | null;
};

export type HackathonPage = {
  hackathon: HackathonInfo;
  /** The server clock at render, which the countdown is seeded from. */
  nowMs: number;
  /** Every project the caller is in, by name. */
  projects: MyProject[];
};

function personOf(row: { id: string; display_name: string | null; username: string | null }): Person {
  return {
    id: row.id,
    name: row.display_name?.trim() || row.username || "Unknown",
    username: row.username,
  };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export async function getHackathonPage(slug: string): Promise<HackathonPage | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();

  const [{ data: h }, { data: roles }] = await Promise.all([
    supabase.from("hackathons").select(PAGE_COLUMNS.hackathons).eq("slug", slug).maybeSingle(),
    supabase.from("project_members").select(PAGE_COLUMNS.project_members).eq("user_id", user.id),
  ]);
  if (!h) return null;

  const nowMs = Date.now();
  const hackathon: HackathonInfo = {
    id: h.id,
    slug: h.slug,
    name: h.name,
    description: h.description,
    opensAt: h.opens_at,
    closesAt: h.closes_at,
    teamMin: h.team_min,
    teamMax: h.team_max,
    releasedAt: h.released_at,
  };

  const projectIds = (roles ?? []).map((row) => row.project_id);
  if (projectIds.length === 0) return { hackathon, nowMs, projects: [] };

  const adminIds = (roles ?? [])
    .filter((row) => row.role === "owner" || row.role === "admin")
    .map((row) => row.project_id);

  const [projects, submissions, snapshots, passes, roster] = await Promise.all([
    supabase.from("projects").select(PAGE_COLUMNS.projects).in("id", projectIds),
    supabase
      .from("hackathon_submissions")
      .select(PAGE_COLUMNS.hackathon_submissions)
      .eq("hackathon_id", hackathon.id)
      .in("project_id", projectIds),
    supabase
      .from("hackathon_doqtri_snapshots")
      .select(PAGE_COLUMNS.hackathon_doqtri_snapshots)
      .eq("hackathon_id", hackathon.id)
      .in("project_id", projectIds)
      .order("received_at", { ascending: false }),
    supabase
      .from("hackathon_late_passes")
      .select(PAGE_COLUMNS.hackathon_late_passes)
      .eq("hackathon_id", hackathon.id)
      .in("project_id", projectIds),
    adminIds.length > 0
      ? supabase.from("project_members").select(PAGE_COLUMNS.project_members).in("project_id", adminIds)
      : Promise.resolve({ data: [] as { project_id: string; user_id: string; role: string }[] }),
  ]);

  const submissionRows = submissions.data ?? [];
  const submissionIds = submissionRows.map((row) => row.id);

  const [versions, team] =
    submissionIds.length > 0
      ? await Promise.all([
          supabase
            .from("hackathon_submission_versions")
            .select(PAGE_COLUMNS.hackathon_submission_versions)
            .in("submission_id", submissionIds),
          supabase
            .from("hackathon_team_members")
            .select(PAGE_COLUMNS.hackathon_team_members)
            .in("submission_id", submissionIds),
        ])
      : [{ data: [] }, { data: [] }];

  const versionRows = versions.data ?? [];
  const teamRows = team.data ?? [];
  const rosterRows = roster.data ?? [];

  const personIds = [...new Set([...teamRows.map((r) => r.user_id), ...rosterRows.map((r) => r.user_id)])];
  const currentVersions = new Map(
    versionRows
      .filter((v) => submissionRows.some((s) => s.current_version_id === v.id))
      .map((v) => [v.submission_id, v]),
  );
  const imagePaths = [...currentVersions.values()].flatMap((v) => v.image_paths);

  const [profiles, signed] = await Promise.all([
    personIds.length > 0
      ? supabase.from("profiles").select(PAGE_COLUMNS.profiles).in("id", personIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null; username: string | null }[] }),
    imagePaths.length > 0
      ? supabase.storage.from(MINDMAP_BUCKET).createSignedUrls(imagePaths, SIGNED_URL_SECONDS)
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
  ]);

  const people = new Map((profiles.data ?? []).map((row) => [row.id, personOf(row)]));
  const personFor = (id: string): Person => people.get(id) ?? { id, name: "Unknown", username: null };
  const urls = new Map(
    (signed.data ?? []).flatMap((row) => (row.path && row.signedUrl ? [[row.path, row.signedUrl] as const] : [])),
  );

  const latestSnapshot = new Map<string, DoqtriSnapshotInfo>();
  for (const row of snapshots.data ?? []) {
    // Ordered newest first, so the first row per project is the latest.
    if (!latestSnapshot.has(row.project_id)) {
      latestSnapshot.set(row.project_id, {
        id: row.id,
        noteCount: row.note_count,
        receivedAt: row.received_at,
      });
    }
  }

  const passFor = new Map((passes.data ?? []).map((row) => [row.project_id, row.until]));
  const roleFor = new Map((roles ?? []).map((row) => [row.project_id, row.role]));

  const rows: MyProject[] = (projects.data ?? []).map((project) => {
    const role = roleFor.get(project.id);
    const canSubmit = role === "owner" || role === "admin";
    const submission = submissionRows.find((s) => s.project_id === project.id) ?? null;

    let entry: MyEntry | null = null;
    if (submission) {
      const own = versionRows.filter((v) => v.submission_id === submission.id);
      const current = currentVersions.get(submission.id) ?? null;
      entry = {
        submissionId: submission.id,
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        teamName: submission.team_name,
        members: teamRows
          .filter((r) => r.submission_id === submission.id)
          .map((r) => personFor(r.user_id))
          .sort(byName),
        versionCount: own.reduce((max, v) => Math.max(max, v.version_no), 0),
        lastSubmittedAt: current?.submitted_at ?? null,
        snapshotId: current?.doqtri_snapshot_id ?? null,
        images: (current?.image_paths ?? []).map((path) => ({ path, url: urls.get(path) ?? null })),
      };
    }

    return {
      id: project.id,
      slug: project.slug,
      name: project.name,
      canSubmit,
      members: canSubmit
        ? rosterRows
            .filter((r) => r.project_id === project.id)
            .map((r) => personFor(r.user_id))
            .sort(byName)
        : [],
      latePassUntil: passFor.get(project.id) ?? null,
      latestSnapshot: latestSnapshot.get(project.id) ?? null,
      entry,
    };
  });

  return { hackathon, nowMs, projects: rows.sort(byName) };
}
