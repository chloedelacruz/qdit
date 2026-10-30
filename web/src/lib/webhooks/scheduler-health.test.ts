import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * lib/webhooks/scheduler-health.ts: reading webhook_scheduler_health() (D-57).
 * The SQL is covered by supabase/tests/integration_webhooks_schedule.test.sql;
 * here supabase-js is a fake that answers the one RPC.
 */
const rpc = vi.fn();
const createClient = vi.fn<(url: string, key: string, options: unknown) => { rpc: typeof rpc }>(() => ({ rpc }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { parseSchedulerHealth, readSchedulerHealth, schedulerWarning } = await import("./scheduler-health");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("parseSchedulerHealth", () => {
  it("reads the function's jsonb", () => {
    expect(parseSchedulerHealth({ status: "missing", job: true, missing_secrets: ["qdit_cron_secret"] })).toEqual({
      status: "missing",
      job: true,
      missingSecrets: ["qdit_cron_secret"],
    });
    expect(parseSchedulerHealth({ status: "configured", job: true, missing_secrets: [] }).status).toBe("configured");
  });

  it.each([
    null,
    "configured",
    [],
    { status: "fine", job: true, missing_secrets: [] },
    { status: "configured", job: "yes", missing_secrets: [] },
    { status: "missing", job: true, missing_secrets: "qdit_cron_secret" },
    { status: "missing", job: true, missing_secrets: [1] },
  ])("reads %j as unknown", (value) => {
    expect(parseSchedulerHealth(value)).toEqual({ status: "unknown", job: null, missingSecrets: [] });
  });
});

describe("schedulerWarning", () => {
  it("is silent only when configured", () => {
    expect(schedulerWarning({ status: "configured", job: true, missingSecrets: [] })).toBeNull();
    expect(schedulerWarning({ status: "missing", job: true, missingSecrets: ["qdit_cron_secret"] })).toMatch(
      /until Vault holds qdit_cron_secret/,
    );
    expect(schedulerWarning({ status: "missing", job: false, missingSecrets: [] })).toMatch(/missing or inactive/);
    expect(schedulerWarning({ status: "unavailable", job: false, missingSecrets: [] })).toMatch(/no pg_cron/);
    expect(schedulerWarning({ status: "unknown", job: null, missingSecrets: [] })).toMatch(/could not read/);
  });
});

describe("readSchedulerHealth", () => {
  it("calls webhook_scheduler_health with the secret key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    rpc.mockResolvedValueOnce({ data: { status: "configured", job: true, missing_secrets: [] }, error: null });

    await expect(readSchedulerHealth("sb_secret_test")).resolves.toEqual({
      status: "configured",
      job: true,
      missingSecrets: [],
    });
    expect(createClient.mock.calls[0][1]).toBe("sb_secret_test");
    expect(rpc).toHaveBeenCalledWith("webhook_scheduler_health");
  });

  it("answers unknown, and does not throw, when the check fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied for function" } });
    await expect(readSchedulerHealth("k")).resolves.toMatchObject({ status: "unknown" });

    rpc.mockRejectedValueOnce(new Error("network down"));
    await expect(readSchedulerHealth("k")).resolves.toMatchObject({ status: "unknown" });
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
