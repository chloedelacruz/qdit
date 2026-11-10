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
