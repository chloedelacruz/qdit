import { describe, expect, it } from "vitest";

import { isUnlistedHackathon } from "./banner-state";
import {
  deleteBlockedReason,
  hackathonFormSchema,
  isoToManilaInput,
  manageErrorState,
  manilaInputToIso,
  readHackathonForm,
  rpcFields,
} from "./manage";

/** The hackathon management page's pure parts (QDIT-56). */

describe("Manila time", () => {
  it("reads a datetime-local value as Manila time (UTC+8)", () => {
    expect(manilaInputToIso("2026-11-20T09:00")).toBe("2026-11-20T01:00:00.000Z");
    expect(manilaInputToIso("2026-11-20T03:30")).toBe("2026-11-19T19:30:00.000Z");
  });
  it("shows an instant as the Manila clock reads it", () => {
    expect(isoToManilaInput("2026-11-20T01:00:00.000Z")).toBe("2026-11-20T09:00");
    expect(isoToManilaInput("2026-11-19T19:30:00+00:00")).toBe("2026-11-20T03:30");
  });
  it("round-trips", () => {
    expect(isoToManilaInput(manilaInputToIso("2026-12-31T23:59")!)).toBe("2026-12-31T23:59");
  });
  it("refuses what is not a datetime-local value or not a real date", () => {
    expect(manilaInputToIso("")).toBeNull();
    expect(manilaInputToIso("2026-11-20")).toBeNull();
    expect(manilaInputToIso("2026-02-30T10:00")).toBeNull();
    expect(isoToManilaInput("nope")).toBe("");
  });
});

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields: Record<string, string> = {
    slug: " Bootcamp-Nov ",
    name: " San Beda Bootcamp ",
    description: "  ",
    opensAt: "2026-11-20T09:00",
    closesAt: "2026-11-20T10:20",
    teamMin: "3",
    teamMax: "4",
    finalistCount: "10",
    hidden: "false",
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe("hackathonFormSchema", () => {
  it("normalises a valid form into the RPC's arguments", () => {
    const parsed = hackathonFormSchema.parse(readHackathonForm(form({ hidden: "true" })));
    expect(rpcFields(parsed)).toEqual({
      p_slug: "bootcamp-nov",
      p_name: "San Beda Bootcamp",
      p_description: null,
      p_opens_at: "2026-11-20T01:00:00.000Z",
      p_closes_at: "2026-11-20T02:20:00.000Z",
      p_team_min: 3,
      p_team_max: 4,
      p_finalist_count: 10,
      p_hidden: true,
    });
  });

  it("puts each problem under its own field", () => {
    const result = hackathonFormSchema.safeParse(
      readHackathonForm(
        form({ slug: "Not ok!", name: "", closesAt: "2026-11-20T08:00", teamMin: "4", teamMax: "3", finalistCount: "11" }),
      ),
    );
    expect(result.success).toBe(false);
    const fields = new Set(result.error!.issues.map((i) => i.path[0]));
    expect([...fields].sort()).toEqual(["closesAt", "finalistCount", "name", "slug", "teamMax"]);
  });

  it("reserves the management page's slug", () => {
    const result = hackathonFormSchema.safeParse(readHackathonForm(form({ slug: "manage" })));
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toEqual(["slug"]);
  });

  it("asks for times it can read", () => {
    const result = hackathonFormSchema.safeParse(readHackathonForm(form({ opensAt: "" })));
    expect(result.error!.issues.map((i) => i.path[0])).toContain("opensAt");
  });
});

describe("manageErrorState", () => {
  it.each([
    [{ code: "23505", message: "duplicate key value violates unique constraint \"hackathons_slug_key\"" }, { fieldErrors: { slug: "Another hackathon already uses this slug." } }],
    [{ code: "23514", message: "new row for relation \"hackathons\" violates check constraint \"hackathons_window\"" }, { fieldErrors: { closesAt: "It has to close after it opens." } }],
    [{ code: "23514", message: "violates check constraint \"hackathons_finalist_count_check\"" }, { fieldErrors: { finalistCount: "Choose 1 to 10 finalists." } }],
    [{ code: "QD409", message: "hackathon_not_empty" }, { error: "Teams have sent work to this hackathon, so it can't be deleted. Hide it instead." }],
    [{ code: "P0002", message: "No such hackathon." }, { error: "That hackathon no longer exists." }],
    [{ code: "42501", message: "Only qdit operators can create hackathons." }, { error: "Only qdit operators can create hackathons." }],
    [{ code: "XX000", message: "boom" }, { error: "That didn't go through. Try again in a moment." }],
  ])("maps %o", (error, state) => {
    expect(manageErrorState(error)).toEqual(state);
  });

  it("puts slug_locked and slug_reserved under the slug field", () => {
    expect(manageErrorState({ code: "QD409", message: "slug_locked" }).fieldErrors?.slug).toMatch(/doqtri/);
    expect(manageErrorState({ code: "QD409", message: "slug_reserved" }).fieldErrors?.slug).toMatch(/management page/);
  });
});

describe("deleteBlockedReason", () => {
  it("offers Delete only to an operator, on an empty hackathon", () => {
    expect(deleteBlockedReason({ entries: 0, snapshots: 0, canDelete: true }, true)).toBeNull();
    expect(deleteBlockedReason({ entries: 0, snapshots: 0, canDelete: false }, false)).toMatch(/operators/);
    expect(deleteBlockedReason({ entries: 2, snapshots: 0, canDelete: false }, true)).toMatch(/Hide it instead/);
    expect(deleteBlockedReason({ entries: 0, snapshots: 1, canDelete: false }, true)).toMatch(/Hide it instead/);
  });
});

describe("isUnlistedHackathon", () => {
  it("is hidden or a test- rehearsal", () => {
    expect(isUnlistedHackathon({ slug: "bootcamp", hidden: true })).toBe(true);
    expect(isUnlistedHackathon({ slug: "test-run", hidden: false })).toBe(true);
    expect(isUnlistedHackathon({ slug: "bootcamp", hidden: false })).toBe(false);
    expect(isUnlistedHackathon({ slug: "bootcamp" })).toBe(false);
  });
});
