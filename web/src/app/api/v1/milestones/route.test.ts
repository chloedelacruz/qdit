import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/lib/api/errors";
import {
  apiRequest,
  CLIENT,
  DOC,
  expectedMilestone,
  MILESTONE,
  MILESTONE_KEYS,
  milestoneRow,
  PROJECT,
  USER,
} from "@/test/api-fixtures";
import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `POST /api/v1/milestones` against contract section 8. What the route sends
 * `create_linked_milestone()` and how it answers; the function's own checks
 * (role, doc linked, node free, status proposed) are in
 * supabase/tests/integration_links.test.sql.
 */
const authenticate = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { POST, GET } = await import("./route");

const BODY = {
  project_id: PROJECT,
  title: "Escrow contract",
  description: null,
  due_date: null,
  link: { doc_id: DOC, node_id: "h4", doc_version: 7 },
};

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

const create = (body: unknown) => POST(apiRequest("/milestones", { method: "POST", body }));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://qdit.atalusan.com";
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("POST /api/v1/milestones", () => {
  it("creates the milestone and its link, then answers 201 with the Milestone", async () => {
    const created = milestoneRow({ status: "proposed", due_date: null, order_index: 4 });
    const db = signedIn({
      rpc: { create_linked_milestone: [{ data: MILESTONE, error: null }] },
      from: { milestones: [{ data: created, error: null }] },
    });

    const response = await create({ ...BODY, title: "  Escrow contract  " });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      data: expectedMilestone({ status: "proposed", due_date: null, order_index: 4 }),
    });
    expect(Object.keys(body.data).sort()).toEqual(MILESTONE_KEYS);

    expect(db.requests[0]).toEqual({
      kind: "rpc",
      name: "create_linked_milestone",
      args: {
        p_project_id: PROJECT,
        p_title: "Escrow contract",
        p_description: null,
        p_due_date: null,
        p_doc_id: DOC,
        p_node_id: "h4",
        p_doc_version: 7,
      },
      calls: [],
    });
    // Read back with the caller's token, by the id the function returned.
    expect(db.requests[1].name).toBe("milestones");
    expect(db.requests[1].calls).toContainEqual(["eq", "id", MILESTONE]);
  });

  it("passes the optional fields through, and reads an omitted doc_version as null", async () => {
    const db = signedIn({
      rpc: { create_linked_milestone: [{ data: MILESTONE, error: null }] },
      from: { milestones: [{ data: milestoneRow(), error: null }] },
    });

    await create({
      project_id: PROJECT,
      title: "Escrow contract",
      description: "From the plan",
      due_date: "2026-11-15",
      link: { doc_id: DOC, node_id: "root" },
    });

    expect(db.requests[0].args).toMatchObject({
      p_description: "From the plan",
      p_due_date: "2026-11-15",
      p_node_id: "root",
      p_doc_version: null,
    });
  });

  it("answers 409 doc_not_linked when the doc is not linked to the project", async () => {
    signedIn({
      rpc: { create_linked_milestone: [{ data: null, error: { code: "QD409", message: "doc_not_linked", hint: null } }] },
    });

    const response = await create(BODY);

    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toEqual({ reason: "doc_not_linked" });
  });

  it("answers 409 node_already_linked naming the existing milestone", async () => {
    signedIn({
      rpc: {
        create_linked_milestone: [
          { data: null, error: { code: "QD409", message: "node_already_linked", hint: MILESTONE } },
        ],
      },
    });

    const response = await create(BODY);

    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toEqual({
      reason: "node_already_linked",
      milestone_id: MILESTONE,
    });
  });

  it("answers 403 below member and 404 outside the project", async () => {
    signedIn({ rpc: { create_linked_milestone: [{ data: null, error: { code: "42501", message: "x" } }] } });
    expect((await create(BODY)).status).toBe(403);

    signedIn({ rpc: { create_linked_milestone: [{ data: null, error: { code: "P0002", message: "x" } }] } });
    const missing = await create(BODY);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("not_found");
  });

  it.each([
    [{ ...BODY, project_id: undefined }, ["project_id"]],
    [{ ...BODY, title: "" }, ["title"]],
    [{ ...BODY, title: "x".repeat(301) }, ["title"]],
    [{ ...BODY, description: 3 }, ["description"]],
    [{ ...BODY, due_date: "2026-02-30" }, ["due_date"]],
    [{ ...BODY, due_date: "15/11/2026" }, ["due_date"]],
    [{ ...BODY, status: "approved" }, ["status"]],
    [{ ...BODY, link: undefined }, ["link"]],
    [{ ...BODY, link: "h4" }, ["link"]],
    [{ ...BODY, link: { ...BODY.link, doc_id: "x" } }, ["link.doc_id"]],
    [{ ...BODY, link: { ...BODY.link, node_id: "" } }, ["link.node_id"]],
    [{ ...BODY, link: { ...BODY.link, node_id: "h 4" } }, ["link.node_id"]],
    [{ ...BODY, link: { ...BODY.link, node_id: "h".repeat(65) } }, ["link.node_id"]],
    [{ ...BODY, link: { ...BODY.link, doc_version: 0 } }, ["link.doc_version"]],
    [{ ...BODY, link: { ...BODY.link, doc_version: 1.5 } }, ["link.doc_version"]],
    [{ ...BODY, link: { ...BODY.link, doc_version: "7" } }, ["link.doc_version"]],
    [{ ...BODY, link: { ...BODY.link, doc_version: 4_294_967_296 } }, ["link.doc_version"]],
    [{ ...BODY, link: { ...BODY.link, node_label: "Escrow" } }, ["link.node_label"]],
  ])("rejects %j as 400 invalid_request naming %j", async (body, fields) => {
    const db = signedIn();

    const response = await create(body);

    expect(response.status).toBe(400);
    const error = (await response.json()).error;
    expect(error.code).toBe("invalid_request");
    expect(Object.keys(error.details.fields)).toEqual(fields);
    expect(db.requests).toEqual([]);
  });

  it("refuses a request without a valid OAuth token", async () => {
    authenticate.mockRejectedValue(unauthorized());

    expect((await create(BODY)).status).toBe(401);
  });

  it("does not serve GET on the collection (D-27)", async () => {
    signedIn();

    const response = await GET(apiRequest("/milestones"));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });
});
