import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/database";

/**
 * The `/hackathons` index (WP-4.7, QDIT-50): every hackathon a signed-in user
 * can see, and for the ones they staff, every submission with a link into the
 * staff view. Admins no longer have to type `/hackathons/<slug>/admin`.
 *
 * Only client-granted columns are read, and RLS does the scoping: any
 * signed-in user reads `hackathons`; staff read their hackathon's
 * submissions; a team member reads their own team row. Nothing graded.
 */

export type StaffRole = "admin" | "judge";

export type OverviewSubmission = {
  id: string;
  teamName: string;
  versions: number;
  lastSubmittedAt: string | null;
};

export type OverviewHackathon = {
  id: string;
  slug: string;
  name: string;
  opensAt: string;
  closesAt: string;
  releasedAt: string | null;
  role: StaffRole | null;
  /** Staff only; null for everyone else. Newest submission first. */
  submissions: OverviewSubmission[] | null;
  /** The caller's own team in this hackathon, if they are on one. */
  myTeam: string | null;
};

type HackathonRow = {
  id: string;
  slug: string;
  name: string;
  opens_at: string;
  closes_at: string;
  released_at: string | null;
};
type StaffRow = { hackathon_id: string; role: string };
type SubmissionRow = { id: string; hackathon_id: string; team_name: string; created_at: string };
type VersionRow = { submission_id: string; submitted_at: string };
type TeamRow = { hackathon_id: string; submission_id: string };

/** Pure assembly, so the ordering and role rules are testable without a database. */
export function buildOverview(input: {
  hackathons: HackathonRow[];
  staff: StaffRow[];
  submissions: SubmissionRow[];
  versions: VersionRow[];
  myTeams: TeamRow[];
}): OverviewHackathon[] {
  const roleBy = new Map<string, StaffRole>();
  for (const s of input.staff) {
    if (s.role === "admin") roleBy.set(s.hackathon_id, "admin");
    else if (s.role === "judge" && !roleBy.has(s.hackathon_id)) roleBy.set(s.hackathon_id, "judge");
  }

  const versionsBy = new Map<string, { count: number; last: string | null }>();
  for (const v of input.versions) {
    const cur = versionsBy.get(v.submission_id) ?? { count: 0, last: null };
    cur.count += 1;
    if (!cur.last || Date.parse(v.submitted_at) > Date.parse(cur.last)) cur.last = v.submitted_at;
    versionsBy.set(v.submission_id, cur);
  }

  const submissionsBy = new Map<string, OverviewSubmission[]>();
  const teamNameBySubmission = new Map<string, string>();
  for (const s of input.submissions) {
    teamNameBySubmission.set(s.id, s.team_name);
    const v = versionsBy.get(s.id);
    const list = submissionsBy.get(s.hackathon_id) ?? [];
    list.push({
      id: s.id,
      teamName: s.team_name,
      versions: v?.count ?? 0,
      lastSubmittedAt: v?.last ?? s.created_at,
    });
    submissionsBy.set(s.hackathon_id, list);
  }

  const myTeamBy = new Map<string, string>();
  for (const t of input.myTeams) {
    const name = teamNameBySubmission.get(t.submission_id);
    if (name) myTeamBy.set(t.hackathon_id, name);
  }

  return input.hackathons
    .map((h) => {
      const role = roleBy.get(h.id) ?? null;
      const subs = role
        ? [...(submissionsBy.get(h.id) ?? [])].sort(
            (a, b) => Date.parse(b.lastSubmittedAt ?? "") - Date.parse(a.lastSubmittedAt ?? "") || a.teamName.localeCompare(b.teamName),
          )
        : null;
      return {
        id: h.id,
        slug: h.slug,
        name: h.name,
        opensAt: h.opens_at,
        closesAt: h.closes_at,
        releasedAt: h.released_at,
        role,
        submissions: subs,
        myTeam: myTeamBy.get(h.id) ?? null,
      };
    })
    .sort((a, b) => {
      // Staffed first, then the soonest-relevant: open or upcoming before past.
      if (!!a.role !== !!b.role) return a.role ? -1 : 1;
      return Date.parse(b.opensAt) - Date.parse(a.opensAt);
    });
}

function rows<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`Could not load ${what}.`);
  return (res.data ?? []) as T[];
}

/** Reads everything the index needs. Throws on a failed read so the error boundary shows a retry. */
export async function loadHackathonOverview(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ hackathons: OverviewHackathon[]; nowMs: number; canSubmit: boolean }> {
  const [hRes, staffRes, teamRes, adminRes] = await Promise.all([
    supabase.from("hackathons").select("id, slug, name, opens_at, closes_at, released_at").order("opens_at", { ascending: false }),
    supabase.from("hackathon_staff").select("hackathon_id, role").eq("user_id", userId),
    supabase.from("hackathon_team_members").select("hackathon_id, submission_id").eq("user_id", userId),
    // Only a project's owner or admin can submit it (submit_hackathon_entry).
    supabase.from("project_members").select("project_id").eq("user_id", userId).in("role", ["owner", "admin"]).limit(1),
  ]);
  const canSubmit = rows<{ project_id: string }>(adminRes, "your projects").length > 0;
  const hackathons = rows<HackathonRow>(hRes, "hackathons");
  const staff = rows<StaffRow>(staffRes, "staff roles");
  const myTeams = rows<TeamRow>(teamRes, "your teams");

  const staffIds = [...new Set(staff.map((s) => s.hackathon_id))];
  const subIds = new Set(myTeams.map((t) => t.submission_id));

  // Staff read every submission of their hackathons; a team member reads their own.
  const subQueries = [];
  if (staffIds.length) {
    subQueries.push(
      supabase.from("hackathon_submissions").select("id, hackathon_id, team_name, created_at").in("hackathon_id", staffIds),
    );
  }
  if (subIds.size) {
    subQueries.push(
      supabase.from("hackathon_submissions").select("id, hackathon_id, team_name, created_at").in("id", [...subIds]),
    );
  }
  const subResults = await Promise.all(subQueries);
  const byId = new Map<string, SubmissionRow>();
  for (const r of subResults) for (const s of rows<SubmissionRow>(r, "submissions")) byId.set(s.id, s);
  const submissions = [...byId.values()];

  const staffSubIds = submissions.filter((s) => staffIds.includes(s.hackathon_id)).map((s) => s.id);
  const versions = staffSubIds.length
    ? rows<VersionRow>(
        await supabase.from("hackathon_submission_versions").select("submission_id, submitted_at").in("submission_id", staffSubIds),
        "submission versions",
      )
    : [];

  // The request's clock, for each card's open/closed badge.
  return {
    hackathons: buildOverview({ hackathons, staff, submissions, versions, myTeams }),
    nowMs: Date.now(),
    canSubmit,
  };
}
