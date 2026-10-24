import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wrapper's job is everything around a handler: request ids, the error
 * envelope, rate limits and the audit row. `authenticate` and the audit write
 * are mocked; `after()` runs its callback immediately, since there is no
 * request scope outside Next.
 */
const authenticate = vi.fn();
const recordApiRequest = vi.fn(async () => {});

vi.mock("./auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("./audit", () => ({
  recordApiRequest: (...args: unknown[]) => recordApiRequest(...(args as [])),
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));

const { API_RATE_LIMITS, apiRoute, ok } = await import("./handler");
const { ApiError, unauthorized } = await import("./errors");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let clientCounter = 0;
function caller(clientId = `client-${++clientCounter}`, userId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d") {
  return { supabase: {}, claims: {}, clientId, userId };
}

function get(path = "/api/v1/thing?x=1") {
  return new Request(`https://qdit.test${path}`, {
    headers: { authorization: "Bearer a.b.c" },
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("apiRoute", () => {
  it("wraps success in the contract headers and audits it", async () => {
    const auth = caller("client-ok");
    authenticate.mockResolvedValue(auth);
    const route = apiRoute(async () => ok({ hello: "world" }));

    const response = await route(get());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(UUID);
    await expect(response.json()).resolves.toEqual({ data: { hello: "world" } });

    expect(recordApiRequest).toHaveBeenCalledWith({
      requestId,
      clientId: "client-ok",
      userId: auth.userId,
      method: "GET",
      path: "/api/v1/thing",
      status: 200,
    });
  });

  it("answers an auth failure in the error envelope and writes no audit row", async () => {
    authenticate.mockRejectedValue(unauthorized());
    const handler = vi.fn();
    const route = apiRoute(handler);

    const response = await route(get());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized", details: null },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(recordApiRequest).not.toHaveBeenCalled();
  });

  it("passes an ApiError's code, details and status through and audits the status", async () => {
    authenticate.mockResolvedValue(caller());
    const route = apiRoute(async () => {
      throw new ApiError("conflict", "Already linked.", {
        details: { reason: "node_already_linked" },
      });
    });

    const response = await route(get());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "conflict", message: "Already linked.", details: { reason: "node_already_linked" } },
    });
    expect(recordApiRequest).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));
  });

  it("hides an unexpected error behind internal_error", async () => {
    authenticate.mockResolvedValue(caller());
    const route = apiRoute(async () => {
      throw new Error("relation \"secret_table\" does not exist");
    });

    const response = await route(get());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("secret_table");
  });

  it("hands the handler its awaited route params", async () => {
    authenticate.mockResolvedValue(caller());
    const handler = vi.fn(async () => ok(null));
    const route = apiRoute<{ id: string }>(handler);

    await route(get(), { params: Promise.resolve({ id: "abc" }) });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ params: { id: "abc" } }));
  });

  it("rate-limits per (client, user) with Retry-After", async () => {
    const auth = caller("client-busy");
    authenticate.mockResolvedValue(auth);
    const route = apiRoute(async () => ok(null));

    for (let i = 0; i < API_RATE_LIMITS.perUser.limit; i++) {
      expect((await route(get())).status).toBe(200);
    }

    const limited = await route(get());
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: "rate_limited", details: null },
    });
    expect(recordApiRequest).toHaveBeenLastCalledWith(expect.objectContaining({ status: 429 }));

    // Another user of the same client still has their own budget.
    authenticate.mockResolvedValue(caller("client-busy", "2a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"));
    expect((await route(get())).status).toBe(200);
  });

  it("rate-limits per client across its users", async () => {
    const route = apiRoute(async () => ok(null));
    const { limit } = API_RATE_LIMITS.perClient;

    // Spread over enough users that no single one hits the per-user limit.
    for (let i = 0; i < limit; i++) {
      const user = `00000000-0000-4000-8000-${String(i % 50).padStart(12, "0")}`;
      authenticate.mockResolvedValueOnce(caller("client-crowded", user));
      expect((await route(get())).status).toBe(200);
    }

    authenticate.mockResolvedValueOnce(
      caller("client-crowded", "00000000-0000-4000-8000-999999999999"),
    );
    expect((await route(get())).status).toBe(429);
  });
});
