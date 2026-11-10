import { describe, expect, it } from "vitest";

import type { EntryCheck } from "@/lib/hackathon/types";

import { doqtriSnapshotLine, needsDoqtriHint } from "./entry-check-copy";

describe("doqtriSnapshotLine", () => {
  it("names the arrival time in the event's zone and the note count", () => {
    expect(doqtriSnapshotLine({ receivedAt: "2026-11-20T02:42:10.000Z", noteCount: 6 })).toBe(
      "Checked the doqtri snapshot from 10:42 (6 notes).",
    );
  });
  it("says note, not notes, for one", () => {
    expect(doqtriSnapshotLine({ receivedAt: "2026-11-20T02:42:10.000Z", noteCount: 1 })).toContain("(1 note)");
  });
  it("says when nothing has arrived", () => {
    expect(doqtriSnapshotLine(null)).toBe("No doqtri snapshot has arrived for this project yet.");
  });
});

describe("needsDoqtriHint", () => {
  const check = (rules: EntryCheck["rules"]): EntryCheck => ({ allPassed: false, rules, chainUnavailable: false, doqtri: null });

  it("is true when a doqtri rule failed or could not be checked", () => {
    expect(needsDoqtriHint(check([{ id: "notes_during_event", passed: false, reason: "" }]))).toBe(true);
    expect(needsDoqtriHint(check([{ id: "notes_on_chain", passed: null, reason: "" }]))).toBe(true);
  });
  it("is false when only qdit rules failed", () => {
    expect(
      needsDoqtriHint(
        check([
          { id: "cards", passed: false, reason: "" },
          { id: "milestones_on_chain", passed: null, reason: "" },
          { id: "notes_connected", passed: true, reason: "" },
        ]),
      ),
    ).toBe(false);
  });
});
