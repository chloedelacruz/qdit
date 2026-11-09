import { afterEach, describe, expect, it, vi } from "vitest";

import { rankFinal, toCsv } from "@/lib/hackathon/leaderboard";
import { fakeDatabase } from "@/test/fake-supabase";

/**
 * GET /api/hackathons/[slug]/export (WP-4.7, QDIT-48): 404 for anyone who is
 * not this hackathon's admin, refused before release without asking for the
 * leaderboard, and the CSV is toCsv(rankFinal(...)) of the leaderboard rows.
 */
const getUser = vi.fn();
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getUser: () => getUser(),
  createClient: () => createClient(),
}));

const { GET } = await import("./route");

const H = "11111111-1111-4111-8111-111111111111";
const HACKATHON = {
  id: H,
  slug: "manila-26",
  name: "Manila 26",
  opens_at: "2026-11-10T01:00:00Z",
  closes_at: "2026-11-10T02:25:00Z",
  released_at: "2026-11-10T02:40:00Z" as string | null,
  finalist_count: 10,
};

function criteria(score: number) {
  return Object.fromEntries(
    ["clarity", "structure", "accuracy", "connections", "execution"].map((k) => [k, { score, evidence: "e" }]),
  );
}

function row(id: string, over: Record<string, unknown>) {
  return {
    submission_id: id,
    project_id: `p-${id}`,
    project_slug: `proj-${id}`,
    team_name: `Team ${id}`,
    version_id: `v-${id}`,
    version_no: 1,
    submitted_at: `2026-11-10T02:2${id.charCodeAt(0) % 10}:00Z`,
    eligibility: null,
    eligibility_override: null,
    override_reason: null,
    eligible: true,
    run_count: 2,
    runs: [
      { run_no: 1, model: "m", total: 50, criteria: criteria(5), flags: [], summary: null, truncated: false, created_at: "x" },
      { run_no: 2, model: "m", total: 50, criteria: criteria(5), flags: ["manipulation"], summary: null, truncated: false, created_at: "x" },
    ],
    ai_mean: 50,
    ai_criteria: null,
    ai_total: 50,
    finalist: false,
    ai_rank: null,
    pitch_order: null,
    judge_mean: null,
    judge_count: 0,
    judge_scores: [] as unknown[],
    ...over,
  };
}

const call = (slug = "manila-26") =>
  GET(new Request(`https://qdit.test/api/hackathons/${slug}/export`), { params: Promise.resolve({ slug }) });

function setup({
  hackathon = HACKATHON as typeof HACKATHON | null,
  role = "admin" as string | null,
  board = [] as unknown[],
} = {}) {
  getUser.mockResolvedValue({ id: "admin-1", email: null });
  const fake = fakeDatabase({
    from: {
      hackathons: [{ data: hackathon, error: null }],
      hackathon_staff: [{ data: role ? { role } : null, error: null }],
    },
    rpc: {
      hackathon_leaderboard: [{ data: board, error: null }],
      hackathon_grading_status: [{ data: [], error: null }],
    },
  });
  createClient.mockResolvedValue(fake.client);
  return fake;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/hackathons/[slug]/export", () => {
  it("404 when signed out", async () => {
    setup();
    getUser.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
  });

  it("404 for an unknown hackathon", async () => {
    setup({ hackathon: null });
    expect((await call("nope")).status).toBe(404);
  });

  it.each([["judge"], [null]])("404 for a %s, without reading grades", async (role) => {
    const fake = setup({ role });
    const response = await call();
    expect(response.status).toBe(404);
    expect(fake.requests.some((r) => r.name === "hackathon_leaderboard")).toBe(false);
  });

  it("refused before release, without calling the leaderboard", async () => {
    const fake = setup({ hackathon: { ...HACKATHON, released_at: null } });
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.text()).toBe("Grades are sealed until release.");
    expect(fake.requests.some((r) => r.name === "hackathon_leaderboard")).toBe(false);
  });

  it("returns toCsv(rankFinal(...)) as an attachment", async () => {
    // Each judge's scores, as hackathon_leaderboard returns them: a 18 (two judges), b 23 (three).
    const score = (judge_id: string, v: [number, number, number, number, number]) => ({
      judge_id,
      clarity: v[0],
      structure: v[1],
      accuracy: v[2],
      connections: v[3],
      pitch: v[4],
    });
    const aScores = [score("j1", [4, 4, 4, 3, 3]), score("j2", [3, 3, 4, 4, 4])];
    const bScores = [score("j1", [5, 5, 5, 5, 5]), score("j2", [4, 4, 4, 4, 4]), score("j3", [5, 5, 5, 5, 4])];
    const board = [
      row("a", { ai_total: 91, finalist: true, judge_mean: 18, judge_count: 2, judge_scores: aScores }),
      row("b", {
        ai_total: 85,
        finalist: true,
        judge_mean: 23,
        judge_count: 3,
        judge_scores: bScores,
        team_name: '=cmd|"x"',
      }),
      row("c", { ai_total: 70 }),
      row("d", { ai_total: 99, eligible: false }),
    ];
    setup({ board });
    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="manila-26-results.csv"');

    const expected = toCsv(
      rankFinal(
        board.map((r) => ({
          submission_id: r.submission_id,
          eligible: r.eligible as boolean,
          ai_total: r.ai_total as number,
          submitted_at: r.submitted_at,
          finalist: r.finalist as boolean,
          team_name: r.team_name as string,
          project_slug: r.project_slug,
          flags: ["manipulation" as const],
        })),
        { a: aScores, b: bScores },
      ),
    );
    const body = await response.text();
    expect(body.split("\r\n")[0]).toBe("rank,team_name,project_slug,eligible,ai_total,human_mean,finalist,flags");
    expect(body).toBe(expected);
    // b leads on the judges' mean; the formula-looking team name is defused.
    expect(body.split("\r\n")[1]).toMatch(/^1,"'=cmd\|""x""",proj-b,/);
  });
});
