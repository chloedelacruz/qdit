import type { SupabaseClient } from "@supabase/supabase-js";

import type { GradeUsage } from "@/lib/hackathon/grader";
import type { GradingImage, GradingImageMediaType } from "@/lib/hackathon/prompt";
import { parseAiRun } from "@/lib/hackathon/rubric";
import type {
  AiFlag,
  AiRunOutput,
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
 * role, against supabase/migrations/20261110100000_hackathons.sql.
 *
 * Errors carry the operation and the PostgREST/Postgres code, never the
 * database's message: a constraint violation on hackathon_ai_runs would echo
 * the failing row, scores included, and these errors end up in logs.
 */

export type GradingJobStatus = "pending" | "running" | "done" | "failed" | "superseded";

/** One leased job with everything the grader reads: claim_grading_jobs() row. */
export interface ClaimedJob {
  jobId: string;
  versionId: string;
  runNo: number;
  /** Claims so far, this one included (1–3). */
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
}

/** What may have changed since the claim. */
export interface JobContext {
  /** The job's status now; null when the row is gone. */
  jobStatus: GradingJobStatus | null;
  /** The version is still its submission's current one. */
  isCurrentVersion: boolean;
  /** The admin's call: true or false wins over the gate, null means the gate stands. */
  eligibilityOverride: boolean | null;
  /** The stored gate result; null until the grader stores one. */
  eligibility: EligibilityResult | null;
}

/** A version's queue state and the runs that count. */
export interface VersionProgress {
  /** Every job of the version except superseded ones. */
  jobs: { runNo: number; status: GradingJobStatus }[];
  /** Runs whose job is done, by run number. Only these count (regrade supersedes the rest). */
  runs: AiRunOutput[];
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

export interface GradingStore {
  /** Lease due jobs: claim_grading_jobs(). The database caps running jobs at 20. */
  claimJobs(args: { limit: number; leaseSeconds: number; versionId?: string }): Promise<ClaimedJob[]>;
  /** Job status, current version, override and stored eligibility, read now. */
  readJobContext(job: Pick<ClaimedJob, "jobId" | "versionId" | "submissionId">): Promise<JobContext>;
  /** set_version_eligibility(). */
  setVersionEligibility(versionId: string, eligibility: EligibilityResult): Promise<void>;
  /** One mindmap image from the private bucket, base64. Throws when unreadable. */
  readImage(path: string): Promise<GradingImage>;
  /** complete_grading_job(): stores the run and marks the job done; "stale" when no longer running. */
  completeJob(jobId: string, run: CompletedRun): Promise<"done" | "stale">;
  /** Marks a running job done without a run (an ineligible entry), with the reason in last_error. */
  skipJob(jobId: string, reason: string): Promise<"done" | "stale">;
  /** fail_grading_job(): back to pending after the delay while attempts < 3, else failed. */
  failJob(jobId: string, error: string, retryAfterSeconds: number): Promise<"pending" | "failed" | "stale">;
  /** The version's non-superseded jobs and its counted runs. */
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

interface ClaimRow {
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
}

function toClaimedJob(row: ClaimRow): ClaimedJob {
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
  };
}

function fail(operation: string, error: { code?: string | null } | null): never {
  throw new GradingStoreError(operation, error?.code ?? null);
}

/**
 * The production store, over a service-role client (service-client.ts).
 *
 * The hackathon tables and functions are not in the hand-written
 * `Database` type yet (QDIT-43 adds them), so this reads through an untyped
 * view of the client and checks shapes itself.
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

    async readJobContext({ jobId, versionId, submissionId }) {
      const [job, submission, version] = await Promise.all([
        db.from("hackathon_grading_jobs").select("status").eq("id", jobId).maybeSingle(),
        db
          .from("hackathon_submissions")
          .select("current_version_id, eligibility_override")
          .eq("id", submissionId)
          .maybeSingle(),
        db.from("hackathon_submission_versions").select("eligibility").eq("id", versionId).maybeSingle(),
      ]);
      if (job.error) fail("read job", job.error);
      if (submission.error) fail("read submission", submission.error);
      if (version.error) fail("read version", version.error);

      const status = (job.data as { status?: unknown } | null)?.status;
      const sub = submission.data as { current_version_id?: unknown; eligibility_override?: unknown } | null;
      const eligibility = (version.data as { eligibility?: unknown } | null)?.eligibility;
      return {
        jobStatus: typeof status === "string" && JOB_STATUSES.has(status) ? (status as GradingJobStatus) : null,
        isCurrentVersion: sub?.current_version_id === versionId,
        eligibilityOverride: typeof sub?.eligibility_override === "boolean" ? sub.eligibility_override : null,
        eligibility:
          isRecord(eligibility) && typeof eligibility.eligible === "boolean" && Array.isArray(eligibility.rules)
            ? (eligibility as unknown as EligibilityResult)
            : null,
      };
    },

    async setVersionEligibility(versionId, eligibility) {
      const { error } = await db.rpc("set_version_eligibility", {
        p_version_id: versionId,
        p_eligibility: eligibility,
      });
      if (error) fail("set_version_eligibility", error);
    },

    async readImage(path) {
      const { data, error } = await db.storage.from(MINDMAP_BUCKET).download(path);
      if (error || !data) throw new GradingStoreError("download mindmap image", null);
      const mediaType = imageMediaType(path, data.type);
      if (!mediaType) throw new GradingStoreError("download mindmap image (unsupported type)", null);
      const base64 = Buffer.from(await data.arrayBuffer()).toString("base64");
      return { mediaType, base64 };
    },

    async completeJob(jobId, run) {
      const { data, error } = await db.rpc("complete_grading_job", {
        p_job_id: jobId,
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

    async skipJob(jobId, reason) {
      // No RPC marks a job done without a run, so this is the one direct
      // write: the same transition complete_grading_job() makes, guarded on
      // the job still running so a superseded job stays superseded.
      const { data, error } = await db
        .from("hackathon_grading_jobs")
        .update({ status: "done", lease_until: null, last_error: reason.slice(0, 2000) })
        .eq("id", jobId)
        .eq("status", "running")
        .select("id");
      if (error) fail("skip job", error);
      return Array.isArray(data) && data.length > 0 ? "done" : "stale";
    },

    async failJob(jobId, error, retryAfterSeconds) {
      const { data, error: rpcError } = await db.rpc("fail_grading_job", {
        p_job_id: jobId,
        p_error: error.slice(0, 2000),
        p_retry_after_seconds: retryAfterSeconds,
      });
      if (rpcError) fail("fail_grading_job", rpcError);
      return data === "pending" || data === "failed" ? data : "stale";
    },

    async readVersionProgress(versionId) {
      const [jobs, runs] = await Promise.all([
        db
          .from("hackathon_grading_jobs")
          .select("run_no, status")
          .eq("version_id", versionId)
          .neq("status", "superseded")
          .order("run_no"),
        db
          .from("hackathon_ai_runs")
          .select("run_no, criteria, flags, summary")
          .eq("version_id", versionId)
          .order("run_no"),
      ]);
      if (jobs.error) fail("read version jobs", jobs.error);
      if (runs.error) fail("read version runs", runs.error);

      const jobRows = (jobs.data ?? []) as { run_no: number; status: string }[];
      const done = new Set(jobRows.filter((j) => j.status === "done").map((j) => j.run_no));
      const runRows = (runs.data ?? []) as { run_no: number; criteria: unknown; flags: unknown; summary: unknown }[];
      return {
        jobs: jobRows.map((j) => ({ runNo: j.run_no, status: j.status as GradingJobStatus })),
        runs: runRows
          .filter((r) => done.has(r.run_no))
          .map((r) => parseAiRun({ criteria: r.criteria, flags: r.flags ?? [], summary: r.summary ?? "" })),
      };
    },

    async enqueueThirdRun(versionId) {
      const { data, error } = await db.rpc("enqueue_third_run", { p_version_id: versionId });
      if (error) fail("enqueue_third_run", error);
      return typeof data === "string" ? data : null;
    },
  };
}
