import {
  AI_FLAGS,
  CRITERION_KEYS,
  type AiFlag,
  type AiRunOutput,
  type CriterionKey,
} from "@/lib/hackathon/types";

/**
 * The AI rubric arithmetic (WP-4.7, D-119).
 *
 * The model scores each criterion 0–10; this module, never the model, turns
 * those into a total out of 100 and decides whether the runs agree well
 * enough to stop. Raw model output goes through `parseAiRun` first; nothing
 * here turns a missing or malformed score into a number.
 */

/** Points per criterion. Sums to 100. */
export const WEIGHTS: Readonly<Record<CriterionKey, number>> = Object.freeze({
  clarity: 20,
  structure: 20,
  accuracy: 20,
  connections: 20,
  execution: 20,
});

export const MAX_CRITERION_SCORE = 10;
/** Two runs whose totals differ by more than this need a third. */
export const TOTAL_SPREAD_LIMIT = 15;
/** Two runs that differ on any one criterion by more than this need a third. */
export const CRITERION_SPREAD_LIMIT = 4;
/** A run's evidence string is cut to this many characters. */
export const MAX_EVIDENCE_CHARS = 2000;
/** One to three runs per submission: two, and a third on disagreement. */
export const MAX_RUNS = 3;

export type CombineStatus = "needs_second_run" | "needs_third_run" | "final";

export interface CombinedSpread {
  /** max − min of the run totals. */
  total: number;
  /** max − min of each criterion's clamped score across runs. */
  criteria: Record<CriterionKey, number>;
}

export interface CombinedRuns {
  status: CombineStatus;
  /**
   * 0–100, 2 decimals: always `Σ perCriterion/10 × weight`, so the stored
   * total matches the stored criteria. Provisional unless `status` is "final".
   */
  total: number;
  /** Per criterion 0–10: the one run, the mean of two, or the median of three. */
  perCriterion: Record<CriterionKey, number>;
  /** Union across runs, in `AI_FLAGS` order; "disagreement" added on a third run. */
  flags: AiFlag[];
  spread: CombinedSpread;
}

/** Model output that does not match the run schema. */
export class InvalidAiRunError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid AI run output: ${issues.join("; ")}`);
    this.name = "InvalidAiRunError";
    this.issues = issues;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const KNOWN_FLAGS: ReadonlySet<string> = new Set(AI_FLAGS);

/**
 * Validate one run's raw structured output.
 *
 * Every criterion must be present with a finite numeric `score` (a numeric
 * string is refused) and a string `evidence`, cut to 2000 characters.
 * `summary` must be a string and `flags` an array; flags outside `AI_FLAGS`
 * are dropped. Scores are not clamped here; `clampScore` does that.
 * Throws `InvalidAiRunError` listing every problem found.
 */
export function parseAiRun(raw: unknown): AiRunOutput {
  const issues: string[] = [];
  if (!isRecord(raw)) throw new InvalidAiRunError(["output is not an object"]);

  const criteria = {} as AiRunOutput["criteria"];
  if (!isRecord(raw.criteria)) {
    issues.push("criteria is not an object");
  } else {
    for (const key of CRITERION_KEYS) {
      const c = raw.criteria[key];
      if (!isRecord(c)) {
        issues.push(`criteria.${key} is missing`);
        continue;
      }
      const { score, evidence } = c;
      if (typeof score !== "number" || !Number.isFinite(score)) {
        issues.push(`criteria.${key}.score is not a finite number`);
      }
      if (typeof evidence !== "string") issues.push(`criteria.${key}.evidence is not a string`);
      if (typeof score === "number" && typeof evidence === "string") {
        criteria[key] = { score, evidence: evidence.slice(0, MAX_EVIDENCE_CHARS) };
      }
    }
  }

  if (typeof raw.summary !== "string") issues.push("summary is not a string");
  if (!Array.isArray(raw.flags)) issues.push("flags is not an array");
  if (issues.length > 0) throw new InvalidAiRunError(issues);

  const flags = [...new Set((raw.flags as unknown[]).filter((f) => KNOWN_FLAGS.has(f as string)))];
  return { criteria, summary: raw.summary as string, flags: flags as AiFlag[] };
}

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Round to an integer and clamp to 0–10. Throws a RangeError on a non-finite score. */
export function clampScore(score: number): number {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new RangeError(`Score is not a finite number: ${String(score)}`);
  }
  return Math.min(MAX_CRITERION_SCORE, Math.max(0, Math.round(score)));
}

function weighted(perCriterion: Record<CriterionKey, number>): number {
  let total = 0;
  for (const key of CRITERION_KEYS) {
    total += (perCriterion[key] / MAX_CRITERION_SCORE) * WEIGHTS[key];
  }
  return round2(total);
}

/** A parsed run's clamped scores. Throws `InvalidAiRunError` on a missing criterion. */
function clampedScores(run: AiRunOutput): Record<CriterionKey, number> {
  const out = {} as Record<CriterionKey, number>;
  for (const key of CRITERION_KEYS) {
    const score = run.criteria?.[key]?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new InvalidAiRunError([`criteria.${key}.score is missing or not a finite number`]);
    }
    out[key] = clampScore(score);
  }
  return out;
}

/** Σ score/10 × weight over the clamped scores: 0–100, 2 decimals. */
export function runTotal(run: AiRunOutput): number {
  return weighted(clampedScores(run));
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function range(xs: readonly number[]): number {
  return round2(Math.max(...xs) - Math.min(...xs));
}

function unionFlags(runs: readonly AiRunOutput[], extra: readonly AiFlag[] = []): AiFlag[] {
  const seen = new Set<string>(extra);
  for (const run of runs) for (const f of run.flags) seen.add(f);
  // AI_FLAGS order, and anything outside the known set is dropped.
  return AI_FLAGS.filter((f) => seen.has(f));
}

/**
 * Combine one to three parsed runs for one submission.
 *
 * - 1 run → "needs_second_run".
 * - 2 runs → "needs_third_run" when the totals differ by more than 15 or any
 *   criterion by more than 4; otherwise "final" with the mean.
 * - 3 runs → "final" with the median per criterion, the total of those
 *   medians, and the "disagreement" flag.
 *
 * Throws a RangeError for 0 or more than 3 runs, and `InvalidAiRunError` when
 * a run is missing a criterion score.
 */
export function combineRuns(runs: readonly AiRunOutput[]): CombinedRuns {
  if (runs.length === 0) throw new RangeError("combineRuns needs at least one run");
  if (runs.length > MAX_RUNS) {
    throw new RangeError(`combineRuns takes at most ${MAX_RUNS} runs, got ${runs.length}`);
  }

  const scores = runs.map(clampedScores);
  const totals = scores.map(weighted);

  const spreadCriteria = {} as Record<CriterionKey, number>;
  for (const key of CRITERION_KEYS) spreadCriteria[key] = range(scores.map((s) => s[key]));
  const spread: CombinedSpread = { total: range(totals), criteria: spreadCriteria };

  const aggregate = runs.length === MAX_RUNS ? median : mean;
  const perCriterion = {} as Record<CriterionKey, number>;
  for (const key of CRITERION_KEYS) {
    perCriterion[key] = round2(aggregate(scores.map((s) => s[key])));
  }
  const total = weighted(perCriterion);

  if (runs.length === 1) {
    return { status: "needs_second_run", total, perCriterion, flags: unionFlags(runs), spread };
  }

  if (runs.length === 2) {
    const disagree =
      spread.total > TOTAL_SPREAD_LIMIT ||
      CRITERION_KEYS.some((key) => spread.criteria[key] > CRITERION_SPREAD_LIMIT);
    return {
      status: disagree ? "needs_third_run" : "final",
      total,
      perCriterion,
      flags: unionFlags(runs),
      spread,
    };
  }

  return {
    status: "final",
    total,
    perCriterion,
    flags: unionFlags(runs, ["disagreement"]),
    spread,
  };
}
