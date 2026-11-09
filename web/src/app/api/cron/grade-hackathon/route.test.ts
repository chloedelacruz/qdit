import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/cron/grade-hackathon`: who may run it and what it answers. The
 * sweep itself is covered by lib/hackathon/grading-worker.test.ts; here it is
 * a fake that returns counts.
 */
const COUNTS = {
  claimed: 2,
  graded: 2,
  ineligible: 0,
  superseded: 0,
  retrying: 0,
  failed: 0,
  errors: 0,
  third_runs_queued: 0,
};
const runSweep = vi.fn(async () => COUNTS);
vi.mock("@/lib/hackathon/grading-worker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hackathon/grading-worker")>()),
  runSweep,
}));

const createServiceClient = vi.fn(() => ({}));
vi.mock("@/lib/hackathon/service-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hackathon/service-client")>()),
  createServiceClient,
}));

const { GET, maxDuration, dynamic, runtime } = await import("./route");

const CRON_SECRET = "cron-secret-for-tests";

const call = (authorization?: string) =>
  GET(
    new Request("https://qdit.test/api/cron/grade-hackathon", {
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /api/cron/grade-hackathon", () => {
  it("runs a sweep for the cron secret and answers counts only", async () => {
    const response = await call(`Bearer ${CRON_SECRET}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ data: COUNTS });
    expect(runSweep).toHaveBeenCalledTimes(1);
    expect(runSweep).toHaveBeenCalledWith({ budgetMs: 240_000 }, expect.objectContaining({ store: expect.any(Object), client: expect.any(Object) }));
    expect(createServiceClient).toHaveBeenCalledWith("sb_secret_test");
  });

  it("declares a 300 s, dynamic, Node.js route", () => {
    expect(maxDuration).toBe(300);
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  describe("401", () => {
    for (const [name, header] of [
      ["no Authorization header", undefined],
      ["a wrong secret", "Bearer not-the-secret"],
      ["the secret without Bearer", CRON_SECRET],
      ["another scheme", `Basic ${CRON_SECRET}`],
      ["an empty bearer", "Bearer "],
      ["lowercase bearer", `bearer ${CRON_SECRET}`],
      ["a secret with a suffix", `Bearer ${CRON_SECRET}x`],
    ] as const) {
      it(`refuses ${name} and runs nothing`, async () => {
        const response = await call(header);
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
        expect(runSweep).not.toHaveBeenCalled();
      });
    }
  });

  it("refuses every call while CRON_SECRET is unset (503)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await call("Bearer ");
    expect(response.status).toBe(503);
    expect(runSweep).not.toHaveBeenCalled();
  });

  it("answers 503 without the service key or the Anthropic key, after the auth check", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call(`Bearer ${CRON_SECRET}`)).status).toBe(503);

    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const response = await call(`Bearer ${CRON_SECRET}`);
    expect(response.status).toBe(503);
    expect(runSweep).not.toHaveBeenCalled();
    // Named, never valued.
    expect(String(vi.mocked(console.error).mock.calls.flat())).not.toContain(CRON_SECRET);
  });

  it("answers 500 when the sweep throws", async () => {
    runSweep.mockRejectedValueOnce(new Error("db down"));
    const response = await call(`Bearer ${CRON_SECRET}`);
    expect(response.status).toBe(500);
  });
});
