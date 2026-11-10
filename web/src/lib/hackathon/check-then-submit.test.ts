import { describe, expect, it, vi } from "vitest";

import type { ActionState } from "@/lib/actions";
import type { EntryCheck } from "@/lib/hackathon/types";

import { checkThenSubmit, SUBMIT_ANYWAY } from "./check-then-submit";

/** The submission dialog's two paths (QDIT-55): pass submits at once, fail waits for "Submit anyway". */

const passing: EntryCheck = { allPassed: true, rules: [], chainUnavailable: false, doqtri: null };
const failing: EntryCheck = {
  allPassed: false,
  rules: [{ id: "notes_on_chain", passed: false, reason: "2 of 5 event notes anchored on chain" }],
  chainUnavailable: false,
  doqtri: null,
};

function actions(check: ActionState) {
  return {
    check: vi.fn(async () => check),
    submit: vi.fn(async (_p: ActionState, data: FormData): Promise<ActionState> => {
      expect(data.has(SUBMIT_ANYWAY)).toBe(false);
      return { ok: true };
    }),
  };
}

function form(anyway = false) {
  const data = new FormData();
  data.set("teamName", "Night Owls");
  if (anyway) data.set(SUBMIT_ANYWAY, "1");
  return data;
}

describe("checkThenSubmit", () => {
  it("submits in one step when every rule passes", async () => {
    const a = actions({ entryCheck: passing });
    expect(await checkThenSubmit({}, form(), a)).toEqual({ ok: true });
    expect(a.check).toHaveBeenCalledTimes(1);
    expect(a.submit).toHaveBeenCalledTimes(1);
  });

  it("returns a failing check and submits nothing", async () => {
    const a = actions({ entryCheck: failing });
    expect(await checkThenSubmit({}, form(), a)).toEqual({ entryCheck: failing });
    expect(a.submit).not.toHaveBeenCalled();
  });

  it("returns the check's errors and submits nothing", async () => {
    const a = actions({ fieldErrors: { teamName: "Enter a team name." } });
    expect(await checkThenSubmit({}, form(), a)).toEqual({ fieldErrors: { teamName: "Enter a team name." } });
    expect(a.submit).not.toHaveBeenCalled();
  });

  it("submits when the check itself failed, so a broken preview never blocks", async () => {
    const a = actions({ error: "Couldn't check the entry right now." });
    expect(await checkThenSubmit({}, form(), a)).toEqual({ ok: true });
    expect(a.submit).toHaveBeenCalledTimes(1);
  });

  it("Submit anyway skips the check and does not pass its own field on", async () => {
    const a = actions({ entryCheck: failing });
    expect(await checkThenSubmit({}, form(true), a)).toEqual({ ok: true });
    expect(a.check).not.toHaveBeenCalled();
    expect(a.submit).toHaveBeenCalledTimes(1);
  });
});
