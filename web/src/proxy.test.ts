import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `proxy()` routing for `/api/v1`: no session refresh, and a method Next would
 * refuse before any Route Handler runs (an empty 400) gets the API's own
 * answer instead (D-27). The session refresh and token check are mocked; the
 * `/api/v1` wrapper runs for real.
 */
const authenticate = vi.fn();
const updateSession = vi.fn(async () => new Response("session"));

vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("@/lib/supabase/proxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/proxy")>()),
  updateSession: () => updateSession(),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));

const { proxy } = await import("./proxy");
const { unauthorized } = await import("@/lib/api/errors");

const request = (method: string, path: string) =>
  new NextRequest(`https://qdit.test${path}`, {
    method,
    headers: { authorization: "Bearer a.b.c" },
  });

/** `NextResponse.next()`: carry on to the route, nothing answered here. */
const passedThrough = (response: Response) =>
  response.headers.get("x-middleware-next") === "1";

afterEach(() => {
  vi.clearAllMocks();
});

describe("proxy on /api/v1", () => {
  it.each(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"])(
    "hands %s to the Route Handlers without a session refresh",
    async (method) => {
      const response = await proxy(request(method, "/api/v1/me"));

      expect(passedThrough(response)).toBe(true);
      expect(updateSession).not.toHaveBeenCalled();
      expect(authenticate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["PROPFIND", "/api/v1/me"],
    ["M-SEARCH", "/api/v1/projects"],
    ["PURGE", "/api/v1"],
  ])("answers %s %s with the not_found envelope", async (method, path) => {
    authenticate.mockResolvedValue({ supabase: {}, claims: {}, userId: "u", clientId: "c-proxy" });

    const response = await proxy(request(method, path));

    expect(passedThrough(response)).toBe(false);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: expect.any(String), details: null },
    });
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("authenticates first: an anonymous odd method is 401 like everything else", async () => {
    authenticate.mockRejectedValue(unauthorized());

    const response = await proxy(request("PROPFIND", "/api/v1/me"));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
  });
});

describe("proxy elsewhere", () => {
  it("refreshes the session, whatever the method", async () => {
    for (const method of ["GET", "PROPFIND"]) {
      const response = await proxy(request(method, "/dashboard"));
      expect(await response.text()).toBe("session");
    }
    expect(updateSession).toHaveBeenCalledTimes(2);
    expect(authenticate).not.toHaveBeenCalled();
  });
});
