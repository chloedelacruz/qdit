import { describe, expect, it } from "vitest";

import {
  effectiveEligible,
  formatDuration,
  formatManila,
  gradingCounts,
  groupTasksByStatus,
  isoToManilaLocal,
  manilaLocalToIso,
  parseEligibility,
  readDoqtriSnapshot,
  readQditSnapshot,
  summariseJobs,
  toPlainText,
} from "@/lib/hackathon/staff-view";

describe("summariseJobs", () => {
  it("running beats pending beats failed beats done, and collects failed codes once", () => {
    expect(summariseJobs([]).state).toBe("not_queued");
    expect(summariseJobs([{ run_no: 1, status: "done", last_error: null }]).state).toBe("done");
    const s = summariseJobs([
      { run_no: 1, status: "failed", last_error: "refusal" },
      { run_no: 2, status: "failed", last_error: "refusal" },
      { run_no: 3, status: "superseded", last_error: "timeout" },
    ]);
    expect(s).toEqual({ state: "failed", counts: { pending: 0, running: 0, done: 0, failed: 2 }, failedCodes: ["refusal"] });
    expect(
      summariseJobs([
        { run_no: 1, status: "pending", last_error: null },
        { run_no: 2, status: "running", last_error: null },
      ]).state,
    ).toBe("running");
  });

  it("totals across entries", () => {
    expect(
      gradingCounts([
        { jobs: [{ run_no: 1, status: "pending", last_error: null }] },
        { jobs: [{ run_no: 1, status: "failed", last_error: "x" }, { run_no: 2, status: "done", last_error: null }] },
        { jobs: null },
      ]),
    ).toEqual({ pending: 1, running: 0, done: 1, failed: 1 });
  });
});

describe("eligibility", () => {
  it("parses the stored result and drops unknown rules", () => {
    expect(
      parseEligibility({
        eligible: false,
        rules: [
          { id: "cards", passed: false, reason: "3 of 5 cards" },
          { id: "made_up", passed: true, reason: "?" },
        ],
      }),
    ).toEqual({ eligible: false, rules: [{ id: "cards", passed: false, reason: "3 of 5 cards" }] });
    expect(parseEligibility(null)).toBeNull();
    expect(parseEligibility({ eligible: "yes", rules: [] })).toBeNull();
  });

  it("lets the override win, and no result is not eligible", () => {
    expect(effectiveEligible(true, { eligible: false, rules: [] })).toBe(true);
    expect(effectiveEligible(false, { eligible: true, rules: [] })).toBe(false);
    expect(effectiveEligible(null, null)).toBe(false);
  });
});

describe("Manila time", () => {
  it("reads a datetime-local value as UTC+8", () => {
    expect(manilaLocalToIso("2026-11-10T08:00")).toBe("2026-11-10T00:00:00.000Z");
    expect(manilaLocalToIso("2026-11-10T03:15:30")).toBe("2026-11-09T19:15:30.000Z");
    expect(manilaLocalToIso("2026-02-31T10:00")).toBeNull();
    expect(manilaLocalToIso("10 Nov")).toBeNull();
  });

  it("round-trips back to the input form", () => {
    expect(isoToManilaLocal("2026-11-10T00:00:00Z")).toBe("2026-11-10T08:00");
    expect(manilaLocalToIso(isoToManilaLocal("2026-11-10T02:25:00Z"))).toBe("2026-11-10T02:25:00.000Z");
  });

  it("formats in Manila whatever the host zone", () => {
    expect(formatManila("2026-11-10T02:25:00Z")).toBe("10 Nov 2026, 10:25 Manila");
    expect(formatManila(null)).toBe("—");
  });

  it("formats durations", () => {
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(250_000)).toBe("4m 10s");
    expect(formatDuration(2 * 3600_000 + 5 * 60_000)).toBe("2h 05m");
    expect(formatDuration(3 * 86_400_000 + 2 * 3600_000)).toBe("3d 2h");
  });
});

describe("toPlainText", () => {
  it("keeps markup as characters, drops control and bidi-override characters, normalises newlines", () => {
    expect(toPlainText("<b>hi</b>\r\nnext‮evil\u0007")).toBe("<b>hi</b>\nnextevil");
    expect(toPlainText(null)).toBe("");
    expect(toPlainText(42)).toBe("42");
    expect(toPlainText("abcdef", 3)).toBe("abc\n[clipped for display]");
  });
});

describe("snapshots", () => {
  it("reads a qdit snapshot with missing lists as empty", () => {
    const view = readQditSnapshot({ project: { name: "P", slug: "p" }, tasks: [{ id: "t", title: "T", status: "done" }, "junk"] });
    expect(view.tasks).toHaveLength(1);
    expect(view.members).toEqual([]);
    expect(groupTasksByStatus(view.tasks).map((g) => [g.status, g.tasks.length])).toEqual([
      ["todo", 0],
      ["in_progress", 0],
      ["done", 1],
    ]);
  });

  it("counts mindmap nodes and links and lists distinct labels", () => {
    const view = readDoqtriSnapshot({
      notes: [{ doc_id: "d", title: "N", markdown: "# x" }],
      global_mindmap: {
        nodes: [{ id: "1", label: "Problem" }, { id: "2", label: "Problem" }, { id: "3", label: "Fix" }],
        links: [{ source: "1", target: "3" }],
      },
    });
    expect(view).toMatchObject({ nodeCount: 3, linkCount: 1, labels: ["Problem", "Fix"] });
    expect(readDoqtriSnapshot(null)).toBeNull();
  });
});
