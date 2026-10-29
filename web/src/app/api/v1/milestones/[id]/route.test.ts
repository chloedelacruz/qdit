import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/lib/api/errors";
import {
  anchorRow,
  apiRequest,
  CLIENT,
  CONTRACT,
  expectedMilestone,
  MILESTONE,
  MILESTONE_KEYS,
  milestoneRow,
  params,
  PROJECT,
  USER,
} from "@/test/api-fixtures";
import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `GET` and `PATCH /api/v1/milestones/{id}` against contract sections 7 and
 * 8. The title lock and node_label sync are database rules, covered by
 * supabase/tests/integration_links.test.sql.
 */
const authenticate = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { GET, PATCH, PUT } = await import("./route");

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

const get = (id = MILESTONE) => GET(apiRequest(`/milestones/${id}`), params({ id }));
const patch = (body: unknown, id = MILESTONE) =>
  PATCH(apiRequest(`/milestones/${id}`, { method: "PATCH", body }), params({ id }));

const role = (value: string | null) => ({ data: value ? { role: value } : null, error: null });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://qdit.app";
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("GET /api/v1/milestones/{id}", () => {
  it("returns the Milestone in the contract shape", async () => {
    const db = signedIn({ from: { milestones: [{ data: milestoneRow(), error: null }] } });

    const response = await get();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: expectedMilestone() });
    expect(Object.keys(body.data).sort()).toEqual(MILESTONE_KEYS);

    const { calls } = db.requests[0];
    expect(calls).toContainEqual(["eq", "id", MILESTONE]);
    const select = String(calls.find(([method]) => method === "select")?.[1]);
    expect(select).toContain("link:milestone_external_links(");
    expect(select).toContain("anchors:milestone_anchors(");
  });

  it("summarises anchors by highest version, with the proof hash of the newest submit (D-32)", async () => {
    signedIn({
      from: {
        milestones: [
          {
            data: milestoneRow({
              anchors: [
                // Recorded out of chain order: v2's approve arrived before v2's submit.
                anchorRow({ version: 2, action: "approve", proof_hash: null, tx_hash: "e".repeat(64), created_at: "2026-10-22T08:11:40+00:00" }),
                anchorRow({ version: 1, action: "submit", proof_hash: "1".repeat(64), tx_hash: "f".repeat(64), created_at: "2026-10-23T09:00:00+00:00" }),
                anchorRow({ version: 2, action: "submit", proof_hash: "2".repeat(64), tx_hash: "d".repeat(64), created_at: "2026-10-21T08:00:00+00:00" }),
              ],
            }),
            error: null,
          },
        ],
      },
    });

    const body = await (await get()).json();

    expect(body.data.anchor).toEqual({
      network: "testnet",
      contract_id: CONTRACT,
      version: 2,
      proof_hash: "2".repeat(64),
      last_action: "approve",
      last_tx_hash: "e".repeat(64),
      anchored_at: "2026-10-22T08:11:40+00:00",
    });
  });

  it("breaks a version tie on created_at", async () => {
    signedIn({
      from: {
        milestones: [
          {
            data: milestoneRow({
              anchors: [
                anchorRow({ version: 3, action: "submit", tx_hash: "1".repeat(64), created_at: "2026-10-22T08:00:00.000001+00:00" }),
                anchorRow({ version: 3, action: "reject", proof_hash: null, tx_hash: "2".repeat(64), created_at: "2026-10-22T08:00:00.000002+00:00" }),
              ],
            }),
            error: null,
          },
        ],
      },
    });

    const body = await (await get()).json();

    expect(body.data.anchor.last_action).toBe("reject");
    expect(body.data.anchor.last_tx_hash).toBe("2".repeat(64));
  });

  it("sends link and anchor as null when there are none", async () => {
    signedIn({ from: { milestones: [{ data: milestoneRow({ link: null, anchors: [] }), error: null }] } });

    const body = await (await get()).json();

    expect(body.data.link).toBeNull();
    expect(body.data.anchor).toBeNull();
  });

  it("answers 404 for a milestone the caller cannot see, and for a malformed id", async () => {
    signedIn({ from: { milestones: [{ data: null, error: null }] } });
    const hidden = await get();
    expect(hidden.status).toBe(404);
    expect((await hidden.json()).error).toEqual({ code: "not_found", message: "No such milestone.", details: null });

    const db = signedIn();
    expect((await get("12345")).status).toBe(404);
    expect(db.requests).toEqual([]);
  });

  it("refuses a request without a valid OAuth token", async () => {
    authenticate.mockRejectedValue(unauthorized());

    expect((await get()).status).toBe(401);
  });

  it("answers an unsupported method with not_found (D-27)", async () => {
    signedIn();

    const response = await PUT(apiRequest(`/milestones/${MILESTONE}`, { method: "PUT", body: {} }), params({ id: MILESTONE }));

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/v1/milestones/{id}", () => {
  it("renames a linked milestone and returns it", async () => {
    const renamed = milestoneRow({ title: "Escrow v2", link: { ...milestoneRow().link, node_label: "Escrow v2" } });
    const db = signedIn({
      from: {
        milestones: [
          { data: milestoneRow(), error: null },
          { data: [{ id: MILESTONE }], error: null },
          { data: renamed, error: null },
        ],
        project_members: [role("member")],
      },
    });

    const response = await patch({ title: "  Escrow v2 " });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.title).toBe("Escrow v2");
    expect(body.data.link.node_label).toBe("Escrow v2");

    const [, membership, update] = db.requests;
    expect(membership.calls).toEqual(
      expect.arrayContaining([
        ["eq", "project_id", PROJECT],
        ["eq", "user_id", USER],
      ]),
    );
    expect(update.calls).toContainEqual(["update", { title: "Escrow v2" }]);
    expect(update.calls).toContainEqual(["eq", "id", MILESTONE]);
    expect(db.remaining()).toEqual([]);
  });

  it("answers 409 milestone_not_linked for an unlinked milestone, without writing", async () => {
    const db = signedIn({
      from: {
        milestones: [{ data: milestoneRow({ link: null }), error: null }],
        project_members: [role("admin")],
      },
    });

    const response = await patch({ title: "Renamed" });

    expect(response.status).toBe(409);
    expect((await response.json()).error.details).toEqual({ reason: "milestone_not_linked" });
    expect(db.requests.map((r) => r.name)).toEqual(["milestones", "project_members"]);
  });

  it("answers 409 when the link went away between the read and the write", async () => {
    signedIn({
      from: {
        milestones: [
          { data: milestoneRow(), error: null },
          { data: [], error: null },
          { data: milestoneRow({ link: null }), error: null },
        ],
        project_members: [role("member")],
      },
    });

    const response = await patch({ title: "Renamed" });

    expect(response.status).toBe(409);
    expect((await response.json()).error.details.reason).toBe("milestone_not_linked");
  });

  it("answers 403 for a viewer, without writing", async () => {
    const db = signedIn({
      from: {
        milestones: [{ data: milestoneRow(), error: null }],
        project_members: [role("viewer")],
      },
    });

    const response = await patch({ title: "Renamed" });

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(db.requests).toHaveLength(2);
  });

  it("answers 404 for a milestone the caller cannot see", async () => {
    signedIn({ from: { milestones: [{ data: null, error: null }] } });

    expect((await patch({ title: "Renamed" })).status).toBe(404);
  });

  it("answers 403 when the database guard refuses the write", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn({
      from: {
        milestones: [
          { data: milestoneRow(), error: null },
          { data: null, error: { code: "42501", message: "Apps connected through OAuth can only rename a linked milestone." } },
        ],
        project_members: [role("member")],
      },
    });

    const response = await patch({ title: "Renamed" });

    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("OAuth can only");
  });

  it.each([
    [{}, ["title"]],
    [{ title: "" }, ["title"]],
    [{ title: "   " }, ["title"]],
    [{ title: null }, ["title"]],
    [{ title: "Ok", description: "no" }, ["description"]],
    [{ title: "Ok", status: "approved" }, ["status"]],
    // D-46: a linked milestone stays in its project, and the API has no way
    // to move any milestone.
    [{ title: "Ok", project_id: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34" }, ["project_id"]],
  ])("rejects %j as 400 invalid_request naming %j", async (body, fields) => {
    const db = signedIn();

    const response = await patch(body);

    expect(response.status).toBe(400);
    expect(Object.keys((await response.json()).error.details.fields)).toEqual(fields);
    expect(db.requests).toEqual([]);
  });
});
