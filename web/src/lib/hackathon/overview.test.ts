import { describe, expect, it } from "vitest";

import { buildOverview } from "./overview";

const H1 = { id: "h1", slug: "san-beda-hackathon", name: "San Beda", opens_at: "2026-11-14T00:00:00+08:00", closes_at: "2026-11-15T00:00:00+08:00", released_at: null };
const H2 = { id: "h2", slug: "older", name: "Older", opens_at: "2026-10-01T00:00:00+08:00", closes_at: "2026-10-02T00:00:00+08:00", released_at: "2026-10-02T02:00:00+08:00" };
const H3 = { id: "h3", slug: "newest", name: "Newest", opens_at: "2026-12-01T00:00:00+08:00", closes_at: "2026-12-02T00:00:00+08:00", released_at: null };

describe("buildOverview", () => {
  it("puts staffed hackathons first, then newest first", () => {
    const out = buildOverview({
      hackathons: [H1, H2, H3],
      staff: [{ hackathon_id: "h2", role: "judge" }],
      submissions: [],
      versions: [],
      myTeams: [],
    });
    expect(out.map((h) => h.slug)).toEqual(["older", "newest", "san-beda-hackathon"]);
    expect(out[0].role).toBe("judge");
    expect(out[1].role).toBeNull();
  });

  it("admin wins over judge for the same hackathon", () => {
    const out = buildOverview({
      hackathons: [H1],
      staff: [{ hackathon_id: "h1", role: "judge" }, { hackathon_id: "h1", role: "admin" }],
      submissions: [],
      versions: [],
      myTeams: [],
    });
    expect(out[0].role).toBe("admin");
  });

  it("lists submissions only for staff, newest submission first, with version counts", () => {
    const submissions = [
      { id: "s1", hackathon_id: "h1", team_name: "Night Owls", created_at: "2026-11-14T09:00:00+08:00" },
      { id: "s2", hackathon_id: "h1", team_name: "Kape", created_at: "2026-11-14T09:30:00+08:00" },
      { id: "s3", hackathon_id: "h3", team_name: "Elsewhere", created_at: "2026-12-01T09:00:00+08:00" },
    ];
    const versions = [
      { submission_id: "s1", submitted_at: "2026-11-14T09:00:00+08:00" },
      { submission_id: "s1", submitted_at: "2026-11-14T11:00:00+08:00" },
      { submission_id: "s2", submitted_at: "2026-11-14T10:00:00+08:00" },
    ];
    const out = buildOverview({
      hackathons: [H1, H3],
      staff: [{ hackathon_id: "h1", role: "admin" }],
      submissions,
      versions,
      myTeams: [],
    });
    const h1 = out.find((h) => h.id === "h1")!;
    expect(h1.submissions?.map((s) => [s.teamName, s.versions, s.lastSubmittedAt])).toEqual([
      ["Night Owls", 2, "2026-11-14T11:00:00+08:00"],
      ["Kape", 1, "2026-11-14T10:00:00+08:00"],
    ]);
    expect(out.find((h) => h.id === "h3")!.submissions).toBeNull();
  });

  it("shows a participant their own team, without other teams", () => {
    const out = buildOverview({
      hackathons: [H1],
      staff: [],
      submissions: [{ id: "s9", hackathon_id: "h1", team_name: "Mine", created_at: "2026-11-14T09:00:00+08:00" }],
      versions: [],
      myTeams: [{ hackathon_id: "h1", submission_id: "s9" }],
    });
    expect(out[0].myTeam).toBe("Mine");
    expect(out[0].submissions).toBeNull();
  });

  it("falls back to the submission's created_at when no version row is visible", () => {
    const out = buildOverview({
      hackathons: [H1],
      staff: [{ hackathon_id: "h1", role: "judge" }],
      submissions: [{ id: "s1", hackathon_id: "h1", team_name: "A", created_at: "2026-11-14T09:00:00+08:00" }],
      versions: [],
      myTeams: [],
    });
    expect(out[0].submissions?.[0]).toMatchObject({ versions: 0, lastSubmittedAt: "2026-11-14T09:00:00+08:00" });
  });
});

describe("test hackathons (QDIT-51)", () => {
  const T = { id: "t1", slug: "test-e2e", name: "Test", opens_at: "2026-11-10T09:00:00+08:00", closes_at: "2026-11-10T11:00:00+08:00", released_at: null };
  const base = { submissions: [], versions: [] };

  it("hides a test- hackathon from everyone outside it", () => {
    const out = buildOverview({ ...base, hackathons: [H1, T], staff: [], myTeams: [] });
    expect(out.map((h) => h.slug)).toEqual(["san-beda-hackathon"]);
  });

  it("shows it to its staff", () => {
    const out = buildOverview({ ...base, hackathons: [T], staff: [{ hackathon_id: "t1", role: "admin" }], myTeams: [] });
    expect(out.map((h) => h.slug)).toEqual(["test-e2e"]);
  });

  it("shows it to a team in it", () => {
    const out = buildOverview({
      hackathons: [T],
      staff: [],
      submissions: [{ id: "s1", hackathon_id: "t1", team_name: "Testers", created_at: "2026-11-10T09:30:00+08:00" }],
      versions: [],
      myTeams: [{ hackathon_id: "t1", submission_id: "s1" }],
    });
    expect(out[0]).toMatchObject({ slug: "test-e2e", myTeam: "Testers" });
  });

  describe("hidden hackathons (QDIT-56)", () => {
    const HIDDEN = { ...H3, id: "h4", slug: "secret", hidden: true };
    const base = { staff: [], submissions: [], versions: [], myTeams: [] };

    it("leaves a hidden hackathon out for everyone else", () => {
      const out = buildOverview({ ...base, hackathons: [H1, HIDDEN] });
      expect(out.map((h) => h.id)).toEqual(["h1"]);
    });

    it("shows it, marked unlisted, to its staff, its teams and operators", () => {
      const staff = buildOverview({ ...base, hackathons: [HIDDEN], staff: [{ hackathon_id: "h4", role: "judge" }] });
      const team = buildOverview({
        ...base,
        hackathons: [HIDDEN],
        myTeams: [{ hackathon_id: "h4", submission_id: "s1" }],
        submissions: [{ id: "s1", hackathon_id: "h4", team_name: "Owls", created_at: "2026-12-01T01:00:00+08:00" }],
      });
      const operator = buildOverview({ ...base, hackathons: [HIDDEN], isOperator: true });
      for (const out of [staff, team, operator]) {
        expect(out).toHaveLength(1);
        expect(out[0].unlisted).toBe(true);
      }
    });

    it("treats a test- slug as unlisted too, and a plain one as listed", () => {
      const out = buildOverview({ ...base, hackathons: [H1, { ...H2, slug: "test-run" }], isOperator: true });
      expect(Object.fromEntries(out.map((h) => [h.slug, h.unlisted]))).toEqual({ "san-beda-hackathon": false, "test-run": true });
    });
  });
});
