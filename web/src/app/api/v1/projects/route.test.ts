import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeCursor } from "@/lib/api/pagination";
import { fakeClient, fakeQuery } from "@/test/fake-supabase";

/**
 * `GET /api/v1/projects` against contract sections 7 (Project) and 8
 * (pagination). The query builder is fake, so these check what the route asks
 * PostgREST for and how it shapes the answer; RLS itself is covered by the
 * pgTAP suites.
 */
const authenticate = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { GET } = await import("./route");

const USER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CLIENT = "9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";

function row(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `3f6c2a1e-8b4d-4c7e-9a10-${String(n).padStart(12, "0")}`,
    name: `Project ${n}`,
    slug: `project-${n}`,
    description: null,
    status: "active",
    chain_network: null,
    chain_contract_id: null,
    created_at: `2026-10-${String(20 - n).padStart(2, "0")}T09:30:00.123456+00:00`,
    updated_at: "2026-10-20T14:02:11+00:00",
    project_members: [{ role: "member" }],
    ...overrides,
  };
}

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

const request = (query = "") =>
  new Request(`https://qdit.test/api/v1/projects${query}`, {
    headers: { authorization: "Bearer a.b.c" },
  });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://qdit.atalusan.com";
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /api/v1/projects", () => {
  it("returns Projects in the contract shape", async () => {
    signedIn({
      data: [
        row(1, {
          id: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34",
          name: "Soroban payroll",
          slug: "soroban-payroll",
          chain_network: "testnet",
          chain_contract_id: "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG",
          created_at: "2026-10-01T09:30:00+00:00",
        }),
        row(2, { project_members: [{ role: "owner" }], status: "paused" }),
      ],
      error: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      data: [
        {
          id: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34",
          name: "Soroban payroll",
          slug: "soroban-payroll",
          description: null,
          status: "active",
          role: "member",
          chain: {
            network: "testnet",
            contract_id: "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG",
          },
          url: "https://qdit.atalusan.com/projects/soroban-payroll",
          created_at: "2026-10-01T09:30:00+00:00",
          updated_at: "2026-10-20T14:02:11+00:00",
        },
        expect.objectContaining({ role: "owner", status: "paused", chain: null }),
      ],
      next_cursor: null,
    });
    // Exactly the contract's fields, nothing leaked from the row.
    expect(Object.keys(body.data[0]).sort()).toEqual(
      ["chain", "created_at", "description", "id", "name", "role", "slug", "status", "updated_at", "url"],
    );
  });

  it("asks for member projects only, newest first, one past the default limit", async () => {
    const { calls, tables } = signedIn({ data: [], error: null });

    await GET(request());

    expect(tables).toEqual(["projects"]);
    expect(calls).toContainEqual(["select", expect.stringContaining("project_members!inner(role)")]);
    expect(calls).toContainEqual(["eq", "project_members.user_id", USER]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["order", "id", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 51]);
    expect(calls.some(([method]) => method === "or")).toBe(false);
  });

  it("returns a next_cursor when there is another page, keyed on the last row returned", async () => {
    signedIn({ data: [row(1), row(2), row(3)], error: null });

    const body = await (await GET(request("?limit=2"))).json();

    expect(body.data).toHaveLength(2);
    expect(body.next_cursor).toBe(
      encodeCursor({ createdAt: row(2).created_at, id: row(2).id }),
    );
  });

  it("continues after a cursor, keeping microsecond precision", async () => {
    const { calls } = signedIn({ data: [], error: null });
    const cursor = encodeCursor({ createdAt: row(2).created_at, id: row(2).id });

    await GET(request(`?cursor=${cursor}`));

    expect(calls).toContainEqual([
      "or",
      `created_at.lt."${row(2).created_at}",and(created_at.eq."${row(2).created_at}",id.lt.${row(2).id})`,
    ]);
  });

  it.each([
    ["?limit=0", "limit"],
    ["?limit=101", "limit"],
    ["?limit=ten", "limit"],
    ["?cursor=not*base64", "cursor"],
    [`?cursor=${Buffer.from('{"c":"yesterday","i":"x"}').toString("base64url")}`, "cursor"],
  ])("rejects %s as 400 invalid_request naming the field", async (query, field) => {
    signedIn({ data: [], error: null });

    const response = await GET(request(query));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_request");
    expect(Object.keys(body.error.details.fields)).toEqual([field]);
  });

  it("maps a database error to internal_error without leaking it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn({ data: null, error: { code: "42P01", message: "relation does not exist" } });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("relation");
  });
});
