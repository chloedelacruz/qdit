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
 * enough to stop.
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
   * 0–100, 2 decimals. One run: that run. Two runs: the mean. Three or more:
   * the median of the run totals. Provisional unless `status` is "final".
   */
  total: number;
  /** Per criterion 0–10, same rule as `total` (mean of two, median of three). */
  perCriterion: Record<CriterionKey, number>;
  /** Union across runs, in `AI_FLAGS` order; "disagreement" added on a third run. */
  flags: AiFlag[];
  spread: CombinedSpread;
}

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Round to an integer and clamp to 0–10. Anything non-finite becomes 0. */
export function clampScore(score: number): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return 0;
  return Math.min(MAX_CRITERION_SCORE, Math.max(0, Math.round(score)));
}

function weighted(perCriterion: Record<CriterionKey, number>): number {
  let total = 0;
  for (const key of CRITERION_KEYS) {
    total += (perCriterion[key] / MAX_CRITERION_SCORE) * WEIGHTS[key];
  }
  return round2(total);
}

function clampedScores(run: AiRunOutput): Record<CriterionKey, number> {
  const out = {} as Record<CriterionKey, number>;
  for (const key of CRITERION_KEYS) out[key] = clampScore(run.criteria?.[key]?.score);
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
  for (const run of runs) for (const f of run.flags ?? []) seen.add(f);
  // AI_FLAGS order, and anything outside the known set is dropped.
  return AI_FLAGS.filter((f) => seen.has(f));
}

/**
 * Combine one to three runs for one submission.
 *
 * - 1 run → "needs_second_run".
 * - 2 runs → "needs_third_run" when the totals differ by more than 15 or any
 *   criterion by more than 4; otherwise "final" with the mean.
 * - 3+ runs → "final" with the median per criterion and the median total, and
 *   the "disagreement" flag.
 */
export function combineRuns(runs: readonly AiRunOutput[]): CombinedRuns {
  if (runs.length === 0) throw new RangeError("combineRuns needs at least one run");

  const scores = runs.map(clampedScores);
  const totals = scores.map(weighted);

  const spreadCriteria = {} as Record<CriterionKey, number>;
  for (const key of CRITERION_KEYS) spreadCriteria[key] = range(scores.map((s) => s[key]));
  const spread: CombinedSpread = { total: range(totals), criteria: spreadCriteria };

  const aggregate = runs.length >= 3 ? median : mean;
  const perCriterion = {} as Record<CriterionKey, number>;
  for (const key of CRITERION_KEYS) {
    perCriterion[key] = round2(aggregate(scores.map((s) => s[key])));
  }
  const total = round2(aggregate(totals));

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
