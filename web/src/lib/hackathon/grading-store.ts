import type { SupabaseClient } from "@supabase/supabase-js";

import type { GradeUsage } from "@/lib/hackathon/grader";
import type { GradingImage, GradingImageMediaType } from "@/lib/hackathon/prompt";
import type {
  AiFlag,
  CriterionKey,
  DoqtriSnapshotV1,
  EligibilityResult,
  HackathonWindow,
  QditSnapshotV1,
} from "@/lib/hackathon/types";
import type { Database } from "@/lib/types/database";

/**
 * Every database and Storage access of the hackathon grader (WP-4.7, D-116,
 * D-119), behind one interface. The worker depends on `GradingStore` only;
 * `supabaseGradingStore` is the production implementation over the service
 * role, against supabase/migrations/20261110100000_hackathons.sql. It calls
 * only the grader's service-role functions and the private bucket: no table
 * is read or written directly.
 *
 * Every write names the claim it settles (`attempt`, the job's attempts as
 * claimed): a job leased again after its lease ran out answers "stale" to
 * the earlier holder, so two workers never both record one job.
 *
 * Errors carry the operation and the PostgREST/Postgres code, never the
 * database's message: a constraint violation on hackathon_ai_runs would echo
 * the failing row, scores included, and these errors end up in logs.
 */

export type GradingJobStatus = "pending" | "running" | "done" | "failed" | "superseded";

/** One leased job with everything the grader reads: a claim_grading_jobs() row. */
export interface ClaimedJob {
  jobId: string;
  versionId: string;
  runNo: number;
  /** The job's attempts as of this claim; every write for it passes this back. */
  attempts: number;
  /** ISO 8601. The job goes back to the queue (or fails) after this. */
  leaseUntil: string;
  submissionId: string;
  hackathonId: string;
  projectId: string;
  teamName: string;
  memberIds: string[];
  /** Bucket hackathon-mindmaps; the first is the global mindmap. */
  imagePaths: string[];
  submittedAt: string;
  qditSnapshot: QditSnapshotV1;
  /** Null when the team pushed nothing, or retention removed it. */
  doqtriSnapshot: DoqtriSnapshotV1 | null;
  window: HackathonWindow;
  /** The entry's current version at claim time. */
  currentVersionId: string | null;
  /** The admin's call: true or false wins over the gate, null means the gate stands. */
  eligibilityOverride: boolean | null;
  /** The stored gate result; null until the grader stores one. */
  storedEligibility: EligibilityResult | null;
}

/** One counted run of a version (its job is done), as stored. */
export interface StoredRun {
  runNo: number;
  criteria: Record<CriterionKey, { score: number; evidence: string }>;
  total: number;
  flags: AiFlag[];
}

/** hackathon_version_progress(): the version's queue state and the runs that count. */
export interface VersionProgress {
  /** Every job of the version except superseded ones, by run number. */
  jobs: { runNo: number; status: GradingJobStatus }[];
  /** Runs whose job is done, by run number. Only these count (regrade supersedes the rest). */
  runs: StoredRun[];
}

/** One finished run, as complete_grading_job() stores it. */
export interface CompletedRun {
  model: string;
  /** Clamped integer scores and evidence per criterion. */
  criteria: Record<CriterionKey, { score: number; evidence: string }>;
  /** 0–100, computed by rubric.ts runTotal, never by the model. */
  total: number;
  flags: AiFlag[];
  summary: string;
  stopReason: string;
  usage: GradeUsage;
  truncated: boolean;
}

/** How a failed attempt goes back to the queue: fail_grading_job(). */
export interface JobFailure {
  /** Content-free; stored in last_error. */
  error: string;
  retryAfterSeconds: number;
  /** Fail now, whatever the attempts (refusal, cut-off or invalid output). */
  permanent: boolean;
  /** False for provider overload and budget aborts: the attempt is given back. */
  countAttempt: boolean;
}

/** A mindmap read: the image, or why it was dropped. Never a thrown error. */
export type ImageRead =
  | { ok: true; image: GradingImage }
  | { ok: false; reason: "missing" | "too_large" | "unsupported_type" | "unreadable" };

export interface GradingStore {
  /** Lease due jobs: claim_grading_jobs(). The database caps running jobs at 20. */
  claimJobs(args: { limit: number; leaseSeconds: number; versionId?: string }): Promise<ClaimedJob[]>;
  /** set_version_eligibility(). */
  setVersionEligibility(versionId: string, eligibility: EligibilityResult): Promise<void>;
  /** One mindmap from the private bucket. Resolves `{ ok: false }` instead of throwing. */
  readImage(path: string): Promise<ImageRead>;
  /** complete_grading_job(): stores the run and marks the job done; "stale" unless still running under `attempt`. */
  completeJob(jobId: string, attempt: number, run: CompletedRun): Promise<"done" | "stale">;
  /** skip_grading_job(): done without a run (an ineligible entry), the reason in last_error. */
  skipJob(jobId: string, attempt: number, reason: string): Promise<"done" | "stale">;
  /** fail_grading_job(). */
  failJob(jobId: string, attempt: number, failure: JobFailure): Promise<"pending" | "failed" | "stale">;
  /** hackathon_version_progress(). */
  readVersionProgress(versionId: string): Promise<VersionProgress>;
  /** enqueue_third_run(): the new job id, or null when not needed or not current. */
  enqueueThirdRun(versionId: string): Promise<string | null>;
}

/** A store call failed. `code` is PostgREST's or Postgres's, never a message. */
export class GradingStoreError extends Error {
  readonly operation: string;
  readonly code: string | null;

  constructor(operation: string, code: string | null) {
    super(`grading store: ${operation} failed${code ? ` (${code})` : ""}`);
    this.name = "GradingStoreError";
    this.operation = operation;
    this.code = code;
  }
}

export const MINDMAP_BUCKET = "hackathon-mindmaps";
/** The bucket's own limit, and the Messages API's per-image limit. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MEDIA_TYPES: Readonly<Record<string, GradingImageMediaType>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
const ALLOWED_MEDIA_TYPES: ReadonlySet<string> = new Set(Object.values(MEDIA_TYPES));

/** The media type of a stored map: the object's own type, else its extension. */
export function imageMediaType(path: string, blobType: string | null | undefined): GradingImageMediaType | null {
  const type = (blobType ?? "").split(";")[0].trim().toLowerCase();
  if (ALLOWED_MEDIA_TYPES.has(type)) return type as GradingImageMediaType;
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext ? (MEDIA_TYPES[ext] ?? null) : null;
}

/** Checks a downloaded object before reading its bytes: size first, then type. */
export async function imageFromBlob(path: string, blob: Blob): Promise<ImageRead> {
  if (blob.size > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };
  if (blob.size === 0) return { ok: false, reason: "unreadable" };
  const mediaType = imageMediaType(path, blob.type);
  if (!mediaType) return { ok: false, reason: "unsupported_type" };
  const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
  return { ok: true, image: { mediaType, base64 } };
}

const JOB_STATUSES: ReadonlySet<string> = new Set(["pending", "running", "done", "failed", "superseded"]);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function asDoqtriSnapshot(payload: unknown): DoqtriSnapshotV1 | null {
  if (payload == null) return null;
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.notes) ||
    !isRecord(payload.global_mindmap) ||
    !Array.isArray(payload.global_mindmap.nodes) ||
    !Array.isArray(payload.global_mindmap.links)
  ) {
    throw new GradingStoreError("read doqtri snapshot (unexpected shape)", null);
  }
  return payload as unknown as DoqtriSnapshotV1;
}

function asQditSnapshot(value: unknown): QditSnapshotV1 {
  if (!isRecord(value) || value.schema_version !== 1 || !Array.isArray(value.tasks)) {
    throw new GradingStoreError("read qdit snapshot (unexpected shape)", null);
  }
  return value as unknown as QditSnapshotV1;
}

function asEligibility(value: unknown): EligibilityResult | null {
  return isRecord(value) && typeof value.eligible === "boolean" && Array.isArray(value.rules)
    ? (value as unknown as EligibilityResult)
    : null;
}

/** A claim_grading_jobs() row. */
export interface ClaimRow {
  job_id: string;
  version_id: string;
  run_no: number;
  attempts: number;
  lease_until: string;
  submission_id: string;
  hackathon_id: string;
  project_id: string;
  team_name: string;
  member_ids: string[];
  image_paths: string[];
  submitted_at: string;
  qdit_snapshot: unknown;
  doqtri_snapshot: unknown;
  opens_at: string;
  closes_at: string;
  team_min: number;
  team_max: number;
  current_version_id: string | null;
  eligibility_override: boolean | null;
  eligibility: unknown;
}

export function toClaimedJob(row: ClaimRow): ClaimedJob {
  return {
    jobId: row.job_id,
    versionId: row.version_id,
    runNo: row.run_no,
    attempts: row.attempts,
    leaseUntil: row.lease_until,
    submissionId: row.submission_id,
    hackathonId: row.hackathon_id,
    projectId: row.project_id,
    teamName: row.team_name,
    memberIds: row.member_ids ?? [],
    imagePaths: row.image_paths ?? [],
    submittedAt: row.submitted_at,
    qditSnapshot: asQditSnapshot(row.qdit_snapshot),
    doqtriSnapshot: asDoqtriSnapshot(row.doqtri_snapshot),
    window: {
      opens_at: row.opens_at,
      closes_at: row.closes_at,
      team_min: row.team_min,
      team_max: row.team_max,
    },
    currentVersionId: row.current_version_id ?? null,
    eligibilityOverride: typeof row.eligibility_override === "boolean" ? row.eligibility_override : null,
    storedEligibility: asEligibility(row.eligibility),
  };
}

/** A hackathon_version_progress() answer. Throws on an unexpected shape. */
export function toVersionProgress(value: unknown): VersionProgress {
  if (!isRecord(value) || !Array.isArray(value.jobs) || !Array.isArray(value.runs)) {
    throw new GradingStoreError("read version progress (unexpected shape)", null);
  }
  const jobs = value.jobs.map((j) => {
    const row = j as { run_no?: unknown; status?: unknown };
    if (typeof row.run_no !== "number" || typeof row.status !== "string" || !JOB_STATUSES.has(row.status)) {
      throw new GradingStoreError("read version progress (unexpected job)", null);
    }
    return { runNo: row.run_no, status: row.status as GradingJobStatus };
  });
  const runs = value.runs.map((r) => {
    const row = r as { run_no?: unknown; criteria?: unknown; total?: unknown; flags?: unknown };
    if (typeof row.run_no !== "number" || !isRecord(row.criteria)) {
      throw new GradingStoreError("read version progress (unexpected run)", null);
    }
    return {
      runNo: row.run_no,
      criteria: row.criteria as StoredRun["criteria"],
      total: Number(row.total),
      flags: (Array.isArray(row.flags) ? row.flags : []) as AiFlag[],
    };
  });
  return { jobs, runs };
}

function fail(operation: string, error: { code?: string | null } | null): never {
  throw new GradingStoreError(operation, error?.code ?? null);
}

/**
 * The production store, over a service-role client (service-client.ts).
 *
 * The hackathon functions are not in this branch's hand-written `Database`
 * type yet (QDIT-43 adds them), so this calls them through an untyped view
 * of the client and checks shapes itself.
 */
export function supabaseGradingStore(client: SupabaseClient<Database>): GradingStore {
  const db = client as unknown as SupabaseClient;

  return {
    async claimJobs({ limit, leaseSeconds, versionId }) {
      const { data, error } = await db.rpc("claim_grading_jobs", {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
        p_version_id: versionId ?? null,
      });
      if (error) fail("claim_grading_jobs", error);
      return ((data ?? []) as ClaimRow[]).map(toClaimedJob);
    },

    async setVersionEligibility(versionId, eligibility) {
      const { error } = await db.rpc("set_version_eligibility", {
        p_version_id: versionId,
        p_eligibility: eligibility,
      });
      if (error) fail("set_version_eligibility", error);
    },

    async readImage(path) {
      try {
        const { data, error } = await db.storage.from(MINDMAP_BUCKET).download(path);
        if (error || !data) return { ok: false, reason: "missing" };
        return await imageFromBlob(path, data);
      } catch {
        return { ok: false, reason: "unreadable" };
      }
    },

    async completeJob(jobId, attempt, run) {
      const { data, error } = await db.rpc("complete_grading_job", {
        p_job_id: jobId,
        p_attempt: attempt,
        p_model: run.model,
        p_criteria: run.criteria,
        p_total: run.total,
        p_flags: run.flags,
        p_summary: run.summary,
        p_stop_reason: run.stopReason,
        p_usage: run.usage,
        p_truncated: run.truncated,
      });
      if (error) fail("complete_grading_job", error);
      return data === "done" ? "done" : "stale";
    },

    async skipJob(jobId, attempt, reason) {
      const { data, error } = await db.rpc("skip_grading_job", {
        p_job_id: jobId,
        p_attempt: attempt,
        p_reason: reason.slice(0, 2000),
      });
      if (error) fail("skip_grading_job", error);
      return data === "done" ? "done" : "stale";
    },

    async failJob(jobId, attempt, failure) {
      const { data, error } = await db.rpc("fail_grading_job", {
        p_job_id: jobId,
        p_attempt: attempt,
        p_error: failure.error.slice(0, 2000),
        p_retry_after_seconds: failure.retryAfterSeconds,
        p_permanent: failure.permanent,
        p_count_attempt: failure.countAttempt,
      });
      if (error) fail("fail_grading_job", error);
      return data === "pending" || data === "failed" ? data : "stale";
    },

    async readVersionProgress(versionId) {
      const { data, error } = await db.rpc("hackathon_version_progress", { p_version_id: versionId });
      if (error) fail("hackathon_version_progress", error);
      return toVersionProgress(data);
    },

    async enqueueThirdRun(versionId) {
      const { data, error } = await db.rpc("enqueue_third_run", { p_version_id: versionId });
      if (error) fail("enqueue_third_run", error);
      return typeof data === "string" ? data : null;
    },
  };
}
