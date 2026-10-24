import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeClient, fakeQuery } from "@/test/fake-supabase";

/**
 * `GET /api/v1/me` against the contract's example body (section 8). Auth is
 * mocked to a verified caller whose client is a fake query builder; the
 * wrapper (`lib/api/handler.ts`) runs for real.
 */
const authenticate = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { GET, POST } = await import("./route");
const { unauthorized } = await import("@/lib/api/errors");

const USER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CLIENT = "9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";

function signedIn(result: { data: unknown; error: unknown }) {
  const query = fakeQuery(result);
  const db = fakeClient(query.builder);
  authenticate.mockResolvedValue({
    supabase: db.client,
    claims: { sub: USER, client_id: CLIENT },
    userId: USER,
    clientId: CLIENT,
  });
  return { ...query, tables: db.tables };
}

const request = () =>
  new Request("https://qdit.test/api/v1/me", { headers: { authorization: "Bearer a.b.c" } });

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /api/v1/me", () => {
  it("returns the caller's profile and client id in the contract shape", async () => {
    const { calls, tables } = signedIn({
      data: {
        id: USER,
        username: "chloedelacruz",
        display_name: "Chloe",
        avatar_url: null,
        wallet_address: "GABCXYZ",
      },
      error: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        user: {
          id: USER,
          username: "chloedelacruz",
          display_name: "Chloe",
          avatar_url: null,
          wallet_address: "GABCXYZ",
        },
        client_id: CLIENT,
      },
    });
    expect(tables).toEqual(["profiles"]);
    expect(calls).toContainEqual(["eq", "id", USER]);
  });

  it("still answers, with nulls, when the profile row is missing", async () => {
    signedIn({ data: null, error: null });

    const body = await (await GET(request())).json();

    expect(body).toEqual({
      data: {
        user: { id: USER, username: null, display_name: null, avatar_url: null, wallet_address: null },
        client_id: CLIENT,
      },
    });
  });

  it("is 401 in the error envelope without a valid token", async () => {
    authenticate.mockRejectedValue(unauthorized());

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
  });

  it("is 503 when the database cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn({ data: null, error: { code: "", message: "TypeError: fetch failed" } });

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("unavailable");
  });

  it("answers an unsupported method with a JSON not_found, not Next's 405", async () => {
    signedIn({ data: null, error: null });

    const response = await POST(
      new Request("https://qdit.test/api/v1/me", { method: "POST", headers: { authorization: "Bearer a.b.c" } }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect((await response.json()).error.code).toBe("not_found");
  });
});
