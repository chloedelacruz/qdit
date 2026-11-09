import { describe, expect, it } from "vitest";

import { clampScore, combineRuns, runTotal, WEIGHTS } from "@/lib/hackathon/rubric";
import { CRITERION_KEYS, type AiFlag, type AiRunOutput, type CriterionKey } from "@/lib/hackathon/types";

function run(
  scores: Partial<Record<CriterionKey, number>> | number,
  flags: AiFlag[] = [],
): AiRunOutput {
  const criteria = {} as AiRunOutput["criteria"];
  for (const key of CRITERION_KEYS) {
    const score = typeof scores === "number" ? scores : (scores[key] ?? 5);
    criteria[key] = { score, evidence: `${key} evidence` };
  }
  return { criteria, summary: "summary", flags };
}

describe("WEIGHTS", () => {
  it("gives every criterion 20, summing to 100", () => {
    expect(CRITERION_KEYS.map((k) => WEIGHTS[k])).toEqual([20, 20, 20, 20, 20]);
  });
});

describe("clampScore", () => {
  it.each([
    [7, 7],
    [7.4, 7],
    [7.5, 8],
    [-3, 0],
    [11, 10],
    [100, 10],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [Number.NEGATIVE_INFINITY, 0],
  ])("%s → %s", (input, expected) => {
    expect(clampScore(input)).toBe(expected);
  });
});

describe("runTotal", () => {
  it.each<[string, Partial<Record<CriterionKey, number>> | number, number]>([
    ["all zero", 0, 0],
    ["all ten", 10, 100],
    ["all five", 5, 50],
    ["mixed", { clarity: 10, structure: 7, accuracy: 3, connections: 0, execution: 9 }, 58],
    ["clamped before weighting", { clarity: 15, structure: -2, accuracy: Number.NaN, connections: 5, execution: 5 }, 40],
    ["rounded before weighting", { clarity: 6.6, structure: 5, accuracy: 5, connections: 5, execution: 5 }, 54],
  ])("%s", (_name, scores, expected) => {
    expect(runTotal(run(scores))).toBe(expected);
  });
});

describe("combineRuns", () => {
  it("throws on no runs", () => {
    expect(() => combineRuns([])).toThrow(RangeError);
  });

  it("asks for a second run after one", () => {
    const result = combineRuns([run(6)]);
    expect(result.status).toBe("needs_second_run");
    expect(result.total).toBe(60);
  });

  it("takes the mean of two runs that agree", () => {
    const result = combineRuns([
      run({ clarity: 6, structure: 7, accuracy: 8, connections: 5, execution: 4 }),
      run({ clarity: 7, structure: 7, accuracy: 6, connections: 5, execution: 5 }),
    ]);
    expect(result.status).toBe("final");
    expect(result.total).toBe(60);
    expect(result.perCriterion).toEqual({
      clarity: 6.5,
      structure: 7,
      accuracy: 7,
      connections: 5,
      execution: 4.5,
    });
    expect(result.spread.total).toBe(0);
    expect(result.spread.criteria.accuracy).toBe(2);
    expect(result.flags).toEqual([]);
  });

  it.each<[string, AiRunOutput, AiRunOutput, "final" | "needs_third_run"]>([
    // Clamped scores are integers, so every total is even: 14 and 16 straddle the limit of 15.
    ["total diff 14", run(5), run({ clarity: 7, structure: 7, accuracy: 7, connections: 6, execution: 5 }), "final"],
    ["total diff 16", run(5), run({ clarity: 7, structure: 7, accuracy: 7, connections: 7, execution: 5 }), "needs_third_run"],
    ["one criterion diff exactly 4", run(5), run({ clarity: 9 }), "final"],
    ["one criterion diff 5", run(5), run({ clarity: 10 }), "needs_third_run"],
    ["criterion diff 5 in the other direction", run({ execution: 9 }), run({ execution: 4 }), "needs_third_run"],
  ])("%s → %s", (_name, a, b, status) => {
    expect(combineRuns([a, b]).status).toBe(status);
  });

  it("checks the total threshold on clamped scores", () => {
    // Raw 5 vs 50 everywhere would be a huge gap; clamped it is 50 vs 100.
    expect(combineRuns([run(5), run(50)]).spread.total).toBe(50);
  });

  it("takes the median of three runs and flags disagreement", () => {
    const result = combineRuns([
      run({ clarity: 2, structure: 9, accuracy: 5, connections: 5, execution: 5 }, ["placeholder"]),
      run({ clarity: 8, structure: 3, accuracy: 5, connections: 5, execution: 5 }),
      run({ clarity: 6, structure: 6, accuracy: 5, connections: 5, execution: 10 }, ["off_topic"]),
    ]);
    expect(result.status).toBe("final");
    expect(result.perCriterion).toEqual({
      clarity: 6,
      structure: 6,
      accuracy: 5,
      connections: 5,
      execution: 5,
    });
    // Run totals 52, 52, 64 → median 52, not the 54 the median criteria sum to.
    expect(result.total).toBe(52);
    expect(result.flags).toEqual(["placeholder", "off_topic", "disagreement"]);
    expect(result.spread.criteria.clarity).toBe(6);
  });

  it("unions flags across runs without duplicates, in a stable order", () => {
    const result = combineRuns([
      run(5, ["truncated_input", "manipulation"]),
      run(5, ["manipulation", "images_unreadable"]),
    ]);
    expect(result.flags).toEqual(["manipulation", "images_unreadable", "truncated_input"]);
  });

  it("drops flags it does not know", () => {
    const rogue = { ...run(5), flags: ["manipulation", "ignore_previous"] as unknown as AiFlag[] };
    expect(combineRuns([rogue, run(5)]).flags).toEqual(["manipulation"]);
  });
});
