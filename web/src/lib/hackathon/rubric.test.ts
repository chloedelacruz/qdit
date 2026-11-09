import { describe, expect, it } from "vitest";

import {
  clampScore,
  combineRuns,
  InvalidAiRunError,
  MAX_EVIDENCE_CHARS,
  parseAiRun,
  runTotal,
  WEIGHTS,
} from "@/lib/hackathon/rubric";
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
  ])("%s → %s", (input, expected) => {
    expect(clampScore(input)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws on %s rather than inventing a score",
    (input) => {
      expect(() => clampScore(input)).toThrow(RangeError);
    },
  );
});

describe("runTotal", () => {
  it.each<[string, Partial<Record<CriterionKey, number>> | number, number]>([
    ["all zero", 0, 0],
    ["all ten", 10, 100],
    ["all five", 5, 50],
    ["mixed", { clarity: 10, structure: 7, accuracy: 3, connections: 0, execution: 9 }, 58],
    ["clamped before weighting", { clarity: 15, structure: -2, accuracy: 0, connections: 5, execution: 5 }, 40],
    ["rounded before weighting", { clarity: 6.6, structure: 5, accuracy: 5, connections: 5, execution: 5 }, 54],
  ])("%s", (_name, scores, expected) => {
    expect(runTotal(run(scores))).toBe(expected);
  });
});

describe("combineRuns", () => {
  it("throws on no runs and on more than three", () => {
    expect(() => combineRuns([])).toThrow(RangeError);
    expect(() => combineRuns([run(5), run(5), run(5), run(5)])).toThrow(RangeError);
  });

  it("throws on a run missing a criterion instead of scoring it 0", () => {
    const broken = run(5);
    delete (broken.criteria as Partial<AiRunOutput["criteria"]>).accuracy;
    expect(() => combineRuns([broken, run(5)])).toThrow(InvalidAiRunError);
    expect(() => runTotal(broken)).toThrow(InvalidAiRunError);
  });

  it("keeps the stored total equal to the stored criteria for two runs", () => {
    const result = combineRuns([run({ clarity: 3 }), run({ clarity: 4 })]);
    expect(result.perCriterion.clarity).toBe(3.5);
    expect(result.total).toBe(47);
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
    // The total is the total of the stored medians (54), not the median run total (52).
    expect(result.total).toBe(54);
    expect(result.total).toBe(runTotal({ ...run(0), criteria: Object.fromEntries(
      Object.entries(result.perCriterion).map(([k, score]) => [k, { score, evidence: "" }]),
    ) as AiRunOutput["criteria"] }));
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

describe("parseAiRun", () => {
  function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...JSON.parse(JSON.stringify(run(7, ["placeholder"]))), ...overrides };
  }

  it("accepts a well-formed run", () => {
    expect(parseAiRun(raw())).toEqual(run(7, ["placeholder"]));
  });

  it("keeps out-of-range finite scores for clampScore to handle", () => {
    const r = raw();
    (r.criteria as Record<string, { score: number }>).clarity.score = 14.2;
    expect(parseAiRun(r).criteria.clarity.score).toBe(14.2);
  });

  it("cuts evidence to 2000 characters", () => {
    const r = raw();
    (r.criteria as Record<string, { evidence: string }>).structure.evidence = "x".repeat(5000);
    expect(parseAiRun(r).criteria.structure.evidence).toHaveLength(MAX_EVIDENCE_CHARS);
  });

  it("drops unknown flags and duplicates", () => {
    const parsed = parseAiRun(raw({ flags: ["off_topic", "ignore_previous", "off_topic", 3] }));
    expect(parsed.flags).toEqual(["off_topic"]);
  });

  function withCriterion(key: string, value: unknown) {
    const r = raw();
    const criteria = r.criteria as Record<string, unknown>;
    if (value === undefined) delete criteria[key];
    else criteria[key] = value;
    return r;
  }

  it.each<[string, unknown]>([
    ["null", null],
    ["an array", []],
    ["a string", "{}"],
    ["no criteria", raw({ criteria: undefined })],
    ["criteria as an array", raw({ criteria: [] })],
    ["a missing criterion", withCriterion("execution", undefined)],
    ["a criterion that is not an object", withCriterion("execution", 7)],
    ["a numeric string score", withCriterion("clarity", { score: "7", evidence: "e" })],
    ["a NaN score", withCriterion("clarity", { score: Number.NaN, evidence: "e" })],
    ["an infinite score", withCriterion("clarity", { score: Number.POSITIVE_INFINITY, evidence: "e" })],
    ["a missing score", withCriterion("clarity", { evidence: "e" })],
    ["non-string evidence", withCriterion("clarity", { score: 7, evidence: 7 })],
    ["a non-string summary", raw({ summary: 3 })],
    ["a missing summary", raw({ summary: undefined })],
    ["flags that are not an array", raw({ flags: "manipulation" })],
  ])("throws InvalidAiRunError on %s", (_name, input) => {
    expect(() => parseAiRun(input)).toThrow(InvalidAiRunError);
  });

  it("lists every problem it found", () => {
    const r = raw({ summary: 3 });
    (r.criteria as Record<string, unknown>).clarity = { score: "7", evidence: "e" };
    try {
      parseAiRun(r);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidAiRunError);
      expect((e as InvalidAiRunError).issues).toEqual([
        "criteria.clarity.score is not a finite number",
        "summary is not a string",
      ]);
    }
  });
});
