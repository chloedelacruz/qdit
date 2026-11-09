import { round2 } from "@/lib/hackathon/rubric";
import { JUDGE_CRITERIA, type AiFlag, type JudgeScore } from "@/lib/hackathon/types";

/**
 * Finalists, the final order, and the CSV the organisers paste into slides
 * (WP-4.7, D-119).
 *
 * - The top 10 eligible submissions by AI total become finalists; a tie goes
 *   to the earlier final submission.
 * - Finalists are ordered by the judges' mean /25, tie → AI total. Every other
 *   eligible submission follows by AI total. Ineligible ones come last, unranked.
 */

export const FINALIST_COUNT = 10;

export interface FinalistCandidate {
  submission_id: string;
  eligible: boolean;
  /** Combined AI total 0–100, or null while grading has not finished. */
  ai_total: number | null;
  submitted_at: string;
}

export interface RankEntry extends FinalistCandidate {
  finalist: boolean;
  team_name: string;
  project_slug: string;
  flags: readonly AiFlag[];
}

export interface RankedRow extends RankEntry {
  /** 1-based; null for ineligible submissions. */
  final_rank: number | null;
  /** Mean across judges of each judge's 5-criterion sum (0–25, 2 decimals). */
  human_mean: number | null;
  judge_count: number;
}

/** Judge scores keyed by `submission_id`. */
export type JudgeScoresBySubmission = Readonly<Record<string, readonly JudgeScore[]>>;

function byAiTotalDesc(a: FinalistCandidate, b: FinalistCandidate): number {
  if (a.ai_total == null || b.ai_total == null) {
    if (a.ai_total == null && b.ai_total == null) return 0;
    return a.ai_total == null ? 1 : -1;
  }
  return b.ai_total - a.ai_total;
}

function bySubmittedAsc(a: FinalistCandidate, b: FinalistCandidate): number {
  const d = Date.parse(a.submitted_at) - Date.parse(b.submitted_at);
  if (Number.isFinite(d) && d !== 0) return d;
  return a.submission_id < b.submission_id ? -1 : a.submission_id > b.submission_id ? 1 : 0;
}

/** Top `n` eligible submissions with an AI total, highest first; tie → earlier submission. */
export function pickFinalists<T extends FinalistCandidate>(
  entries: readonly T[],
  n: number = FINALIST_COUNT,
): T[] {
  return entries
    .filter((e) => e.eligible && e.ai_total != null)
    .sort((a, b) => byAiTotalDesc(a, b) || bySubmittedAsc(a, b))
    .slice(0, Math.max(0, n));
}

export const MIN_JUDGE_SCORE = 1;
export const MAX_JUDGE_SCORE = 5;

/** A judge's /25 for one finalist. Throws a RangeError unless every criterion is an integer 1–5. */
export function judgeSum(score: JudgeScore): number {
  return JUDGE_CRITERIA.reduce((sum, key) => {
    const v = score[key];
    if (!Number.isInteger(v) || v < MIN_JUDGE_SCORE || v > MAX_JUDGE_SCORE) {
      throw new RangeError(
        `Judge ${score.judge_id} ${key} must be an integer ${MIN_JUDGE_SCORE}–${MAX_JUDGE_SCORE}, got ${String(v)}`,
      );
    }
    return sum + v;
  }, 0);
}

/** One score per judge; a later score from the same judge replaces the earlier one. */
export function dedupeJudgeScores(scores: readonly JudgeScore[]): JudgeScore[] {
  const byJudge = new Map<string, JudgeScore>();
  for (const s of scores) {
    byJudge.delete(s.judge_id);
    byJudge.set(s.judge_id, s);
  }
  return [...byJudge.values()];
}

/**
 * Mean of the judges' /25 sums (one per judge, last wins), 2 decimals; null
 * when nobody has scored. Throws a RangeError on an invalid score.
 */
export function humanMean(scores: readonly JudgeScore[] | undefined): number | null {
  if (!scores || scores.length === 0) return null;
  const unique = dedupeJudgeScores(scores);
  return round2(unique.reduce((sum, s) => sum + judgeSum(s), 0) / unique.length);
}

/**
 * The final order. Throws a RangeError when more than `FINALIST_COUNT`
 * entries are flagged finalist, when a finalist has no AI total, or when a
 * judge score is invalid.
 */
export function rankFinal(
  entries: readonly RankEntry[],
  judgeScores: JudgeScoresBySubmission,
): RankedRow[] {
  const flagged = entries.filter((e) => e.finalist);
  if (flagged.length > FINALIST_COUNT) {
    throw new RangeError(`${flagged.length} entries are flagged finalist; at most ${FINALIST_COUNT}`);
  }
  const ungraded = flagged.find((e) => e.ai_total == null);
  if (ungraded) throw new RangeError(`Finalist ${ungraded.submission_id} has no AI total`);

  const rows = entries.map((e) => {
    const scores = Object.hasOwn(judgeScores, e.submission_id)
      ? judgeScores[e.submission_id]
      : undefined;
    return {
      ...e,
      human_mean: humanMean(scores),
      judge_count: scores ? dedupeJudgeScores(scores).length : 0,
      final_rank: null as number | null,
    };
  });

  const finalists = rows
    .filter((r) => r.eligible && r.finalist)
    .sort((a, b) => {
      if (a.human_mean != null || b.human_mean != null) {
        if (a.human_mean == null) return 1;
        if (b.human_mean == null) return -1;
        if (a.human_mean !== b.human_mean) return b.human_mean - a.human_mean;
      }
      return byAiTotalDesc(a, b) || bySubmittedAsc(a, b);
    });
  const rest = rows
    .filter((r) => r.eligible && !r.finalist)
    .sort((a, b) => byAiTotalDesc(a, b) || bySubmittedAsc(a, b));
  const ineligible = rows
    .filter((r) => !r.eligible)
    .sort((a, b) => byAiTotalDesc(a, b) || bySubmittedAsc(a, b));

  const ranked = [...finalists, ...rest];
  ranked.forEach((r, i) => {
    r.final_rank = i + 1;
  });
  return [...ranked, ...ineligible];
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

export const CSV_HEADER = [
  "rank",
  "team_name",
  "project_slug",
  "eligible",
  "ai_total",
  "human_mean",
  "finalist",
  "flags",
] as const;

/**
 * Cells a spreadsheet would read as a formula: a leading tab or CR, or
 * = + - @ after any leading whitespace (spreadsheets trim it before parsing).
 */
const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@])/;

/**
 * One RFC 4180 field. A value a spreadsheet would evaluate as a formula gets a
 * leading `'` first; then a field with a quote, comma or line break is quoted
 * with its quotes doubled.
 */
export function csvField(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function num(x: number | null): string {
  return x == null ? "" : x.toFixed(2);
}

/** Header plus one line per row, CRLF line endings, trailing CRLF. */
export function toCsv(rows: readonly RankedRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.final_rank == null ? "" : String(r.final_rank),
        r.team_name,
        r.project_slug,
        String(r.eligible),
        num(r.ai_total),
        num(r.human_mean),
        String(r.finalist),
        r.flags.join(";"),
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
