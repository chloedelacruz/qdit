import { describe, expect, it } from "vitest";

import { mindmapPath } from "./schemas";
import { acceptsUpload, formerMembersNote, rosterMembers } from "./team";

const ADA = "11111111-1111-4111-8111-111111111111";
const LIN = "22222222-2222-4222-8222-222222222222";
const GONE = "99999999-9999-4999-8999-999999999999";
const GONE_TOO = "88888888-8888-4888-8888-888888888888";
const HACKATHON = "3f0c2a8e-1b4d-4c6e-9a7f-2d5b8e1c0a93";
const PROJECT = "7a9e4c21-5d3b-4f8a-b6c0-1e2d3f4a5b6c";
const OTHER = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

describe("rosterMembers", () => {
  it("drops saved members who left the project, in order", () => {
    expect(rosterMembers([ADA, GONE, LIN], [{ id: LIN }, { id: ADA }])).toEqual({ kept: [ADA, LIN], removed: 1 });
  });

  it("keeps a team whose members are all still there", () => {
    expect(rosterMembers([ADA, LIN], [{ id: ADA }, { id: LIN }])).toEqual({ kept: [ADA, LIN], removed: 0 });
  });

  it("counts every one that left", () => {
    expect(rosterMembers([GONE, GONE_TOO], [{ id: ADA }]).removed).toBe(2);
  });
});

describe("formerMembersNote", () => {
  it("says how many were removed", () => {
    expect(formerMembersNote(0)).toBeNull();
    expect(formerMembersNote(1)).toBe("1 former member removed from the team list.");
    expect(formerMembersNote(2)).toBe("2 former members removed from the team list.");
  });
});

describe("acceptsUpload", () => {
  const path = mindmapPath(HACKATHON, PROJECT, "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "png");

  it("takes an upload for the project still selected", () => {
    expect(acceptsUpload({ path }, HACKATHON, PROJECT, true)).toBe(true);
  });

  it("drops an upload that finished after the project changed", () => {
    expect(acceptsUpload({ path }, HACKATHON, OTHER, true)).toBe(false);
  });

  it("drops anything once the dialog has closed", () => {
    expect(acceptsUpload({ path }, HACKATHON, PROJECT, false)).toBe(false);
    expect(acceptsUpload(null, HACKATHON, PROJECT, false)).toBe(false);
  });

  it("lets a slot be cleared while open", () => {
    expect(acceptsUpload(null, HACKATHON, PROJECT, true)).toBe(true);
  });
});
