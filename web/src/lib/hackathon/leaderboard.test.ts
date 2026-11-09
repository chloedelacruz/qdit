import { describe, expect, it } from "vitest";

import {
  csvField,
  humanMean,
  pickFinalists,
  rankFinal,
  toCsv,
  type FinalistCandidate,
  type RankEntry,
  type RankedRow,
} from "@/lib/hackathon/leaderboard";
import type { JudgeScore } from "@/lib/hackathon/types";

function candidate(
  id: string,
  ai_total: number | null,
  minute = 0,
  eligible = true,
): FinalistCandidate {
  return {
    submission_id: id,
    eligible,
    ai_total,
    submitted_at: new Date(Date.UTC(2026, 10, 21, 16, minute)).toISOString(),
  };
}

function entry(
  id: string,
  ai_total: number | null,
  opts: { finalist?: boolean; eligible?: boolean; minute?: number } = {},
): RankEntry {
  return {
    ...candidate(id, ai_total, opts.minute ?? 0, opts.eligible ?? true),
    finalist: opts.finalist ?? false,
    team_name: `Team ${id}`,
    project_slug: `team-${id}`,
    flags: [],
  };
}

function judge(judge_id: string, each: number, pitch = each): JudgeScore {
  return { judge_id, clarity: each, structure: each, accuracy: each, connections: each, pitch };
}

describe("pickFinalists", () => {
  it("takes the top 10 eligible by AI total", () => {
    const entries = Array.from({ length: 15 }, (_, i) => candidate(`s${i}`, 50 + i));
    expect(pickFinalists(entries).map((e) => e.submission_id)).toEqual([
      "s14", "s13", "s12", "s11", "s10", "s9", "s8", "s7", "s6", "s5",
    ]);
  });

  it("breaks a tie by the earlier submission", () => {
    const result = pickFinalists([candidate("late", 80, 30), candidate("early", 80, 5), candidate("top", 90, 59)], 2);
    expect(result.map((e) => e.submission_id)).toEqual(["top", "early"]);
  });

  it("excludes ineligible entries and entries without an AI total", () => {
    const result = pickFinalists([
      candidate("ineligible", 99, 0, false),
      candidate("ungraded", null),
      candidate("ok", 40),
    ]);
    expect(result.map((e) => e.submission_id)).toEqual(["ok"]);
  });

  it("returns every eligible entry when fewer than 10 are eligible", () => {
    const entries = [candidate("a", 10), candidate("b", 30), candidate("c", 20), candidate("x", 99, 0, false)];
    expect(pickFinalists(entries).map((e) => e.submission_id)).toEqual(["b", "c", "a"]);
  });

  it("does not reorder its input", () => {
    const entries = [candidate("a", 10), candidate("b", 30)];
    pickFinalists(entries);
    expect(entries.map((e) => e.submission_id)).toEqual(["a", "b"]);
  });
});

describe("humanMean", () => {
  it.each<[string, JudgeScore[] | undefined, number | null]>([
    ["no judges", undefined, null],
    ["empty list", [], null],
    ["one judge, all 5s", [judge("j1", 5)], 25],
    ["two judges", [judge("j1", 4), judge("j2", 3)], 17.5],
    ["three judges, rounded", [judge("j1", 4), judge("j2", 4), judge("j3", 4, 5)], 20.33],
  ])("%s", (_name, scores, expected) => {
    expect(humanMean(scores)).toBe(expected);
  });
});

describe("rankFinal", () => {
  const ids = (rows: RankedRow[]) => rows.map((r) => [r.submission_id, r.final_rank]);

  it("orders finalists by human mean, then the rest by AI total, then ineligible unranked", () => {
    const rows = rankFinal(
      [
        entry("ineligible", 95, { eligible: false }),
        entry("rest-high", 70),
        entry("f-ai-top", 90, { finalist: true }),
        entry("f-human-top", 80, { finalist: true }),
        entry("rest-low", 60),
        entry("f-unscored", 99, { finalist: true }),
      ],
      {
        "f-ai-top": [judge("j1", 3)],
        "f-human-top": [judge("j1", 5), judge("j2", 4)],
      },
    );
    expect(ids(rows)).toEqual([
      ["f-human-top", 1],
      ["f-ai-top", 2],
      ["f-unscored", 3],
      ["rest-high", 4],
      ["rest-low", 5],
      ["ineligible", null],
    ]);
    expect(rows[0].human_mean).toBe(22.5);
    expect(rows[0].judge_count).toBe(2);
    expect(rows[2].human_mean).toBeNull();
  });

  it("breaks a human-mean tie by AI total, then by earlier submission", () => {
    const rows = rankFinal(
      [
        entry("lower-ai", 70, { finalist: true }),
        entry("higher-ai", 85, { finalist: true }),
        entry("same-ai-late", 70, { finalist: true, minute: 40 }),
      ],
      {
        "lower-ai": [judge("j1", 4)],
        "higher-ai": [judge("j1", 4)],
        "same-ai-late": [judge("j1", 4)],
      },
    );
    expect(ids(rows)).toEqual([
      ["higher-ai", 1],
      ["lower-ai", 2],
      ["same-ai-late", 3],
    ]);
  });

  it("breaks an AI-total tie among the rest by earlier submission", () => {
    const rows = rankFinal([entry("late", 50, { minute: 30 }), entry("early", 50, { minute: 1 })], {});
    expect(ids(rows)).toEqual([
      ["early", 1],
      ["late", 2],
    ]);
  });

  it("does not rank an ineligible finalist", () => {
    const rows = rankFinal([entry("revoked", 90, { finalist: true, eligible: false }), entry("ok", 10)], {
      revoked: [judge("j1", 5)],
    });
    expect(ids(rows)).toEqual([
      ["ok", 1],
      ["revoked", null],
    ]);
  });
});

describe("csvField", () => {
  it.each([
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["two\nlines", '"two\nlines"'],
    ["cr\r\nlf", '"cr\r\nlf"'],
    ['=HYPERLINK("http://x")', '"\'=HYPERLINK(""http://x"")"'],
    ["+1", "'+1"],
    ["-1+2", "'-1+2"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tlead", "'\tlead"],
    ["=1,2", "\"'=1,2\""],
    ["a=b", "a=b"],
    ["", ""],
  ])("%j → %j", (input, expected) => {
    expect(csvField(input)).toBe(expected);
  });
});

describe("toCsv", () => {
  it("writes the header and one CRLF line per row", () => {
    const rows = rankFinal(
      [
        { ...entry("a", 81.5, { finalist: true }), team_name: 'Team "A", Inc', flags: ["placeholder", "disagreement"] },
        { ...entry("b", null), team_name: "=cmd|' /C calc'!A0" },
        entry("c", 12, { eligible: false }),
      ],
      { a: [judge("j1", 4), judge("j2", 5)] },
    );
    expect(toCsv(rows)).toBe(
      [
        "rank,team_name,project_slug,eligible,ai_total,human_mean,finalist,flags",
        '1,"Team ""A"", Inc",team-a,true,81.50,22.50,true,placeholder;disagreement',
        "2,'=cmd|' /C calc'!A0,team-b,true,,,false,",
        ",Team c,team-c,false,12.00,,false,",
        "",
      ].join("\r\n"),
    );
  });

  it("writes just the header for no rows", () => {
    expect(toCsv([])).toBe("rank,team_name,project_slug,eligible,ai_total,human_mean,finalist,flags\r\n");
  });
});
