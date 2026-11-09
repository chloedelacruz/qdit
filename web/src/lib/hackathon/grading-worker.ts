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
} from "@/lib/hackathon/grading-store";
import { buildGradingRequest, MAX_IMAGES, type GradingImage } from "@/lib/hackathon/prompt";
import { clampScore, combineRuns, InvalidAiRunError, MAX_RUNS, runTotal } from "@/lib/hackathon/rubric";
import { createServiceClient, serviceSecretKey } from "@/lib/hackathon/service-client";
import { AI_FLAGS, CRITERION_KEYS, type AiRunOutput, type EligibilityResult } from "@/lib/hackathon/types";

/**
 * The hidden AI review worker (WP-4.7, D-116, D-119).
 *
 * Takes leased jobs from the grading queue (claim_grading_jobs), gates each
 * entry on the deterministic eligibility rules, runs one Claude review per
 * job and records it, retries failures with backoff, and queues the third
 * run when two runs disagree. Two entry points:
 *
 *   runGradingFor(versionId)  right after a submit, from `after()`.
 *   runSweep()                every minute from pg_cron, daily from Vercel
 *                             Cron, through /api/cron/grade-hackathon.
 *
 * Both run the same loop: keep up to 20 jobs in flight, claim more as slots
 * free while at least MIN_START_MS of the budget is left, and abort any
 * model call at the end of the budget or 10 s before its lease ends,
 * whichever is first. The database caps running jobs at 20 across all
 * workers and returns an expired lease to the queue.
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
/** Seconds before a failed attempt is retried: after the first, then after the second. */
export const RETRY_AFTER_SECONDS = [30, 60] as const;

export function retryAfterSeconds(attempts: number): number {
  return attempts <= 1 ? RETRY_AFTER_SECONDS[0] : RETRY_AFTER_SECONDS[1];
}

export type JobOutcome = "graded" | "ineligible" | "superseded" | "retrying" | "failed" | "error";

/** Everything the worker logs. Nothing else is ever written. */
export type WorkerLogEvent =
  | { event: "grading_job"; version_id: string; run_no: number; status: JobOutcome; ms: number }
  | { event: "grading_third_run"; version_id: string; status: "queued" | "not_needed" | "error"; ms: number }
  | ({ event: "grading_sweep"; ms: number } & SweepCounts);

export interface WorkerDeps {
  store: GradingStore;
  client: GraderClient;
  /** Epoch ms. */
  now?: () => number;
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

/** A short, content-free description of a failure, stored in last_error. */
export function describeError(error: unknown): string {
  if (error instanceof GraderRefusalError) return `refusal${error.category ? ` (${error.category})` : ""}`;
  if (error instanceof GraderTruncatedError) return `output cut off (${error.stopReason})`;
  if (error instanceof GraderError) return `unexpected stop (${error.stopReason ?? "none"})`;
  if (error instanceof InvalidAiRunError) return `invalid model output: ${error.issues.join("; ")}`;
  if (error instanceof Anthropic.APIUserAbortError) return "model call aborted: out of time";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "model call timed out";
  if (error instanceof Anthropic.APIConnectionError) return "model call could not connect";
  if (error instanceof Anthropic.APIError) return `model API error ${error.status ?? "unknown"}`;
  if (error instanceof GradingStoreError) return error.message;
  if (error instanceof Error) return error.name;
  return "unknown error";
}

/** The run as stored: clamped scores, the code's total and flags. */
export function completedRun(
  run: AiRunOutput,
  meta: { model: string; stopReason: string; usage: CompletedRun["usage"]; truncated: boolean },
): CompletedRun {
  const criteria = {} as CompletedRun["criteria"];
  for (const key of CRITERION_KEYS) {
    criteria[key] = { score: clampScore(run.criteria[key].score), evidence: run.criteria[key].evidence };
  }
  // `disagreement` belongs to the combined grade, `truncated_input` to the code.
  const flags = AI_FLAGS.filter(
    (f) => (f !== "disagreement" && f !== "truncated_input" && run.flags.includes(f)) ||
      (f === "truncated_input" && meta.truncated),
  );
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
  private readonly log: (event: WorkerLogEvent) => void;
  private readonly model: string;
  private readonly eligibilityStored = new Map<string, Promise<void>>();
  private readonly images = new Map<string, Promise<GradingImage[]>>();
  private readonly thirdRunChecked = new Set<string>();
  private deadline = 0;

  constructor(deps: WorkerDeps) {
    this.store = deps.store;
    this.client = deps.client;
    this.now = deps.now ?? Date.now;
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
      // A settled job may have queued a third run or freed a version's slot.
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
    this.count(outcome);
    this.log({
      event: "grading_job",
      version_id: job.versionId,
      run_no: job.runNo,
      status: outcome,
      ms: this.now() - started,
    });
    if (outcome === "graded") await this.checkThirdRun(job.versionId);
  }

  private count(outcome: JobOutcome): void {
    const key = outcome === "error" ? "errors" : outcome;
    this.counts[key] += 1;
  }

  private async grade(job: ClaimedJob): Promise<JobOutcome> {
    const context = await this.store.readJobContext(job);
    if (context.jobStatus !== "running") return "superseded";
    if (!context.isCurrentVersion) {
      await this.store.skipJob(job.jobId, "not graded: no longer the current version");
      return "superseded";
    }

    const eligibility =
      context.eligibility ??
      checkEligibility({
        window: job.window,
        teamMemberIds: job.memberIds,
        snapshot: job.qditSnapshot,
        doqtri: job.doqtriSnapshot,
        hasGlobalMindmapImage: job.imagePaths.length > 0,
      });
    if (!context.eligibility) await this.storeEligibility(job.versionId, eligibility);

    const eligible = context.eligibilityOverride ?? eligibility.eligible;
    if (!eligible) {
      const result = await this.store.skipJob(job.jobId, ineligibleReason(eligibility, context.eligibilityOverride));
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

    const abortAt = Math.min(Date.parse(job.leaseUntil) - LEASE_MARGIN_MS, this.deadline);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, abortAt - this.now()));
    let graded: GradeResult;
    try {
      graded = await gradeOnce(this.client, request, { model: this.model, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    const result = await this.store.completeJob(
      job.jobId,
      completedRun(graded.run, {
        model: graded.model,
        stopReason: graded.stop_reason,
        usage: graded.usage,
        truncated: request.truncated,
      }),
    );
    return result === "done" ? "graded" : "superseded";
  }

  private async fail(job: ClaimedJob, error: unknown): Promise<JobOutcome> {
    try {
      const status = await this.store.failJob(job.jobId, describeError(error), retryAfterSeconds(job.attempts));
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

  /** The version's maps, read once per sweep for all its runs. */
  private readImages(job: ClaimedJob): Promise<GradingImage[]> {
    let pending = this.images.get(job.versionId);
    if (!pending) {
      pending = Promise.all(job.imagePaths.slice(0, MAX_IMAGES).map((path) => this.store.readImage(path)));
      pending.catch(() => this.images.delete(job.versionId));
      this.images.set(job.versionId, pending);
    }
    return pending;
  }

  /**
   * When none of the version's jobs is still open, combine its counted runs;
   * two that disagree get a third (enqueue_third_run, which is also guarded in
   * the database). At most once per version per sweep.
   */
  private async checkThirdRun(versionId: string): Promise<void> {
    if (this.thirdRunChecked.has(versionId)) return;
    const started = this.now();
    try {
      const progress = await this.store.readVersionProgress(versionId);
      if (progress.jobs.some((j) => j.status === "pending" || j.status === "running")) return;
      if (progress.runs.length === 0 || progress.runs.length > MAX_RUNS) return;
      if (this.thirdRunChecked.has(versionId)) return;
      this.thirdRunChecked.add(versionId);

      if (combineRuns(progress.runs).status !== "needs_third_run") {
        this.log({ event: "grading_third_run", version_id: versionId, status: "not_needed", ms: this.now() - started });
        return;
      }
      const id = await this.store.enqueueThirdRun(versionId);
      if (id) this.counts.third_runs_queued += 1;
      this.log({
        event: "grading_third_run",
        version_id: versionId,
        status: id ? "queued" : "not_needed",
        ms: this.now() - started,
      });
    } catch {
      this.thirdRunChecked.delete(versionId);
      this.log({ event: "grading_third_run", version_id: versionId, status: "error", ms: this.now() - started });
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
