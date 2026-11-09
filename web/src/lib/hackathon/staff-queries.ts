import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { StoredRun, VersionProgress } from "@/lib/hackathon/grading-store";
import { versionGrade } from "@/lib/hackathon/grading-worker";
import {
  FINALIST_COUNT,
  rankFinal,
  type JudgeScoresBySubmission,
  type RankedRow,
  type RankEntry,
} from "@/lib/hackathon/leaderboard";
import { MINDMAP_BUCKET } from "@/lib/hackathon/grading-store";
import { round2 } from "@/lib/hackathon/rubric";
import {
  parseEligibility,
  readDoqtriSnapshot,
  readQditSnapshot,
  type DoqtriSnapshotView,
  type QditSnapshotView,
  type StatusJob,
} from "@/lib/hackathon/staff-view";
import {
  AI_FLAGS,
  CRITERION_KEYS,
  type AiFlag,
  type CriterionKey,
  type EligibilityResult,
  type JudgeScore,
} from "@/lib/hackathon/types";
import type { Database } from "@/lib/types/database";

/**
 * Reads for the hackathon staff consoles (WP-4.7, QDIT-48; D-115, D-116,
 * D-119). Every function takes the caller's own client: RLS and the RPCs'
 * own checks decide what comes back, and this module only shapes it.
 *
 * The sealed-grades rule lives here as much as in SQL: nothing score-derived
 * is requested before `released_at` is set. `loadAdminConsole` does not call
 * `hackathon_leaderboard` for an unreleased hackathon (the RPC would refuse
 * anyway; not asking keeps a refusal from ever being a probe).
 */

export type Db = SupabaseClient<Database>;
type Fns = Database["public"]["Functions"];

export type StatusRow = Fns["hackathon_grading_status"]["Returns"][number];
export type LeaderboardRow = Fns["hackathon_leaderboard"]["Returns"][number];
export type StaffRow = Fns["hackathon_staff_list"]["Returns"][number];
export type HackathonRole = Database["public"]["Enums"]["hackathon_role"];

export interface StaffHackathon {
  id: string;
  slug: string;
  name: string;
  opens_at: string;
  closes_at: string;
  released_at: string | null;
  finalist_count: number;
}

/** Thrown when a read the page cannot do without fails; the route's error boundary shows it. */
export class StaffQueryError extends Error {
  readonly code: string | null;
  constructor(operation: string, code: string | null | undefined) {
    super(`hackathon staff: ${operation} failed${code ? ` (${code})` : ""}`);
    this.name = "StaffQueryError";
    this.code = code ?? null;
  }
}

/** The hackathon with this slug, or null. Every signed-in user may read hackathons. */
export async function getStaffHackathon(db: Db, slug: string): Promise<StaffHackathon | null> {
  const { data, error } = await db
    .from("hackathons")
    .select("id, slug, name, opens_at, closes_at, released_at, finalist_count")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new StaffQueryError("read hackathon", error.code);
  return (data as StaffHackathon | null) ?? null;
}

/** The caller's staff role here, or null. RLS shows a user their own row. */
export async function getStaffRole(db: Db, hackathonId: string, userId: string): Promise<HackathonRole | null> {
  const { data, error } = await db
    .from("hackathon_staff")
    .select("role")
    .eq("hackathon_id", hackathonId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new StaffQueryError("read staff role", error.code);
  return (data as { role: HackathonRole } | null)?.role ?? null;
}

/* -------------------------------------------------------------------------- */
/* Admin console                                                              */
/* -------------------------------------------------------------------------- */

export interface AdminSubmission {
  submission_id: string;
  project_id: string;
  project_slug: string;
  team_name: string;
  version_no: number | null;
  submitted_at: string | null;
  jobs: StatusJob[];
  /** No live job pending or running. Before release `jobs` holds runs 1 and 2 only, so this is the honest "settled". */
  complete: boolean;
  eligibility: EligibilityResult | null;
  eligibility_override: boolean | null;
  override_reason: string | null;
  late_pass_until: string | null;
}

export interface AdminConsole {
  submissions: AdminSubmission[];
  staff: StaffRow[];
  /** Null before release: nothing score-derived exists for the page yet. */
  leaderboard: LeaderboardView[] | null;
}

function toAdminSubmission(r: StatusRow): AdminSubmission {
  return {
    submission_id: r.submission_id,
    project_id: r.project_id,
    project_slug: r.project_slug,
    team_name: r.team_name,
    version_no: r.version_no,
    submitted_at: r.submitted_at,
    jobs: (Array.isArray(r.jobs) ? r.jobs : []).map((j) => ({
      run_no: j.run_no,
      status: j.status,
      last_error: j.last_error,
    })),
    complete: r.complete,
    eligibility: parseEligibility(r.eligibility),
    eligibility_override: r.eligibility_override,
    override_reason: r.override_reason,
    late_pass_until: r.late_pass_until,
  };
}

/**
 * Everything the admin page shows. The leaderboard is requested only when
 * the hackathon is released (D-116).
 */
export async function loadAdminConsole(db: Db, hackathon: StaffHackathon): Promise<AdminConsole> {
  const [status, staff] = await Promise.all([
    db.rpc("hackathon_grading_status", { p_hackathon_id: hackathon.id }),
    db.rpc("hackathon_staff_list", { p_hackathon_id: hackathon.id }),
  ]);
  if (status.error) throw new StaffQueryError("read grading status", status.error.code);
  if (staff.error) throw new StaffQueryError("read staff", staff.error.code);

  const statusRows = (status.data ?? []) as StatusRow[];
  const leaderboard =
    hackathon.released_at == null ? null : await loadLeaderboard(db, hackathon.id, statusRows);

  return {
    submissions: statusRows.map(toAdminSubmission),
    staff: (staff.data ?? []) as StaffRow[],
    leaderboard,
  };
}

/* -------------------------------------------------------------------------- */
/* Leaderboard (after release only)                                           */
/* -------------------------------------------------------------------------- */

export interface LeaderboardView extends RankedRow {
  version_no: number | null;
  ai_rank: number | null;
  pitch_order: number | null;
  ai_mean: number | null;
  run_count: number;
  /** Combined per criterion 0-10, as stored by SQL (rubric.ts combineRuns). */
  ai_criteria: Record<CriterionKey, number> | null;
  /** max - min of the counted runs' totals; null with fewer than two runs. */
  spread: number | null;
  /** The judges' mean /25 as SQL computed it; `human_mean` is rankFinal's, from the same scores. */
  judge_mean: number | null;
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function storedRuns(row: LeaderboardRow): StoredRun[] {
  return (Array.isArray(row.runs) ? row.runs : []).map((r) => ({
    runNo: r.run_no,
    criteria: r.criteria as StoredRun["criteria"],
    total: Number(r.total),
    flags: (Array.isArray(r.flags) ? r.flags : []) as AiFlag[],
  }));
}

/**
 * The flags an entry shows: every counted run's flags, plus `disagreement`
 * from versionGrade(), which SQL does not store (two runs that disagreed
 * with a third run that never landed are flagged there, in code).
 */
export function entryFlags(row: LeaderboardRow, status: StatusRow | undefined): AiFlag[] {
  const runs = storedRuns(row);
  const seen = new Set<AiFlag>();
  for (const run of runs) for (const f of run.flags) seen.add(f);

  const progress: VersionProgress = {
    jobs: (status?.jobs ?? [])
      .filter((j) => (j.status as string) !== "superseded")
      .map((j) => ({ runNo: j.run_no, status: j.status })),
    runs,
  };
  try {
    const grade = versionGrade(progress);
    for (const f of grade.combined?.flags ?? []) seen.add(f);
    // Release supersedes a third run still queued, so two runs that
    // disagreed stay disagreeing for good: the flag still applies.
    if (grade.state === "needs_third_run") seen.add("disagreement");
  } catch {
    // A run without every criterion cannot be combined; its own flags stand.
  }
  return AI_FLAGS.filter((f) => seen.has(f));
}

function runSpread(row: LeaderboardRow): number | null {
  const totals = (Array.isArray(row.runs) ? row.runs : [])
    .map((r) => Number(r.total))
    .filter(Number.isFinite);
  if (totals.length < 2) return null;
  return round2(Math.max(...totals) - Math.min(...totals));
}

function criteria(value: unknown): Record<CriterionKey, number> | null {
  if (typeof value !== "object" || value === null) return null;
  const out = {} as Record<CriterionKey, number>;
  for (const key of CRITERION_KEYS) {
    const v = num((value as Record<string, unknown>)[key]);
    if (v == null) return null;
    out[key] = v;
  }
  return out;
}

/**
 * The leaderboard RPC's rows in final order (rankFinal), with what the admin
 * table shows beside them. Pure: the page and the CSV route rank the same.
 */
export function buildLeaderboard(rows: readonly LeaderboardRow[], statusRows: readonly StatusRow[]): LeaderboardView[] {
  const statusBySubmission = new Map(statusRows.map((s) => [s.submission_id, s]));
  const byId = new Map(rows.map((r) => [r.submission_id, r]));

  const entries: RankEntry[] = rows.map((r) => ({
    submission_id: r.submission_id,
    eligible: r.eligible === true,
    ai_total: num(r.ai_total),
    submitted_at: r.submitted_at ?? "",
    finalist: r.finalist === true,
    team_name: r.team_name,
    project_slug: r.project_slug,
    flags: entryFlags(r, statusBySubmission.get(r.submission_id)),
  }));

  // Every judge's own scores, as the RPC gives them (empty for a non-finalist).
  const judgeScores: Record<string, JudgeScore[]> = {};
  for (const r of rows) {
    const scores = (Array.isArray(r.judge_scores) ? r.judge_scores : []).map((js) => ({
      judge_id: js.judge_id,
      clarity: js.clarity,
      structure: js.structure,
      accuracy: js.accuracy,
      connections: js.connections,
      pitch: js.pitch,
    }));
    if (scores.length > 0) judgeScores[r.submission_id] = scores;
  }

  return rankFinal(entries, judgeScores as JudgeScoresBySubmission).map((ranked) => {
    const r = byId.get(ranked.submission_id)!;
    return {
      ...ranked,
      version_no: r.version_no,
      ai_rank: r.ai_rank,
      pitch_order: r.pitch_order,
      ai_mean: num(r.ai_mean),
      run_count: r.run_count ?? 0,
      ai_criteria: criteria(r.ai_criteria),
      spread: runSpread(r),
      judge_mean: num(r.judge_mean),
    };
  });
}

/**
 * hackathon_leaderboard plus the job states (for `disagreement`), ranked.
 * Call only for a released hackathon; the RPC refuses before.
 */
export async function loadLeaderboard(
  db: Db,
  hackathonId: string,
  statusRows?: readonly StatusRow[],
): Promise<LeaderboardView[]> {
  const [board, status] = await Promise.all([
    db.rpc("hackathon_leaderboard", { p_hackathon_id: hackathonId }),
    statusRows
      ? Promise.resolve({ data: statusRows, error: null })
      : db.rpc("hackathon_grading_status", { p_hackathon_id: hackathonId }),
  ]);
  if (board.error) throw new StaffQueryError("read leaderboard", board.error.code);
  if (status.error) throw new StaffQueryError("read grading status", status.error.code);
  return buildLeaderboard((board.data ?? []) as LeaderboardRow[], (status.data ?? []) as StatusRow[]);
}

export { FINALIST_COUNT };

/* -------------------------------------------------------------------------- */
/* Frozen submission view (judge+)                                            */
/* -------------------------------------------------------------------------- */

/** Signed image URLs live this long: long enough to look, short enough not to be a share link. */
export const SIGNED_URL_SECONDS = 5 * 60;

export interface SubmissionImage {
  path: string;
  /** The first image is the global mindmap. */
  label: string;
  url: string | null;
}

export interface SubmissionView {
  submission_id: string;
  team_name: string;
  version_no: number;
  submitted_at: string;
  member_ids: string[];
  qdit: QditSnapshotView;
  doqtri: DoqtriSnapshotView | null;
  doqtri_received_at: string | null;
  images: SubmissionImage[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The current version of one entry of this hackathon, frozen as submitted,
 * with 5-minute signed image URLs made under the caller's session (the
 * bucket's read policy admits staff). No score, eligibility or override
 * column is selected: none is granted to clients, and none belongs here.
 */
export async function loadSubmissionView(
  db: Db,
  hackathonId: string,
  submissionId: string,
): Promise<SubmissionView | null> {
  if (!UUID.test(submissionId)) return null;

  const { data: sub, error: subError } = await db
    .from("hackathon_submissions")
    .select("id, team_name, current_version_id")
    .eq("id", submissionId)
    .eq("hackathon_id", hackathonId)
    .maybeSingle();
  if (subError) throw new StaffQueryError("read submission", subError.code);
  const submission = sub as { id: string; team_name: string; current_version_id: string | null } | null;
  if (!submission?.current_version_id) return null;

  const { data: ver, error: verError } = await db
    .from("hackathon_submission_versions")
    .select("id, version_no, team_name, member_ids, qdit_snapshot, doqtri_snapshot_id, image_paths, submitted_at")
    .eq("id", submission.current_version_id)
    .maybeSingle();
  if (verError) throw new StaffQueryError("read version", verError.code);
  const version = ver as {
    id: string;
    version_no: number;
    team_name: string;
    member_ids: string[];
    qdit_snapshot: unknown;
    doqtri_snapshot_id: string | null;
    image_paths: string[];
    submitted_at: string;
  } | null;
  if (!version) return null;

  let doqtri: DoqtriSnapshotView | null = null;
  let doqtriReceivedAt: string | null = null;
  if (version.doqtri_snapshot_id) {
    const { data: snap, error: snapError } = await db
      .from("hackathon_doqtri_snapshots")
      .select("id, payload, received_at")
      .eq("id", version.doqtri_snapshot_id)
      .maybeSingle();
    if (snapError) throw new StaffQueryError("read doqtri snapshot", snapError.code);
    const row = snap as { payload: unknown; received_at: string } | null;
    doqtri = readDoqtriSnapshot(row?.payload);
    doqtriReceivedAt = row?.received_at ?? null;
  }

  const paths = Array.isArray(version.image_paths) ? version.image_paths : [];
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await db.storage.from(MINDMAP_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl && !s.error) urls.set(s.path, s.signedUrl);
    }
  }

  return {
    submission_id: submission.id,
    team_name: version.team_name,
    version_no: version.version_no,
    submitted_at: version.submitted_at,
    member_ids: Array.isArray(version.member_ids) ? version.member_ids : [],
    qdit: readQditSnapshot(version.qdit_snapshot),
    doqtri,
    doqtri_received_at: doqtriReceivedAt,
    images: paths.map((path, i) => ({
      path,
      label: i === 0 ? "Global mindmap" : `Note map ${i}`,
      url: urls.get(path) ?? null,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Judge console (after release)                                              */
/* -------------------------------------------------------------------------- */

export interface JudgeFinalist {
  submission_id: string;
  team_name: string;
  project_slug: string;
  pitch_order: number | null;
}

export interface OwnJudgeScore {
  submission_id: string;
  clarity: number;
  structure: number;
  accuracy: number;
  connections: number;
  pitch: number;
  note: string | null;
}

export interface JudgeConsole {
  finalists: JudgeFinalist[];
  /** The caller's own saved scores, by submission. Never anyone else's, never an AI score. */
  mine: Record<string, OwnJudgeScore>;
}

/**
 * Finalists in pitch order (hackathon_finals_for_judge: judges cannot read
 * hackathon_finalists, whose row order would leak AI rank) and the caller's
 * own scores. Call only for a released hackathon.
 */
export async function loadJudgeConsole(db: Db, hackathonId: string, userId: string): Promise<JudgeConsole> {
  const [finals, scores] = await Promise.all([
    db.rpc("hackathon_finals_for_judge", { p_hackathon_id: hackathonId }),
    db
      .from("hackathon_judge_scores")
      .select("submission_id, clarity, structure, accuracy, connections, pitch, note")
      .eq("hackathon_id", hackathonId)
      .eq("judge_id", userId),
  ]);
  if (finals.error) throw new StaffQueryError("read finalists", finals.error.code);
  if (scores.error) throw new StaffQueryError("read own scores", scores.error.code);

  const finalists = (finals.data ?? [])
    .map((f) => ({
      submission_id: f.submission_id,
      team_name: f.team_name,
      project_slug: f.project_slug,
      pitch_order: f.pitch_order,
    }))
    // The RPC already orders by pitch_order then submission_id; kept stable here too.
    .sort(
      (a, b) =>
        (a.pitch_order ?? Number.MAX_SAFE_INTEGER) - (b.pitch_order ?? Number.MAX_SAFE_INTEGER) ||
        (a.submission_id < b.submission_id ? -1 : a.submission_id > b.submission_id ? 1 : 0),
    );

  const mine: Record<string, OwnJudgeScore> = {};
  for (const s of (scores.data ?? []) as OwnJudgeScore[]) mine[s.submission_id] = s;
  return { finalists, mine };
}
