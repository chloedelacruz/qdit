import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ARGUMENT_COPY, CONFLICT_COPY, gradingIncompleteCopy, staffErrorMessage } from "@/lib/hackathon/staff-errors";

/**
 * Every QD409 token and every 22023 hint the hackathon migration can raise
 * has its own sentence. The lists are read from the migration itself, so a
 * token added in SQL without copy here fails this test.
 */
const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20261110100000_hackathons.sql", import.meta.url)),
  "utf8",
);

const sqlTokens = [
  ...new Set(
    [...MIGRATION.matchAll(/raise exception '([a-z_]+)'\s+using errcode = 'QD409'/g)].map((m) => m[1]),
  ),
];
const sqlHints = [...new Set([...MIGRATION.matchAll(/errcode = '22023', hint = '([a-z_0-9]+)'/g)].map((m) => m[1]))];

/** The hints of the RPCs these consoles call; the rest belong to the participant and grader lanes. */
const STAFF_HINTS = ["reason", "until", "submission_ids", "scores", "note"];

const GENERIC = /Something went wrong|cannot be done right now|Check the values/;

describe("staffErrorMessage", () => {
  it("finds the migration's QD409 tokens", () => {
    expect(sqlTokens).toEqual(
      expect.arrayContaining([
        "already_released",
        "hackathon_not_closed",
        "late_pass_active",
        "grading_incomplete",
        "last_admin",
        "regrade_limit",
        "grades_not_released",
        "not_finalist",
      ]),
    );
  });

  it.each(sqlTokens)("has its own sentence for QD409 %s", (token) => {
    expect(CONFLICT_COPY[token]).toBeTruthy();
    const text = staffErrorMessage({ code: "QD409", message: token, details: "A sentence." });
    expect(text).not.toMatch(GENERIC);
    expect(text).not.toContain(token);
  });

  it.each(["staff_on_team", "member_is_staff"])("maps the new token %s", (token) => {
    const text = staffErrorMessage({ code: "QD409", message: token });
    expect(text).toBe(CONFLICT_COPY[token]);
    expect(text).not.toMatch(GENERIC);
  });

  it("says how many entries are still grading, from DETAIL", () => {
    expect(staffErrorMessage({ code: "QD409", message: "grading_incomplete", details: "3 entries still grading" })).toBe(
      "Grading is not finished. 3 entries still grading. Release anyway only if you accept that those entries may miss the finals.",
    );
    // SQL's own format() says "1 entries"; the copy says it properly.
    for (const details of ["1 entries still grading.", "1 entry still grading."]) {
      expect(staffErrorMessage({ code: "QD409", message: "grading_incomplete", details })).toContain(
        " 1 entry still grading. ",
      );
    }
  });

  it("never shows per-run counts for grading_incomplete", () => {
    const text = staffErrorMessage({
      code: "QD409",
      message: "grading_incomplete",
      details: "2 grading runs pending and 1 running.",
    });
    expect(text).toBe(
      "Grading is not finished. Release anyway only if you accept that those entries may miss the finals.",
    );
    expect(text).not.toMatch(/run/);
    expect(gradingIncompleteCopy(null)).toBe(text);
  });

  it("names the last-admin rule in plain words", () => {
    expect(staffErrorMessage({ code: "QD409", message: "last_admin" })).toBe(
      "A hackathon keeps at least one admin. Make someone else an admin first.",
    );
  });

  it.each(sqlHints.filter((h) => STAFF_HINTS.includes(h)))("has a sentence for 22023 hint %s", (hint) => {
    expect(ARGUMENT_COPY[hint]).toBeTruthy();
    expect(staffErrorMessage({ code: "22023", hint, message: "raw" })).toBe(ARGUMENT_COPY[hint]);
  });

  it("covers every staff hint the migration raises", () => {
    for (const hint of STAFF_HINTS) expect(sqlHints).toContain(hint);
  });

  it("maps both QD413 tokens", () => {
    expect(staffErrorMessage({ code: "QD413", message: "payload_too_large" })).toBe("The doqtri snapshot is over 2 MiB.");
    expect(staffErrorMessage({ code: "QD413", message: "snapshot_too_large" })).toMatch(/too large to snapshot/);
  });

  it("maps not allowed, not found and the unknown", () => {
    expect(staffErrorMessage({ code: "42501", message: "Only this hackathon's admins can do that." })).toBe(
      "You are not allowed to do that here. Only this hackathon's staff can.",
    );
    expect(staffErrorMessage({ code: "P0002", message: "No account uses that username." })).toBe(
      "No account uses that username.",
    );
    expect(staffErrorMessage({ code: "P0002", message: "No such hackathon." })).toBe("That hackathon no longer exists.");
    expect(staffErrorMessage({ code: "P0002", message: "No such submission." })).toBe(
      "That entry no longer exists. Reload the page.",
    );
    expect(staffErrorMessage({ code: "QD409", message: "brand_new_token", details: "raw detail" })).toBe(
      "That cannot be done right now. Reload the page and try again.",
    );
    expect(staffErrorMessage({ code: "XX000", message: "internal: relation x" })).toBe(
      "Something went wrong (XX000). Try again.",
    );
  });
});
