import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isCronAuthorized } from "@/lib/webhooks/cron-auth";

/**
 * `GET /api/cron/deliver-webhooks`: who may run it and what it answers. The
 * delivery loop itself is covered by lib/webhooks/deliver.test.ts; here the
 * outbox is an empty fake.
 */
const claim = vi.fn(async () => []);
const supabaseOutbox = vi.fn(() => ({ claim, record: vi.fn() }));
vi.mock("@/lib/webhooks/outbox", () => ({ supabaseOutbox }));

const { GET } = await import("./route");

const CRON_SECRET = "cron-secret-for-tests";
const KEY = randomBytes(32).toString("base64");

const call = (authorization?: string) =>
  GET(
    new Request("https://qdit.test/api/cron/deliver-webhooks", {
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubEnv("INTEGRATION_WEBHOOK_ENCRYPTION_KEY", KEY);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /api/cron/deliver-webhooks", () => {
  it("runs a delivery pass for the cron secret and reports it", async () => {
    const response = await call(`Bearer ${CRON_SECRET}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: { claimed: 0, delivered: 0, retrying: 0, dead: 0, stale: 0 },
    });
    expect(supabaseOutbox).toHaveBeenCalledWith("sb_secret_test");
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no header", undefined],
    ["a wrong secret", "Bearer nope"],
    ["the secret without Bearer", CRON_SECRET],
    ["another scheme", `Basic ${CRON_SECRET}`],
  ])("refuses %s with 401 and does nothing", async (_label, header) => {
    const response = await call(header);

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
    expect(supabaseOutbox).not.toHaveBeenCalled();
  });

  it("refuses everything when CRON_SECRET is not set", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await call("Bearer ");

    expect(response.status).toBe(503);
    expect(supabaseOutbox).not.toHaveBeenCalled();
  });

  it.each([
    ["SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEY"],
    ["INTEGRATION_WEBHOOK_ENCRYPTION_KEY", "INTEGRATION_WEBHOOK_ENCRYPTION_KEY"],
  ])("answers 503 without %s", async (_label, name) => {
    vi.stubEnv(name, "");

    const response = await call(`Bearer ${CRON_SECRET}`);

    expect(response.status).toBe(503);
    expect(supabaseOutbox).not.toHaveBeenCalled();
  });

  it("answers 500 when the claim fails", async () => {
    claim.mockRejectedValueOnce(new Error("webhooks: claim failed: boom"));

    const response = await call(`Bearer ${CRON_SECRET}`);

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal_error");
  });
});

describe("isCronAuthorized", () => {
  it("matches only `Bearer <secret>` exactly", () => {
    expect(isCronAuthorized(`Bearer ${CRON_SECRET}`, CRON_SECRET)).toBe(true);
    expect(isCronAuthorized(`Bearer ${CRON_SECRET} `, CRON_SECRET)).toBe(false);
    expect(isCronAuthorized(`bearer ${CRON_SECRET}`, CRON_SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${CRON_SECRET}x`, CRON_SECRET)).toBe(false);
  });

  it("never matches when no secret is configured", () => {
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorized(null, CRON_SECRET)).toBe(false);
  });
});
