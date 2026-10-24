import { describe, expect, it, vi } from "vitest";

/** Unknown `/api/v1` paths: JSON `not_found` for a caller, 401 for nobody. */
const authenticate = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { DELETE, GET } = await import("./route");
const { unauthorized } = await import("@/lib/api/errors");

const request = (method: string) =>
  new Request("https://qdit.test/api/v1/nope", {
    method,
    headers: { authorization: "Bearer a.b.c" },
  });

const context = { params: Promise.resolve({ path: ["nope"] }) };

describe("/api/v1/[...path]", () => {
  it("is a JSON 404 not_found for an authenticated caller", async () => {
    authenticate.mockResolvedValue({ supabase: {}, claims: {}, userId: "u", clientId: "c-404" });

    for (const handler of [GET, DELETE]) {
      const response = await handler(request(handler === GET ? "GET" : "DELETE"), context);
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect((await response.json()).error).toEqual({
        code: "not_found",
        message: expect.any(String),
        details: null,
      });
    }
  });

  it("is 401 without a valid token", async () => {
    authenticate.mockRejectedValue(unauthorized());

    expect((await GET(request("GET"), context)).status).toBe(401);
  });
});
