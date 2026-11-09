import { afterEach, describe, expect, it, vi } from "vitest";

import { CONFLICT_COPY, OVERRIDE_RELEASED_COPY } from "@/lib/hackathon/staff-errors";
import { fakeDatabase } from "@/test/fake-supabase";

/**
 * The staff server actions (WP-4.7, QDIT-48): input checks before any RPC,
 * the exact RPC arguments, and every error mapped to a sentence.
 */
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const actions = await import("./staff-actions");

const H = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";

type Script = Parameters<typeof fakeDatabase>[0];

function db(script: Script) {
  const fake = fakeDatabase(script);
  createClient.mockResolvedValue(fake.client);
  return fake;
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("error mapping through the actions", () => {
  const tokens = Object.keys(CONFLICT_COPY).filter((t) => t !== "grading_incomplete");

  it.each(tokens)("regrade maps QD409 %s to its sentence", async (token) => {
    db({ rpc: { regrade_submission: [{ data: null, error: { code: "QD409", message: token, details: "x" } }] } });
    await expect(actions.regradeSubmission(S)).resolves.toEqual({ error: CONFLICT_COPY[token] });
  });

  it("staff add shows last_admin and staff_on_team as sentences", async () => {
    db({
      rpc: {
        set_hackathon_staff: [
          { data: null, error: { code: "QD409", message: "last_admin", details: "A hackathon keeps at least one admin." } },
          { data: null, error: { code: "QD409", message: "staff_on_team", details: "x" } },
        ],
      },
    });
    const fd = form({ hackathonId: H, username: "@Ana", role: "judge" });
    expect((await actions.addHackathonStaff({}, fd)).error).toBe(CONFLICT_COPY.last_admin);
    expect((await actions.addHackathonStaff({}, fd)).error).toBe(CONFLICT_COPY.staff_on_team);
  });

  it("remove sends a null role with the lowercased username", async () => {
    const fake = db({ rpc: { set_hackathon_staff: [{ data: "u", error: null }] } });
    await expect(actions.removeHackathonStaff(H, "@Ana")).resolves.toEqual({ ok: true });
    expect(fake.requests[0].args).toEqual({ p_hackathon_id: H, p_username: "ana", p_role: null });
  });

  it("maps 42501 and an unknown code without leaking the message", async () => {
    db({
      rpc: {
        regrade_submission: [
          { data: null, error: { code: "42501", message: "Only this hackathon's admins can do that." } },
          { data: null, error: { code: "XX000", message: "relation public.secret does not exist" } },
        ],
      },
    });
    expect((await actions.regradeSubmission(S)).error).toMatch(/not allowed/);
    const unknown = (await actions.regradeSubmission(S)).error ?? "";
    expect(unknown).toBe("Something went wrong (XX000). Try again.");
    expect(unknown).not.toContain("secret");
  });
});

describe("releaseGrades", () => {
  const slugRow = { data: { slug: "manila-26" }, error: null };

  it("refuses a mistyped slug before calling the RPC", async () => {
    const fake = db({ from: { hackathons: [slugRow] } });
    const result = await actions.releaseGrades({}, form({ hackathonId: H, confirmSlug: "manila" }));
    expect(result.fieldErrors?.confirmSlug).toBe("Type manila-26 exactly to confirm.");
    expect(fake.requests.map((r) => r.name)).toEqual(["hackathons"]);
  });

  it("incomplete, then allowed: offers allow-incomplete and sends it only when ticked", async () => {
    const fake = db({
      from: { hackathons: [slugRow, slugRow] },
      rpc: {
        release_hackathon_grades: [
          {
            data: null,
            error: { code: "QD409", message: "grading_incomplete", details: "3 entries still grading" },
          },
          { data: 7, error: null },
        ],
      },
    });

    const first = await actions.releaseGrades({}, form({ hackathonId: H, confirmSlug: "manila-26" }));
    expect(first.needsAllowIncomplete).toBe(true);
    expect(first.error).toBe(
      "Grading is not finished. 3 entries still grading. Release anyway only if you accept that those entries may miss the finals.",
    );
    expect(first.ok).toBeUndefined();

    const second = await actions.releaseGrades(
      first,
      form({ hackathonId: H, confirmSlug: " manila-26 ", allowIncomplete: "on" }),
    );
    expect(second).toEqual({ ok: true, finalists: 7 });

    const calls = fake.requests.filter((r) => r.name === "release_hackathon_grades").map((r) => r.args);
    expect(calls).toEqual([
      { p_hackathon_id: H, p_allow_incomplete: false },
      { p_hackathon_id: H, p_allow_incomplete: true },
    ]);
  });

  it.each(["hackathon_not_closed", "late_pass_active", "already_released"])("maps %s", async (token) => {
    db({
      from: { hackathons: [slugRow] },
      rpc: { release_hackathon_grades: [{ data: null, error: { code: "QD409", message: token, details: "x" } }] },
    });
    const result = await actions.releaseGrades({}, form({ hackathonId: H, confirmSlug: "manila-26" }));
    expect(result).toEqual({ error: CONFLICT_COPY[token] });
  });
});

describe("saveJudgeScore bounds", () => {
  const base = { submissionId: S, clarity: "3", structure: "3", accuracy: "3", connections: "3", pitch: "3", note: "" };

  it.each([
    ["0", "clarity"],
    ["6", "structure"],
    ["2.5", "accuracy"],
    ["", "connections"],
    ["five", "pitch"],
  ])("refuses %s for %s without calling the RPC", async (value, key) => {
    const fake = db({});
    const result = await actions.saveJudgeScore({}, form({ ...base, [key]: value }));
    expect(result.fieldErrors?.[key]).toBeTruthy();
    expect(fake.requests).toEqual([]);
  });

  it("refuses a note over 2,000 characters", async () => {
    const fake = db({});
    const result = await actions.saveJudgeScore({}, form({ ...base, note: "x".repeat(2001) }));
    expect(result.fieldErrors?.note).toBeTruthy();
    expect(fake.requests).toEqual([]);
  });

  it("sends 1 and 5 as integers, and an empty note as null", async () => {
    const fake = db({ rpc: { upsert_judge_score: [{ data: null, error: null }] } });
    const result = await actions.saveJudgeScore({}, form({ ...base, clarity: "1", pitch: "5" }));
    expect(result).toEqual({ ok: true });
    expect(fake.requests[0].args).toEqual({
      p_submission_id: S,
      p_clarity: 1,
      p_structure: 3,
      p_accuracy: 3,
      p_connections: 3,
      p_pitch: 5,
      p_note: null,
    });
  });

  it("maps not_finalist and grades_not_released", async () => {
    db({
      rpc: {
        upsert_judge_score: [
          { data: null, error: { code: "QD409", message: "not_finalist" } },
          { data: null, error: { code: "QD409", message: "grades_not_released" } },
        ],
      },
    });
    expect((await actions.saveJudgeScore({}, form(base))).error).toBe(CONFLICT_COPY.not_finalist);
    expect((await actions.saveJudgeScore({}, form(base))).error).toBe(CONFLICT_COPY.grades_not_released);
  });
});

describe("setEligibilityOverride", () => {
  it("wants a reason for true or false", async () => {
    const fake = db({});
    const result = await actions.setEligibilityOverride({}, form({ submissionId: S, value: "true", reason: "  " }));
    expect(result.fieldErrors?.reason).toBe("Say why you are overriding the rules.");
    expect(fake.requests).toEqual([]);
  });

  it("clears with null value and null reason", async () => {
    const fake = db({ rpc: { set_eligibility_override: [{ data: null, error: null }] } });
    await actions.setEligibilityOverride({}, form({ submissionId: S, value: "clear", reason: "ignored" }));
    expect(fake.requests[0].args).toEqual({ p_submission_id: S, p_value: null, p_reason: null });
  });

  it("says eligibility is fixed when the RPC answers already_released", async () => {
    db({
      rpc: {
        set_eligibility_override: [
          { data: null, error: { code: "QD409", message: "already_released", details: "Grades are released." } },
        ],
      },
    });
    const result = await actions.setEligibilityOverride({}, form({ submissionId: S, value: "true", reason: "Late fix" }));
    expect(result).toEqual({ error: OVERRIDE_RELEASED_COPY });
  });

  it("maps a 22023 reason hint", async () => {
    db({ rpc: { set_eligibility_override: [{ data: null, error: { code: "22023", hint: "reason", message: "x" } }] } });
    const result = await actions.setEligibilityOverride({}, form({ submissionId: S, value: "false", reason: "dup" }));
    expect(result.error).toBe("Say why, in 1 to 500 characters.");
  });
});

describe("grantLatePass", () => {
  it("reads the time as Asia/Manila", async () => {
    const fake = db({ rpc: { grant_late_pass: [{ data: null, error: null }] } });
    await actions.grantLatePass({}, form({ hackathonId: H, projectId: P, until: "2026-11-10T18:30" }));
    expect(fake.requests[0].args).toEqual({
      p_hackathon_id: H,
      p_project_id: P,
      p_until: "2026-11-10T10:30:00.000Z",
    });
  });

  it("refuses an unreadable time", async () => {
    const fake = db({});
    const result = await actions.grantLatePass({}, form({ hackathonId: H, projectId: P, until: "tomorrow" }));
    expect(result.fieldErrors?.until).toBeTruthy();
    expect(fake.requests).toEqual([]);
  });
});

describe("savePitchOrder", () => {
  it("refuses duplicates before the RPC and maps its hint", async () => {
    const fake = db({
      rpc: { set_pitch_order: [{ data: null, error: { code: "22023", hint: "submission_ids", message: "x" } }] },
    });
    expect((await actions.savePitchOrder(H, [S, S])).error).toMatch(/every finalist once/);
    expect(fake.requests).toEqual([]);
    expect((await actions.savePitchOrder(H, [S, P])).error).toBe(
      "The pitch order must list every finalist once. Reload and try again.",
    );
  });
});
