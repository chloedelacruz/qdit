import { afterEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/lib/api/errors";
import { apiRequest, CLIENT, DOC, LINK, params, PROJECT, USER } from "@/test/api-fixtures";
import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `DELETE /api/v1/projects/{id}/docs/{doc_id}` against contract section 8 and
 * D-22. The transaction itself (`unlink_project_doc()`) is covered by
 * supabase/tests/integration_links.test.sql.
 */
const authenticate = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { DELETE } = await import("./route");

const OTHER_LINK = "1f0e9d8c-7b6a-4f5e-8d4c-3b2a1f0e9d8c";

function signedIn(script: Parameters<typeof fakeDatabase>[0] = {}) {
  const db = fakeDatabase(script);
  authenticate.mockResolvedValue({
    supabase: db.client,
    claims: { sub: USER, client_id: CLIENT },
    userId: USER,
    clientId: CLIENT,
  });
  return db;
}

const unlink = (project = PROJECT, doc = DOC) =>
  DELETE(apiRequest(`/projects/${project}/docs/${doc}`, { method: "DELETE" }), params({ id: project, doc_id: doc }));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("DELETE /api/v1/projects/{id}/docs/{doc_id}", () => {
  it("unlinks the doc and returns the removed milestone link ids", async () => {
    const db = signedIn({ rpc: { unlink_project_doc: [{ data: [LINK, OTHER_LINK], error: null }] } });

    const response = await unlink();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { removed_link_ids: [LINK, OTHER_LINK] } });
    expect(db.requests).toEqual([
      { kind: "rpc", name: "unlink_project_doc", args: { p_project_id: PROJECT, p_doc_id: DOC }, calls: [] },
    ]);
  });

  it("returns [] when the doc had no milestone links", async () => {
    signedIn({ rpc: { unlink_project_doc: [{ data: [], error: null }] } });

    expect(await (await unlink()).json()).toEqual({ data: { removed_link_ids: [] } });
  });

  it("answers 404 when the doc is not linked here, or the project is not visible", async () => {
    signedIn({ rpc: { unlink_project_doc: [{ data: null, error: { code: "P0002", message: "x" } }] } });

    const response = await unlink();

    expect(response.status).toBe(404);
    expect((await response.json()).error).toEqual({
      code: "not_found",
      message: "No such doc link in this project.",
      details: null,
    });
  });

  it("answers 403 below admin", async () => {
    signedIn({ rpc: { unlink_project_doc: [{ data: null, error: { code: "42501", message: "x" } }] } });

    const response = await unlink();

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
  });

  it.each([
    ["project", "nope", DOC],
    ["doc", PROJECT, "nope"],
  ])("treats a malformed %s id as unknown without asking the database", async (_label, project, doc) => {
    const db = signedIn();

    const response = await unlink(project, doc);

    expect(response.status).toBe(404);
    expect(db.requests).toEqual([]);
  });

  it("refuses a request without a valid OAuth token", async () => {
    authenticate.mockRejectedValue(unauthorized());

    expect((await unlink()).status).toBe(401);
  });
});
