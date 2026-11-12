import { describe, expect, it } from "vitest";

import { rankFinal } from "@/lib/hackathon/leaderboard";
import {
  buildLeaderboard,
  loadAdminConsole,
  loadJudgeConsole,
  loadSubmissionView,
  SIGNED_URL_SECONDS,
  type Db,
  type LeaderboardRow,
  type StaffHackathon,
  type StatusRow,
} from "@/lib/hackathon/staff-queries";
import { fakeDatabase } from "@/test/fake-supabase";

const H = "11111111-1111-4111-8111-111111111111";
const HACKATHON: StaffHackathon = {
  id: H,
  slug: "manila-26",
  name: "Manila 26",
  opens_at: "2026-11-10T01:00:00Z",
  closes_at: "2026-11-10T02:25:00Z",
  released_at: null,
  finalist_count: 10,
};

function criteria(score: number) {
  return Object.fromEntries(
    ["clarity", "structure", "accuracy", "connections", "execution"].map((k) => [k, { score, evidence: "e" }]),
  );
}

function statusRow(id: string, jobs: StatusRow["jobs"] = []): StatusRow {
  return {
    submission_id: id,
    project_id: `p-${id}`,
    project_slug: `proj-${id}`,
    team_name: `Team ${id}`,
    version_id: `v-${id}`,
    version_no: 1,
    submitted_at: "2026-11-10T02:20:00Z",
    jobs,
    complete: true,
    eligibility: { eligible: true, rules: [] },
    eligibility_override: null,
    override_reason: null,
    late_pass_until: null,
  };
}

function boardRow(id: string, over: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    submission_id: id,
    project_id: `p-${id}`,
    project_slug: `proj-${id}`,
    team_name: `Team ${id}`,
    version_id: `v-${id}`,
    version_no: 1,
    submitted_at: "2026-11-10T02:20:00Z",
    eligibility: { eligible: true, rules: [] },
    eligibility_override: null,
    override_reason: null,
    eligible: true,
    run_count: 2,
    runs: [
      { run_no: 1, model: "m", total: 60, criteria: criteria(6), flags: [], summary: null, truncated: false, created_at: "x" },
      { run_no: 2, model: "m", total: 60, criteria: criteria(6), flags: [], summary: null, truncated: false, created_at: "x" },
    ],
    ai_mean: 60,
    ai_criteria: { clarity: 6, structure: 6, accuracy: 6, connections: 6, execution: 6 },
    ai_total: 60,
    finalist: false,
    ai_rank: null,
    pitch_order: null,
    judge_mean: null,
    judge_count: 0,
    judge_scores: [],
    ...over,
  };
}

describe("loadAdminConsole", () => {
  it("never calls hackathon_leaderboard while released_at is null", async () => {
    // fakeDatabase throws on any request nothing was queued for, so an
    // unexpected leaderboard call fails the test by itself.
    const fake = fakeDatabase({
      rpc: {
        hackathon_grading_status: [{ data: [statusRow("a")], error: null }],
        hackathon_staff_list: [{ data: [], error: null }],
      },
    });
    const result = await loadAdminConsole(fake.client as unknown as Db, HACKATHON);

    expect(result.leaderboard).toBeNull();
    expect(fake.requests.map((r) => r.name).sort()).toEqual(["hackathon_grading_status", "hackathon_staff_list"]);
    expect(fake.requests.some((r) => r.name === "hackathon_leaderboard")).toBe(false);
    expect(result.submissions[0].eligibility).toEqual({ eligible: true, rules: [] });
  });

  it("asks for the leaderboard once released", async () => {
    const fake = fakeDatabase({
      rpc: {
        hackathon_grading_status: [{ data: [statusRow("a")], error: null }],
        hackathon_staff_list: [{ data: [], error: null }],
        hackathon_leaderboard: [{ data: [boardRow("a")], error: null }],
      },
    });
    const result = await loadAdminConsole(fake.client as unknown as Db, {
      ...HACKATHON,
      released_at: "2026-11-10T02:40:00Z",
    });
    expect(result.leaderboard?.map((r) => r.submission_id)).toEqual(["a"]);
    expect(fake.remaining()).toEqual([]);
  });
});

describe("buildLeaderboard", () => {
  it("adds disagreement from versionGrade when two runs disagree and the third run failed", () => {
    const row = boardRow("a", {
      runs: [
        { run_no: 1, model: "m", total: 20, criteria: criteria(2), flags: ["placeholder"], summary: null, truncated: false, created_at: "x" },
        { run_no: 2, model: "m", total: 90, criteria: criteria(9), flags: [], summary: null, truncated: false, created_at: "x" },
      ],
      ai_total: 55,
    });
    const status = statusRow("a", [
      { run_no: 1, status: "done", attempts: 1, free_attempts: 0, next_attempt_at: "x", last_error: null, updated_at: "x" },
      { run_no: 2, status: "done", attempts: 1, free_attempts: 0, next_attempt_at: "x", last_error: null, updated_at: "x" },
      { run_no: 3, status: "failed", attempts: 3, free_attempts: 0, next_attempt_at: "x", last_error: "timeout", updated_at: "x" },
    ]);
    const [view] = buildLeaderboard([row], [status]);
    expect(view.flags).toEqual(["placeholder", "disagreement"]);
    expect(view.spread).toBe(70);
  });

  it("keeps disagreement when release superseded the queued third run", () => {
    const row = boardRow("a", {
      runs: [
        { run_no: 1, model: "m", total: 20, criteria: criteria(2), flags: [], summary: null, truncated: false, created_at: "x" },
        { run_no: 2, model: "m", total: 90, criteria: criteria(9), flags: [], summary: null, truncated: false, created_at: "x" },
      ],
    });
    // After release the status lists live jobs only: the superseded third is gone.
    const status = statusRow("a", [
      { run_no: 1, status: "done", attempts: 1, free_attempts: 0, next_attempt_at: "x", last_error: null, updated_at: "x" },
      { run_no: 2, status: "done", attempts: 1, free_attempts: 0, next_attempt_at: "x", last_error: null, updated_at: "x" },
    ]);
    expect(buildLeaderboard([row], [status])[0].flags).toEqual(["disagreement"]);
  });

  it("passes every judge's own scores to rankFinal: finalists by the judges' mean", () => {
    const js = (judge_id: string, v: number) => ({
      judge_id,
      clarity: v,
      structure: v,
      accuracy: v,
      connections: v,
      pitch: v,
    });
    // a: 20 and 15 -> 17.5; b: 25, 20, 20 -> 21.67 (not the mean of rounded means).
    const aScores = [js("j1", 4), js("j2", 3)];
    const bScores = [js("j1", 5), js("j2", 4), js("j3", 4)];
    const rows = [
      boardRow("a", { ai_total: 90, finalist: true, judge_mean: 17.5, judge_count: 2, judge_scores: aScores }),
      boardRow("b", { ai_total: 80, finalist: true, judge_mean: 21.67, judge_count: 3, judge_scores: bScores }),
      boardRow("c", { ai_total: 70 }),
      boardRow("d", { ai_total: 95, eligible: false }),
    ];
    const ranked = buildLeaderboard(rows, []);
    expect(ranked.map((r) => [r.submission_id, r.final_rank])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 3],
      ["d", null],
    ]);
    const direct = rankFinal(
      rows.map((r) => ({
        submission_id: r.submission_id,
        eligible: r.eligible,
        ai_total: r.ai_total,
        submitted_at: r.submitted_at ?? "",
        finalist: r.finalist,
        team_name: r.team_name,
        project_slug: r.project_slug,
        flags: [],
      })),
      { a: aScores, b: bScores },
    );
    expect(ranked.map((r) => [r.submission_id, r.human_mean, r.judge_count])).toEqual(
      direct.map((r) => [r.submission_id, r.human_mean, r.judge_count]),
    );
    expect(ranked.map((r) => r.human_mean)).toEqual([21.67, 17.5, null, null]);
  });

  it("does not need judge_mean: the order comes from judge_scores", () => {
    const rows = [
      boardRow("a", { ai_total: 90, finalist: true, judge_mean: 25, judge_count: 1, judge_scores: [] }),
      boardRow("b", {
        ai_total: 80,
        finalist: true,
        judge_mean: null,
        judge_count: 0,
        judge_scores: [{ judge_id: "j1", clarity: 2, structure: 2, accuracy: 2, connections: 2, pitch: 2 }],
      }),
    ];
    expect(buildLeaderboard(rows, []).map((r) => [r.submission_id, r.human_mean])).toEqual([
      ["b", 10],
      ["a", null],
    ]);
  });
});

describe("loadJudgeConsole", () => {
  it("reads finalists through hackathon_finals_for_judge, never hackathon_finalists, and only own scores", async () => {
    const fake = fakeDatabase({
      rpc: {
        hackathon_finals_for_judge: [
          {
            data: [
              { submission_id: "b", team_name: "B", project_slug: "pb", pitch_order: 2 },
              { submission_id: "a", team_name: "A", project_slug: "pa", pitch_order: 1 },
            ],
            error: null,
          },
        ],
      },
      from: {
        hackathon_judge_scores: [
          { data: [{ submission_id: "a", clarity: 5, structure: 4, accuracy: 3, connections: 2, pitch: 1, note: null }], error: null },
        ],
      },
    });
    const result = await loadJudgeConsole(fake.client as unknown as Db, H, "judge-1");
    expect(result.finalists.map((f) => f.submission_id)).toEqual(["a", "b"]);
    expect(Object.keys(result.mine)).toEqual(["a"]);
    expect(fake.requests.some((r) => r.name === "hackathon_finalists")).toBe(false);
    const scores = fake.requests.find((r) => r.name === "hackathon_judge_scores");
    expect(scores?.calls).toContainEqual(["eq", "judge_id", "judge-1"]);
    expect(JSON.stringify(scores?.calls)).not.toContain("*");
  });
});

describe("loadSubmissionView", () => {
  it("names its columns, selects no eligibility, and signs images for five minutes", async () => {
    const S = "22222222-2222-4222-8222-222222222222";
    const fake = fakeDatabase({
      from: {
        hackathon_submissions: [{ data: { id: S, team_name: "T", current_version_id: "v1" }, error: null }],
        hackathon_submission_versions: [
          {
            data: {
              id: "v1",
              version_no: 2,
              team_name: "T",
              member_ids: ["u1"],
              qdit_snapshot: { project: { name: "P", slug: "p" }, tasks: [], members: [] },
              doqtri_snapshot_id: null,
              image_paths: ["h/p/a.png"],
              mindmap_url: "https://www.doqtri.xyz/m/Ab3_-xYz0123456789AbCd",
              submitted_at: "2026-11-10T02:20:00Z",
            },
            error: null,
          },
        ],
      },
    });
    const signed: unknown[] = [];
    const client = {
      ...fake.client,
      storage: {
        from: (bucket: string) => ({
          createSignedUrls: async (paths: string[], seconds: number) => {
            signed.push({ bucket, paths, seconds });
            return { data: paths.map((path) => ({ path, signedUrl: `https://x/${path}`, error: null })), error: null };
          },
        }),
      },
    };
    const view = await loadSubmissionView(client as unknown as Db, H, S);
    expect(view?.images).toEqual([{ path: "h/p/a.png", label: "Global mindmap", url: "https://x/h/p/a.png" }]);
    expect(signed).toEqual([{ bucket: "hackathon-mindmaps", paths: ["h/p/a.png"], seconds: 300 }]);
    expect(SIGNED_URL_SECONDS).toBe(300);
    // The version's own link (QDIT-66): no doqtri snapshot is attached, as after pruning.
    expect(view?.mindmap_url).toBe("https://www.doqtri.xyz/m/Ab3_-xYz0123456789AbCd");
    expect(fake.requests.find((r) => r.name === "hackathon_submission_versions")?.calls).toContainEqual([
      "select",
      "id, version_no, team_name, member_ids, qdit_snapshot, doqtri_snapshot_id, image_paths, slides_url, mindmap_url, submitted_at",
    ]);
    for (const req of fake.requests) {
      const select = req.calls.find((c) => c[0] === "select");
      expect(select?.[1]).not.toMatch(/\*|eligibility|override/);
    }
  });

  it("is null for an id that is not a uuid, without a query", async () => {
    const fake = fakeDatabase({});
    expect(await loadSubmissionView(fake.client as unknown as Db, H, "../x")).toBeNull();
    expect(fake.requests).toEqual([]);
  });
});
