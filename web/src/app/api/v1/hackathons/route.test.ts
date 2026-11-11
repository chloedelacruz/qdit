import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `GET /api/v1/hackathons` against contract v1.3.0, section 8 (D-122). Auth is
 * mocked to a verified caller and the database is scripted; the wrapper
 * (`lib/api/handler.ts`) runs for real. Which hackathons are listed, their
 * order and the table's OAuth guard are the function's, and are covered by
 * supabase/tests/hackathon_list_for_clients.test.sql.
 */
const authenticate = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { GET, POST, HEAD } = await import("./route");
const { unauthorized } = await import("@/lib/api/errors");

const USER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CLIENT = "9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";

type Result = { data: unknown; error: unknown };

function signedIn(...results: Result[]) {
  const db = fakeDatabase({ rpc: { list_open_hackathons_for_client: results } });
  authenticate.mockResolvedValue({
    supabase: db.client,
    claims: { sub: USER, client_id: CLIENT },
    userId: USER,
    clientId: CLIENT,
  });
  return db;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    slug: "stellar-build-2026",
    name: "Stellar Build 2026",
    opens_at: "2026-11-14T01:00:00+00:00",
    closes_at: "2026-11-21T09:00:00+00:00",
    state: "upcoming",
    ...overrides,
  };
}

const request = (query = "", method = "GET") =>
  new Request(`https://qdit.test/api/v1/hackathons${query}`, {
    method,
    headers: { authorization: "Bearer a.b.c" },
  });

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /api/v1/hackathons", () => {
  it("returns the list in the contract shape, in the function's order, with no cursor", async () => {
    const db = signedIn({
      data: [
        row({ slug: "bootcamp-2026-11", name: "Bootcamp", opens_at: "2026-11-10T01:00:00+00:00", state: "open" }),
        row(),
      ],
      error: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          slug: "bootcamp-2026-11",
          name: "Bootcamp",
          opens_at: "2026-11-10T01:00:00+00:00",
          closes_at: "2026-11-21T09:00:00+00:00",
          state: "open",
        },
        {
          slug: "stellar-build-2026",
          name: "Stellar Build 2026",
          opens_at: "2026-11-14T01:00:00+00:00",
          closes_at: "2026-11-21T09:00:00+00:00",
          state: "upcoming",
        },
      ],
      next_cursor: null,
    });
    // Exactly the contract's fields.
    expect(Object.keys(body.data[0]).sort()).toEqual(["closes_at", "name", "opens_at", "slug", "state"]);

    // One call, to the function, with the caller's own client and no arguments.
    expect(db.requests).toEqual([
      expect.objectContaining({ kind: "rpc", name: "list_open_hackathons_for_client", args: undefined }),
    ]);
    expect(db.remaining()).toEqual([]);
  });

  it("answers an empty list as data: [] with next_cursor null", async () => {
    signedIn({ data: [], error: null });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [], next_cursor: null });
  });

  it("treats a null data as an empty list", async () => {
    signedIn({ data: null, error: null });

    await expect((await GET(request())).json()).resolves.toEqual({ data: [], next_cursor: null });
  });

  it("ignores query parameters, as the other parameterless reads do", async () => {
    const db = signedIn({ data: [row()], error: null });

    const response = await GET(request("?limit=1&cursor=abc&state=open"));

    expect(response.status).toBe(200);
    expect((await response.json()).data).toHaveLength(1);
    expect(db.requests[0]).toEqual(expect.objectContaining({ args: undefined }));
  });

  it("sends the name as plain text of 1 to 200 characters", async () => {
    signedIn({
      data: [
        row({ slug: "a", name: "  Bidi‮ trick\u0007  " }),
        row({ slug: "b", name: "\u{1F680}".repeat(250) }),
        row({ slug: "c-only-controls", name: "\u0001\u0002" }),
      ],
      error: null,
    });

    const { data } = await (await GET(request())).json();

    expect(data[0].name).toBe("Bidi trick");
    // Counted in code points, as Postgres counts them: no emoji is cut in half.
    expect(Array.from(data[1].name)).toHaveLength(200);
    expect(data[1].name).toBe("\u{1F680}".repeat(200));
    // Never empty: falls back to the slug.
    expect(data[2].name).toBe("c-only-controls");
  });

  it("drops a row whose state it does not know rather than send it", async () => {
    signedIn({ data: [row({ state: "closed" }), row({ slug: "kept", state: "open" })], error: null });

    const { data } = await (await GET(request())).json();

    expect(data.map((h: { slug: string }) => h.slug)).toEqual(["kept"]);
  });

  it("is 401 in the error envelope without a valid token, and never reaches the database", async () => {
    authenticate.mockRejectedValue(unauthorized());

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    expect((await response.json()).error.code).toBe("unauthorized");
  });

  it("is 401 when the function refuses the token (a revoke after authentication)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn({ data: null, error: { code: "42501", message: "This app's access to qdit was revoked." } });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
  });

  it("maps a database error to internal_error without leaking it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn({ data: null, error: { code: "PGRST202", message: "Could not find the function list_open_hackathons_for_client" } });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("list_open_hackathons_for_client");
  });

  it("maps an unreachable database to 503 unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn({ data: null, error: { code: "", message: "TypeError: fetch failed" } });

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("unavailable");
  });

  it.each([
    ["POST", POST],
    ["HEAD", HEAD],
  ])("answers %s with a JSON not_found, not Next's 405 or automatic answer", async (method, handler) => {
    signedIn();

    const response = await handler(request("", method));

    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect((await response.json()).error.code).toBe("not_found");
  });
});
