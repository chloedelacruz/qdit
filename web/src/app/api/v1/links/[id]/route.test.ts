import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/lib/api/errors";
import {
  apiRequest,
  CLIENT,
  DOC,
  expectedMilestone,
  LINK,
  MILESTONE,
  milestoneRow,
  linkRow,
  params,
  PROJECT,
  USER,
} from "@/test/api-fixtures";
import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `PATCH` and `DELETE /api/v1/links/{id}` against contract section 8 (D-21).
 * Which columns the database lets move is covered by
 * supabase/tests/integration_links.test.sql.
 */
const authenticate = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { PATCH, DELETE, GET } = await import("./route");

const OTHER_MILESTONE = "7c6b5a49-3827-4a16-9f05-e4d3c2b1a098";
const REF = { id: LINK, milestone_id: MILESTONE, project_id: PROJECT, doc_id: DOC };

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

const patch = (body: unknown, id = LINK) =>
  PATCH(apiRequest(`/links/${id}`, { method: "PATCH", body }), params({ id }));
const remove = (id = LINK) => DELETE(apiRequest(`/links/${id}`, { method: "DELETE" }), params({ id }));

const role = (value: string) => ({ data: { role: value }, error: null });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://qdit.app";
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("PATCH /api/v1/links/{id}", () => {
  it("re-points the link in place and returns its Milestone (D-21)", async () => {
    const moved = milestoneRow({ link: linkRow({ node_id: "h5", doc_version: 8 }) });
    const db = signedIn({
      from: {
        milestone_external_links: [
          { data: REF, error: null },
          { data: [{ id: LINK }], error: null },
        ],
        project_members: [role("member")],
        milestones: [{ data: moved, error: null }],
      },
    });

    const response = await patch({ node_id: "h5", doc_version: 8 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: expectedMilestone({ link: { ...expectedMilestone().link, node_id: "h5", doc_version: 8 } }),
    });
    const update = db.requests[2];
    expect(update.calls).toContainEqual(["update", { node_id: "h5", doc_version: 8 }]);
    expect(update.calls).toContainEqual(["eq", "id", LINK]);
    expect(db.requests[3].calls).toContainEqual(["eq", "id", MILESTONE]);
  });

  it("sends only the fields given, and accepts doc_version null", async () => {
    const db = signedIn({
      from: {
        milestone_external_links: [
          { data: REF, error: null },
          { data: [{ id: LINK }], error: null },
        ],
        project_members: [role("owner")],
        milestones: [{ data: milestoneRow(), error: null }],
      },
    });

    await patch({ doc_version: null });

    expect(db.requests[2].calls).toContainEqual(["update", { doc_version: null }]);
  });

  it("answers 409 node_already_linked naming the milestone that holds the node", async () => {
    const db = signedIn({
      from: {
        milestone_external_links: [
          { data: REF, error: null },
          { data: null, error: { code: "23505", message: "duplicate key" } },
          { data: { milestone_id: OTHER_MILESTONE }, error: null },
        ],
        project_members: [role("member")],
      },
    });

    const response = await patch({ node_id: "h2" });

    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toEqual({
      reason: "node_already_linked",
      milestone_id: OTHER_MILESTONE,
    });
    expect(db.requests[3].calls).toEqual(
      expect.arrayContaining([
        ["eq", "doc_id", DOC],
        ["eq", "node_id", "h2"],
      ]),
    );
  });

  it("answers 403 for a viewer, without writing", async () => {
    const db = signedIn({
      from: {
        milestone_external_links: [{ data: REF, error: null }],
        project_members: [role("viewer")],
      },
    });

    const response = await patch({ node_id: "h5" });

    expect(response.status).toBe(403);
    expect(db.requests).toHaveLength(2);
  });

  it("answers 404 for a link the caller cannot see, and for a malformed id", async () => {
    signedIn({ from: { milestone_external_links: [{ data: null, error: null }] } });
    const hidden = await patch({ node_id: "h5" });
    expect(hidden.status).toBe(404);
    expect((await hidden.json()).error).toEqual({ code: "not_found", message: "No such link.", details: null });

    const db = signedIn();
    expect((await patch({ node_id: "h5" }, "link-1")).status).toBe(404);
    expect(db.requests).toEqual([]);
  });

  it.each([
    [{}, ["body"]],
    [{ node_label: "Escrow" }, ["node_label"]],
    [{ node_id: "h5", milestone_id: MILESTONE }, ["milestone_id"]],
    [{ node_id: "" }, ["node_id"]],
    [{ node_id: 5 }, ["node_id"]],
    [{ doc_version: 0 }, ["doc_version"]],
    [{ doc_version: "8" }, ["doc_version"]],
  ])("rejects %j as 400 invalid_request naming %j", async (body, fields) => {
    const db = signedIn();

    const response = await patch(body);

    expect(response.status).toBe(400);
    expect(Object.keys((await response.json()).error.details.fields)).toEqual(fields);
    expect(db.requests).toEqual([]);
  });

  it("points a caller sending node_label at the rename endpoint", async () => {
    signedIn();

    const body = await (await patch({ node_label: "Escrow" })).json();

    expect(body.error.details.fields.node_label).toContain("PATCH /milestones/{id}");
  });

  it("refuses a request without a valid OAuth token", async () => {
    authenticate.mockRejectedValue(unauthorized());

    expect((await patch({ node_id: "h5" })).status).toBe(401);
  });
});

describe("DELETE /api/v1/links/{id}", () => {
  it("deletes the link: 204 with no body", async () => {
    const db = signedIn({
      from: {
        milestone_external_links: [
          { data: REF, error: null },
          { data: [{ id: LINK }], error: null },
        ],
        project_members: [role("member")],
      },
    });

    const response = await remove();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const deletion = db.requests[2];
    expect(deletion.calls).toContainEqual(["delete"]);
    expect(deletion.calls).toContainEqual(["eq", "id", LINK]);
  });

  it("answers 404 for a repeated delete", async () => {
    signedIn({ from: { milestone_external_links: [{ data: null, error: null }] } });

    expect((await remove()).status).toBe(404);
  });

  it("answers 404 when the row is gone by the time of the delete", async () => {
    signedIn({
      from: {
        milestone_external_links: [
          { data: REF, error: null },
          { data: [], error: null },
        ],
        project_members: [role("member")],
      },
    });

    expect((await remove()).status).toBe(404);
  });

  it("answers 403 for a viewer, without deleting", async () => {
    const db = signedIn({
      from: {
        milestone_external_links: [{ data: REF, error: null }],
        project_members: [role("viewer")],
      },
    });

    expect((await remove()).status).toBe(403);
    expect(db.requests).toHaveLength(2);
  });

  it("refuses a request without a valid OAuth token", async () => {
    authenticate.mockRejectedValue(unauthorized());

    expect((await remove()).status).toBe(401);
  });

  it("does not serve GET (D-27)", async () => {
    signedIn();

    expect((await GET(apiRequest(`/links/${LINK}`), params({ id: LINK }))).status).toBe(404);
  });
});
