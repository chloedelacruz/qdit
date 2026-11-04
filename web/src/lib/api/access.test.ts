import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiAuth } from "./auth";
import { loadMilestone, requireRole, roleAtLeast } from "./access";
import { ApiError } from "./errors";

/**
 * A PostgREST builder stand-in that records the filters and answers what the
 * test set. RLS is the database's job; here only the decisions taken on the
 * answer are under test (contract section 8: 404 when not a member, 403 when
 * the role is too low).
 */
function fakeAuth(answer: { data: unknown; error: unknown }) {
  const calls: { table?: string; select?: string; eq: [string, unknown][] } = { eq: [] };
  const builder = {
    select(columns: string) {
      calls.select = columns;
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      return builder;
    },
    maybeSingle: async () => answer,
  };
  const auth = {
    userId: "user-1",
    clientId: "client-1",
    claims: {},
    supabase: {
      from(table: string) {
        calls.table = table;
        return builder;
      },
    },
  } as unknown as ApiAuth;
  return { auth, calls };
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.NEXT_PUBLIC_SITE_URL = "https://qdit.test";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("roleAtLeast", () => {
  it("orders viewer < member < admin < owner", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("member", "admin")).toBe(false);
    expect(roleAtLeast("viewer", "member")).toBe(false);
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
    expect(roleAtLeast("admin", "owner")).toBe(false);
  });
});

describe("requireRole", () => {
  it("reads the caller's own membership row in that project", async () => {
    const { auth, calls } = fakeAuth({ data: { role: "admin" }, error: null });

    await expect(requireRole(auth, "proj-1", "member", "No such project.")).resolves.toBe("admin");
    expect(calls.table).toBe("project_members");
    expect(calls.select).toBe("role");
    expect(calls.eq).toEqual([
      ["project_id", "proj-1"],
      ["user_id", "user-1"],
    ]);
  });

  it("is not_found when the caller is not a member, with the endpoint's message", async () => {
    const { auth } = fakeAuth({ data: null, error: null });
    const error = await rejection(requireRole(auth, "proj-1", "viewer", "No such project."));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("not_found");
    expect(error.status).toBe(404);
    expect(error.message).toBe("No such project.");
  });

  it("is forbidden when the role is too low, naming the role needed", async () => {
    const { auth } = fakeAuth({ data: { role: "member" }, error: null });
    const error = await rejection(requireRole(auth, "proj-1", "owner", "No such project."));

    expect(error.code).toBe("forbidden");
    expect(error.status).toBe(403);
    expect(error.message).toContain("owner");
  });

  it("maps a database failure through databaseError rather than a 404", async () => {
    const { auth } = fakeAuth({ data: null, error: { message: "fetch failed", code: "" } });
    const error = await rejection(requireRole(auth, "proj-1", "viewer", "No such project."));

    expect(error.code).toBe("unavailable");
  });

  it("an expired token on the read is a 401", async () => {
    const { auth } = fakeAuth({ data: null, error: { message: "JWT expired", code: "PGRST301" } });
    const error = await rejection(requireRole(auth, "proj-1", "viewer", "No such project."));

    expect(error.status).toBe(401);
  });
});

describe("loadMilestone", () => {
  const row = {
    id: "m-1",
    title: "Ship",
    description: null,
    status: "submitted",
    due_date: null,
    order_index: 0,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-02T00:00:00Z",
    project: { id: "p-1", name: "Proj", slug: "proj" },
    link: [],
    anchors: [],
  };

  it("returns the milestone in the contract shape", async () => {
    const { auth, calls } = fakeAuth({ data: row, error: null });
    const milestone = await loadMilestone(auth, "m-1");

    expect(calls.table).toBe("milestones");
    expect(calls.eq).toEqual([["id", "m-1"]]);
    expect(milestone).toMatchObject({
      id: "m-1",
      project: { id: "p-1", slug: "proj" },
      status: "submitted",
      link: null,
      anchor: null,
    });
  });

  it("is null when RLS hides the milestone", async () => {
    const { auth } = fakeAuth({ data: null, error: null });
    await expect(loadMilestone(auth, "m-1")).resolves.toBeNull();
  });

  it("throws on a database failure", async () => {
    const { auth } = fakeAuth({ data: null, error: { message: "denied", code: "42501" } });
    const error = await rejection(loadMilestone(auth, "m-1"));

    expect(error.code).toBe("forbidden");
  });
});
