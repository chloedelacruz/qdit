import { describe, expect, it } from "vitest";

import type { EntryCheck } from "@/lib/hackathon/types";

import {
  doqtriHint,
  doqtriSnapshotLine,
  FIRST_SEND_HINT,
  groupEntryRules,
  needsDoqtriHint,
  RESEND_HINT,
  ruleDetail,
} from "./entry-check-copy";

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

describe("checklist grouping", () => {
  const rules: EntryCheck["rules"] = [
    { id: "team_size", passed: true, reason: "3 members" },
    { id: "notes_during_event", passed: false, reason: "No doqtri snapshot received" },
    { id: "global_mindmap_image", passed: true, reason: "uploaded" },
    { id: "notes_on_chain", passed: false, reason: "No doqtri snapshot received" },
    { id: "milestones_on_chain", passed: false, reason: "No milestone" },
  ];
  const none: EntryCheck = { allPassed: false, rules, chainUnavailable: false, doqtri: null };
  const some: EntryCheck = { ...none, doqtri: { receivedAt: "2026-11-20T02:42:10.000Z", noteCount: 3 } };

  it("splits qdit and doqtri items, keeping their order", () => {
    const groups = groupEntryRules(none);
    expect(groups.qdit.map((r) => r.id)).toEqual(["team_size", "global_mindmap_image", "milestones_on_chain"]);
    expect(groups.doqtri.map((r) => r.id)).toEqual(["notes_during_event", "notes_on_chain"]);
  });

  it("drops the repeated no-snapshot reason, and only that", () => {
    expect(ruleDetail(rules[1], none)).toBeNull();
    expect(ruleDetail(rules[1], some)).toBe("No doqtri snapshot received");
    expect(ruleDetail(rules[4], none)).toBe("No milestone");
    expect(ruleDetail({ id: "notes_on_chain", passed: null, reason: "Couldn't check" }, none)).toBe("Couldn't check");
  });

  it("asks for a first send when nothing has arrived, a resend otherwise", () => {
    expect(doqtriHint(none)).toBe(FIRST_SEND_HINT);
    expect(doqtriHint(some)).toBe(RESEND_HINT);
  });
});
