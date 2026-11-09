import Anthropic from "@anthropic-ai/sdk";

import { checkEligibility } from "@/lib/hackathon/eligibility";
import {
  createGraderClient,
  gradeOnce,
  graderModel,
  GraderError,
  GraderRefusalError,
  GraderTruncatedError,
  type GradeResult,
  type GraderClient,
} from "@/lib/hackathon/grader";
import {
  GradingStoreError,
  supabaseGradingStore,
  type ClaimedJob,
  type CompletedRun,
  type GradingStore,
  type JobFailure,
  type VersionProgress,
} from "@/lib/hackathon/grading-store";
import { buildGradingRequest, MAX_IMAGES, type GradingImage } from "@/lib/hackathon/prompt";
import {
  clampScore,
  combineRuns,
  InvalidAiRunError,
  MAX_RUNS,
  runTotal,
  type CombinedRuns,
} from "@/lib/hackathon/rubric";
import { createServiceClient, serviceSecretKey } from "@/lib/hackathon/service-client";
import { AI_FLAGS, CRITERION_KEYS, type AiRunOutput, type EligibilityResult } from "@/lib/hackathon/types";

/**
 * The hidden AI review worker (WP-4.7, D-116, D-119).
 *
 * Takes leased jobs from the grading queue (claim_grading_jobs), gates each
 * entry on the deterministic eligibility rules, runs one Claude review per
 * job and records it, retries failures with jittered backoff, and queues the
 * third run when two runs disagree. Two entry points:
 *
 *   runGradingFor(versionId)  right after a submit, from `after()`.
 *   runSweep()                every minute from pg_cron, daily from Vercel
 *                             Cron, through /api/cron/grade-hackathon.
 *
 * Both run the same loop: keep up to 20 jobs in flight, claim more as slots
 * free while at least MIN_START_MS of the budget is left, and abort any
 * model call at the end of the budget or 10 s before its lease ends,
 * whichever is first. The database caps running jobs at 20 across all
 * workers and returns an expired lease to the queue; every write passes the
 * claim's attempt number, so a stale holder records nothing.
 *
 * Failures:
 *   refusal, cut-off answer, invalid output    permanent: failed at once
 *   provider 429 / 529 / overloaded            not counted; retry-after honoured
 *   aborted at the end of the run budget       not counted
 *   anything else (lease abort included)       counted; 30 s, then 60 s
 * Every delay gets ±30% jitter (retry-after only upwards), so 60 teams that
 * failed together do not retry together.
 *
 * Logs carry the version id, run number, status and timing only: never a
 * score, evidence, summary, flag, team name or any submission text.
 */

/** Jobs in flight at once; the database caps running jobs at the same number. */
export const MAX_CONCURRENT_JOBS = 20;
export const LEASE_SECONDS = 200;
export const SWEEP_BUDGET_MS = 240_000;
/** No new job is claimed with less than this left of the budget. */
export const MIN_START_MS = 100_000;
/** A model call is aborted this long before its job's lease ends. */
export const LEASE_MARGIN_MS = 10_000;
/** Seconds before a counted failure is retried: after the first, then after the second. */
export const RETRY_AFTER_SECONDS = [30, 60] as const;
/** Provider overload without a retry-after header. */
export const OVERLOAD_RETRY_SECONDS = 30;
/** A job aborted by the end of the run budget goes back almost at once. */
export const BUDGET_ABORT_RETRY_SECONDS = 5;
/** ±30% on every delay. */
export const JITTER = 0.3;
/** fail_grading_job() caps delays at an hour. */
export const MAX_RETRY_SECONDS = 3600;

export function retryAfterSeconds(attempts: number): number {
  return attempts <= 1 ? RETRY_AFTER_SECONDS[0] : RETRY_AFTER_SECONDS[1];
}

/** `base` ±30%, from a random number in [0, 1). Whole seconds, at least 1 when base > 0. */
export function jittered(base: number, random: number): number {
  if (base <= 0) return 0;
  return Math.min(MAX_RETRY_SECONDS, Math.max(1, Math.round(base * (1 - JITTER + 2 * JITTER * random))));
}

/**
 * The provider's own delay, in seconds: `retry-after-ms`, else `retry-after`
 * (seconds or an HTTP date). Null when absent or unreadable.
 */
export function providerRetryAfter(headers: Headers | undefined, nowMs: number): number | null {
  if (!headers) return null;
  const ms = Number(headers.get("retry-after-ms"));
  if (headers.get("retry-after-ms") != null && Number.isFinite(ms) && ms >= 0) return ms / 1000;
  const value = headers.get("retry-after");
  if (value == null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, (date - nowMs) / 1000) : null;
}

function isOverload(error: unknown): error is InstanceType<typeof Anthropic.APIError> {
  if (!(error instanceof Anthropic.APIError) || error instanceof Anthropic.APIUserAbortError) return false;
  return (
    error.status === 429 ||
    error.status === 529 ||
    error.type === "overloaded_error" ||
    error.type === "rate_limit_error"
  );
}

/** Why the worker aborted a model call, carried as the abort reason. */
export type AbortCause = "budget" | "lease";

/** The model call was aborted by the worker, not by the provider. */
export class GradingAbortError extends Error {
  readonly abortCause: AbortCause;

  constructor(abortCause: AbortCause) {
    super(abortCause === "budget" ? "model call aborted: run budget spent" : "model call aborted: lease ending");
    this.name = "GradingAbortError";
    this.abortCause = abortCause;
  }
}

/** A short, content-free description of a failure, stored in last_error. */
export function describeError(error: unknown): string {
  if (error instanceof GradingAbortError) return error.message;
  if (error instanceof GraderRefusalError) return `refusal${error.category ? ` (${error.category})` : ""}`;
  if (error instanceof GraderTruncatedError) return `output cut off (${error.stopReason})`;
  if (error instanceof GraderError) return `unexpected stop (${error.stopReason ?? "none"})`;
  if (error instanceof InvalidAiRunError) return `invalid model output: ${error.issues.join("; ")}`;
  if (error instanceof Anthropic.APIUserAbortError) return "model call aborted";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "model call timed out";
  if (error instanceof Anthropic.APIConnectionError) return "model call could not connect";
  if (isOverload(error)) return `model API overloaded (${error.status ?? error.type})`;
  if (error instanceof Anthropic.APIError) return `model API error ${error.status ?? "unknown"}`;
  if (error instanceof GradingStoreError) return error.message;
  if (error instanceof Error) return error.name;
  return "unknown error";
}

/** How a failed attempt goes back to the queue. `random` in [0, 1). */
export function planFailure(error: unknown, attempts: number, random: number, nowMs: number): JobFailure {
  const description = describeError(error);
  if (
    error instanceof GraderRefusalError ||
    error instanceof GraderTruncatedError ||
    error instanceof InvalidAiRunError
  ) {
    return { error: description, retryAfterSeconds: 0, permanent: true, countAttempt: false };
  }
  if (isOverload(error)) {
    const asked = providerRetryAfter(error.headers, nowMs);
    const seconds =
      asked == null
        ? jittered(OVERLOAD_RETRY_SECONDS, random)
        : // Never earlier than the provider asked: jitter only adds.
          Math.min(MAX_RETRY_SECONDS, Math.ceil(asked * (1 + JITTER * random)));
    return { error: description, retryAfterSeconds: seconds, permanent: false, countAttempt: false };
  }
  if (error instanceof GradingAbortError && error.abortCause === "budget") {
    return {
      error: description,
      retryAfterSeconds: jittered(BUDGET_ABORT_RETRY_SECONDS, random),
      permanent: false,
      countAttempt: false,
    };
  }
  return {
    error: description,
    retryAfterSeconds: jittered(retryAfterSeconds(attempts), random),
    permanent: false,
    countAttempt: true,
  };
}

export type JobOutcome = "graded" | "ineligible" | "superseded" | "retrying" | "failed" | "error";

/** Where a version's grade stands after one of its jobs settled. */
export type VersionState =
  | "open" // a job is still pending or running
  | "no_runs" // nothing counted (ineligible, or every run failed)
  | "incomplete" // one counted run and nothing left to come
  | "needs_third_run"
  | "final";

export interface VersionGrade {
  state: VersionState;
  /** combineRuns over the counted runs; null without any. */
  combined: CombinedRuns | null;
}

function storedToRun(run: VersionProgress["runs"][number]): AiRunOutput {
  return { criteria: run.criteria, summary: "", flags: run.flags };
}

/**
 * The grade a version's counted runs give once none of its jobs is open.
 * When two runs disagree but the version already had a third job that
 * produced no run (it failed, permanently or after three tries), the two-run
 * mean stands as final and `disagreement` is added here, in code.
 */
export function versionGrade(progress: VersionProgress): VersionGrade {
  if (progress.jobs.some((j) => j.status === "pending" || j.status === "running")) {
    return { state: "open", combined: null };
  }
  const runs = progress.runs.slice(0, MAX_RUNS).map(storedToRun);
  if (runs.length === 0) return { state: "no_runs", combined: null };

  const combined = combineRuns(runs);
  if (combined.status === "needs_second_run") return { state: "incomplete", combined };
  if (combined.status === "final") return { state: "final", combined };

  const thirdTried = progress.jobs.length >= MAX_RUNS;
  if (!thirdTried) return { state: "needs_third_run", combined };
  const flags = AI_FLAGS.filter((f) => f === "disagreement" || combined.flags.includes(f));
  return { state: "final", combined: { ...combined, status: "final", flags } };
}

/** Everything the worker logs. Nothing else is ever written. */
export type WorkerLogEvent =
  | { event: "grading_job"; version_id: string; run_no: number; status: JobOutcome; ms: number }
  | {
      event: "grading_version";
      version_id: string;
      status: VersionState | "third_run_queued" | "error";
      ms: number;
    }
  | ({ event: "grading_sweep"; ms: number } & SweepCounts);

export interface WorkerDeps {
  store: GradingStore;
  client: GraderClient;
  /** Epoch ms. */
  now?: () => number;
  /** In [0, 1), for jitter. */
  random?: () => number;
  log?: (event: WorkerLogEvent) => void;
  model?: string;
}

export interface SweepCounts {
  claimed: number;
  graded: number;
  ineligible: number;
  superseded: number;
  retrying: number;
  failed: number;
  errors: number;
  third_runs_queued: number;
}

export interface SweepOptions {
  budgetMs?: number;
  /** Only this version's jobs (runGradingFor). */
  versionId?: string;
}

function defaultLog(event: WorkerLogEvent): void {
  const line = JSON.stringify(event);
  if ("status" in event && (event.status === "failed" || event.status === "error")) console.warn(line);
  else console.info(line);
}

/** The run as stored: clamped scores, the code's total and flags. */
export function completedRun(
  run: AiRunOutput,
  meta: {
    model: string;
    stopReason: string;
    usage: CompletedRun["usage"];
    truncated: boolean;
    imagesUnreadable: boolean;
  },
): CompletedRun {
  const criteria = {} as CompletedRun["criteria"];
  for (const key of CRITERION_KEYS) {
    criteria[key] = { score: clampScore(run.criteria[key].score), evidence: run.criteria[key].evidence };
  }
  // `disagreement` belongs to the combined grade; `truncated_input` is the
  // code's alone; `images_unreadable` is the model's or the code's.
  const flags = AI_FLAGS.filter((f) => {
    if (f === "disagreement") return false;
    if (f === "truncated_input") return meta.truncated;
    if (f === "images_unreadable") return meta.imagesUnreadable || run.flags.includes(f);
    return run.flags.includes(f);
  });
  return {
    model: meta.model,
    criteria,
    total: runTotal(run),
    flags,
    summary: run.summary,
    stopReason: meta.stopReason,
    usage: meta.usage,
    truncated: meta.truncated,
  };
}

function ineligibleReason(eligibility: EligibilityResult, override: boolean | null): string {
  if (override === false) return "not graded: ineligible by admin override";
  const failed = eligibility.rules.filter((r) => !r.passed).map((r) => r.id);
  return `not graded: ineligible (${failed.join(", ") || "no rule passed"})`;
}

/** Outcomes after which a version's grade can have changed. */
const SETTLED: ReadonlySet<JobOutcome> = new Set(["graded", "ineligible", "failed"]);

/** One loop over the queue with its own per-version caches. */
class Sweep {
  readonly counts: SweepCounts = {
    claimed: 0,
    graded: 0,
    ineligible: 0,
    superseded: 0,
    retrying: 0,
    failed: 0,
    errors: 0,
    third_runs_queued: 0,
  };
  private readonly store: GradingStore;
  private readonly client: GraderClient;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly log: (event: WorkerLogEvent) => void;
  private readonly model: string;
  private readonly eligibilityStored = new Map<string, Promise<void>>();
  private readonly images = new Map<string, Promise<(GradingImage | null)[]>>();
  private readonly thirdRunQueued = new Set<string>();
  private deadline = 0;

  constructor(deps: WorkerDeps) {
    this.store = deps.store;
    this.client = deps.client;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.log = deps.log ?? defaultLog;
    this.model = deps.model ?? graderModel();
  }

  async run(options: SweepOptions): Promise<SweepCounts> {
    const started = this.now();
    this.deadline = started + (options.budgetMs ?? SWEEP_BUDGET_MS);
    const inFlight = new Set<Promise<void>>();
    let queueEmpty = false;

    for (;;) {
      const free = MAX_CONCURRENT_JOBS - inFlight.size;
      if (!queueEmpty && free > 0 && this.deadline - this.now() >= MIN_START_MS) {
        let jobs: ClaimedJob[] = [];
        try {
          jobs = await this.store.claimJobs({
            limit: free,
            leaseSeconds: LEASE_SECONDS,
            versionId: options.versionId,
          });
        } catch {
          this.counts.errors += 1;
          queueEmpty = true;
        }
        if (jobs.length === 0) queueEmpty = true;
        for (const job of jobs.slice(0, free)) {
          this.counts.claimed += 1;
          const p: Promise<void> = this.process(job).finally(() => inFlight.delete(p));
          inFlight.add(p);
        }
      }
      if (inFlight.size === 0) break;
      await Promise.race(inFlight);
      // A settled job may have queued a third run or freed a slot.
      queueEmpty = false;
    }

    this.log({ event: "grading_sweep", ms: this.now() - started, ...this.counts });
    return this.counts;
  }

  private async process(job: ClaimedJob): Promise<void> {
    const started = this.now();
    let outcome: JobOutcome;
    try {
      outcome = await this.grade(job);
    } catch (error) {
      outcome = await this.fail(job, error);
    }
    this.counts[outcome === "error" ? "errors" : outcome] += 1;
    this.log({
      event: "grading_job",
      version_id: job.versionId,
      run_no: job.runNo,
      status: outcome,
      ms: this.now() - started,
    });
    if (SETTLED.has(outcome)) await this.settleVersion(job.versionId);
  }

  private async grade(job: ClaimedJob): Promise<JobOutcome> {
    if (job.currentVersionId !== job.versionId) {
      await this.store.skipJob(job.jobId, job.attempts, "not graded: no longer the current version");
      return "superseded";
    }

    const eligibility =
      job.storedEligibility ??
      checkEligibility({
        window: job.window,
        teamMemberIds: job.memberIds,
        snapshot: job.qditSnapshot,
        doqtri: job.doqtriSnapshot,
        hasGlobalMindmapImage: job.imagePaths.length > 0,
      });
    if (!job.storedEligibility) await this.storeEligibility(job.versionId, eligibility);

    const eligible = job.eligibilityOverride ?? eligibility.eligible;
    if (!eligible) {
      const result = await this.store.skipJob(
        job.jobId,
        job.attempts,
        ineligibleReason(eligibility, job.eligibilityOverride),
      );
      return result === "done" ? "ineligible" : "superseded";
    }

    const images = await this.readImages(job);
    const request = buildGradingRequest({
      teamName: job.teamName,
      qdit: job.qditSnapshot,
      doqtri: job.doqtriSnapshot,
      window: job.window,
      eligibility,
      images,
    });

    const leaseEnd = Date.parse(job.leaseUntil) - LEASE_MARGIN_MS;
    const cause: AbortCause = this.deadline <= leaseEnd ? "budget" : "lease";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(cause), Math.max(0, Math.min(leaseEnd, this.deadline) - this.now()));
    let graded: GradeResult;
    try {
      graded = await gradeOnce(this.client, request, { model: this.model, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new GradingAbortError(cause);
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const result = await this.store.completeJob(
      job.jobId,
      job.attempts,
      completedRun(graded.run, {
        model: graded.model,
        stopReason: graded.stop_reason,
        usage: graded.usage,
        truncated: request.truncated,
        imagesUnreadable: request.imagesUnreadable,
      }),
    );
    return result === "done" ? "graded" : "superseded";
  }

  private async fail(job: ClaimedJob, error: unknown): Promise<JobOutcome> {
    try {
      const plan = planFailure(error, job.attempts, this.random(), this.now());
      const status = await this.store.failJob(job.jobId, job.attempts, plan);
      return status === "pending" ? "retrying" : status === "failed" ? "failed" : "superseded";
    } catch {
      // The lease runs out and claim_grading_jobs() puts it back (or fails it).
      return "error";
    }
  }

  /** Once per version per sweep; a failure is dropped so the next job tries again. */
  private storeEligibility(versionId: string, eligibility: EligibilityResult): Promise<void> {
    let pending = this.eligibilityStored.get(versionId);
    if (!pending) {
      pending = this.store.setVersionEligibility(versionId, eligibility);
      pending.catch(() => this.eligibilityStored.delete(versionId));
      this.eligibilityStored.set(versionId, pending);
    }
    return pending;
  }

  /**
   * The version's maps, one read each, once per sweep for all its runs. A map
   * that is missing, unreadable or too large is a null slot, never an error.
   */
  private readImages(job: ClaimedJob): Promise<(GradingImage | null)[]> {
    let pending = this.images.get(job.versionId);
    if (!pending) {
      pending = Promise.all(
        job.imagePaths.slice(0, MAX_IMAGES).map(async (path) => {
          try {
            const read = await this.store.readImage(path);
            return read.ok ? read.image : null;
          } catch {
            return null;
          }
        }),
      );
      this.images.set(job.versionId, pending);
    }
    return pending;
  }

  /**
   * After any job of a version settles (done, skipped or failed): once none
   * is open, combine its counted runs; two that disagree get a third
   * (enqueue_third_run, also guarded in the database), at most once per sweep.
   */
  private async settleVersion(versionId: string): Promise<void> {
    const started = this.now();
    try {
      const grade = versionGrade(await this.store.readVersionProgress(versionId));
      if (grade.state === "open") return;
      let status: VersionState | "third_run_queued" = grade.state;
      if (grade.state === "needs_third_run" && !this.thirdRunQueued.has(versionId)) {
        this.thirdRunQueued.add(versionId);
        const id = await this.store.enqueueThirdRun(versionId);
        if (id) {
          this.counts.third_runs_queued += 1;
          status = "third_run_queued";
        }
      }
      this.log({ event: "grading_version", version_id: versionId, status, ms: this.now() - started });
    } catch {
      this.thirdRunQueued.delete(versionId);
      this.log({ event: "grading_version", version_id: versionId, status: "error", ms: this.now() - started });
    }
  }
}

/** The service-role store and the Anthropic client from the environment; null (logged) when unset. */
export function productionWorkerDeps(): WorkerDeps | null {
  const secret = serviceSecretKey();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!secret || !apiKey) {
    console.error(
      `hackathon grader: ${!secret ? "SUPABASE_SECRET_KEY" : "ANTHROPIC_API_KEY"} is not set, so nothing is graded. See web/.env.example.`,
    );
    return null;
  }
  return { store: supabaseGradingStore(createServiceClient(secret)), client: createGraderClient(apiKey) };
}

/**
 * Sweep the whole queue within the budget. Without `deps`, the production
 * store and client from the environment; throws when they are not configured.
 */
export async function runSweep(
  options: Omit<SweepOptions, "versionId"> = {},
  deps: WorkerDeps | null = productionWorkerDeps(),
): Promise<SweepCounts> {
  if (!deps) throw new Error("hackathon grader is not configured");
  return new Sweep(deps).run({ budgetMs: options.budgetMs ?? SWEEP_BUDGET_MS });
}

/**
 * Grade one version's queued runs now (the submit action's `after()`).
 * Never throws; with no configuration it logs and returns null, and the
 * minute sweep picks the jobs up once it is fixed.
 */
export async function runGradingFor(
  versionId: string,
  deps: WorkerDeps | null = productionWorkerDeps(),
  options: Omit<SweepOptions, "versionId"> = {},
): Promise<SweepCounts | null> {
  if (!deps) return null;
  try {
    return await new Sweep(deps).run({ budgetMs: options.budgetMs ?? SWEEP_BUDGET_MS, versionId });
  } catch {
    console.error(`hackathon grader: grading run for version ${versionId} failed`);
    return null;
  }
}
