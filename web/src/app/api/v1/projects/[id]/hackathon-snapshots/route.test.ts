import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/lib/api/errors";
import {
  apiRequest,
  CLIENT,
  params,
  PROJECT,
  SNAPSHOT_DOC,
  SNAPSHOT_ID,
  snapshotBody,
  snapshotNote,
  STORED_SNAPSHOT,
  USER,
  WORKSPACE,
} from "@/test/api-fixtures";
import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `POST /api/v1/projects/{id}/hackathon-snapshots` against contract
 * section 8 (v1.2.0, WP-4.7, D-117, D-118). The database is fake: these
 * check the check order, what the route sends
 * `push_doqtri_hackathon_snapshot()` and how it answers; the function itself
 * is covered by supabase/tests/hackathons.test.sql, and the body rules one by
 * one by lib/api/hackathon-snapshot-body.test.ts.
 */
const authenticate = vi.fn();
const afterCallbacks: (() => unknown)[] = [];
const recordChainCheck = vi.fn(async () => {});
vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("next/server", () => ({ after: (callback: () => unknown) => void afterCallbacks.push(callback) }));
vi.mock("@/lib/hackathon/chain-check", () => ({
  recordChainCheck: (...args: unknown[]) => recordChainCheck(...(args as [])),
}));

const { POST } = await import("./route");

const MiB2 = 2 * 1024 * 1024;

type Result = { data: unknown; error: unknown };

function pushed(overrides: Record<string, unknown> = {}): Result {
  return {
    data: {
      id: STORED_SNAPSHOT,
      note_count: 1,
      received_at: "2026-11-20T15:04:06.12+00:00",
      submission_state: "none",
      replay: false,
      ...overrides,
    },
    error: null,
  };
}

const dbError = (code: string, message = "x", hint: string | null = null): Result => ({
  data: null,
  error: { code, message, hint },
});

/**
 * A doqtri admin by default. `doqtri: false` is another OAuth client,
 * `role: null` someone outside the project, `push` the function's answers.
 */
function signedIn(
  options: { doqtri?: boolean | Result; role?: string | null; push?: Result[] } = {},
) {
  const { doqtri = true, role = "admin", push = [] } = options;
  const db = fakeDatabase({
    rpc: {
      is_doqtri_oauth_client: [typeof doqtri === "boolean" ? { data: doqtri, error: null } : doqtri],
      push_doqtri_hackathon_snapshot: push,
    },
    from: { project_members: [{ data: role === null ? null : { role }, error: null }] },
  });
  authenticate.mockResolvedValue({
    supabase: db.client,
    claims: { sub: USER, client_id: CLIENT },
    userId: USER,
    clientId: CLIENT,
  });
  return db;
}

const post = (body: unknown, project = PROJECT, init: Parameters<typeof apiRequest>[1] = {}) =>
  POST(
    apiRequest(`/projects/${project}/hackathon-snapshots`, { method: "POST", body, ...init }),
    params({ id: project }),
  );

const postRaw = (raw: string, init: Parameters<typeof apiRequest>[1] = {}) => post(undefined, PROJECT, { raw, ...init });

const pushRequest = (db: ReturnType<typeof fakeDatabase>) =>
  db.requests.find((r) => r.name === "push_doqtri_hackathon_snapshot");

async function errorOf(response: Response) {
  return (await response.json()).error;
}

beforeEach(() => {
  afterCallbacks.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("POST /api/v1/projects/{id}/hackathon-snapshots: success", () => {
  it("stores a first push: 201 with the contract's shape, and schedules the chain check", async () => {
    const db = signedIn({ push: [pushed()] });
    const raw = JSON.stringify(snapshotBody());

    const response = await postRaw(raw);

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({
      data: {
        id: STORED_SNAPSHOT,
        note_count: 1,
        received_at: "2026-11-20T15:04:06.12+00:00",
        submission_state: "none",
      },
    });

    expect(db.requests.map((r) => r.name)).toEqual([
      "is_doqtri_oauth_client",
      "project_members",
      "push_doqtri_hackathon_snapshot",
    ]);
    expect(db.requests[0].args).toEqual({ p_client_id: CLIENT });
    expect(db.requests[1].calls).toEqual([
      ["select", "role"],
      ["eq", "project_id", PROJECT],
      ["eq", "user_id", USER],
      ["maybeSingle"],
    ]);
    expect(pushRequest(db)?.args).toEqual({
      p_hackathon_slug: "stellar-build-2026",
      p_project_id: PROJECT,
      p_snapshot_id: SNAPSHOT_ID,
      p_workspace_id: WORKSPACE,
      p_payload: snapshotBody(),
      p_payload_sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
      p_note_count: 1,
    });

    // The audit row and the chain check; the check only once the answer is out.
    expect(recordChainCheck).not.toHaveBeenCalled();
    await Promise.all(afterCallbacks.map((callback) => callback()));
    expect(recordChainCheck).toHaveBeenCalledWith(STORED_SNAPSHOT, [
      { doc_id: SNAPSHOT_DOC, markdown: snapshotNote().markdown },
    ]);
  });

  it("answers a replay with 200 and the stored answer, without a second chain check", async () => {
    signedIn({ push: [pushed({ replay: true, submission_state: "submitted_older" })] });

    const response = await post(snapshotBody());

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      id: STORED_SNAPSHOT,
      note_count: 1,
      received_at: "2026-11-20T15:04:06.12+00:00",
      submission_state: "submitted_older",
    });
    await Promise.all(afterCallbacks.map((callback) => callback()));
    expect(recordChainCheck).not.toHaveBeenCalled();
  });

  it("hashes the raw body bytes, not a re-serialization", async () => {
    const db = signedIn({ push: [pushed()] });
    const raw = `{\n  ${JSON.stringify(snapshotBody()).slice(1, -1)}\n}\n`;

    await postRaw(raw);

    const expected = createHash("sha256").update(Buffer.from(raw, "utf8")).digest("hex");
    expect(pushRequest(db)?.args).toMatchObject({ p_payload_sha256: expected });
    expect(expected).not.toBe(createHash("sha256").update(JSON.stringify(snapshotBody())).digest("hex"));
  });

  it("lowercases the ids it passes, and stores the body as sent", async () => {
    const db = signedIn({ push: [pushed()] });
    const body = snapshotBody({ snapshot_id: SNAPSHOT_ID.toUpperCase(), workspace_id: WORKSPACE.toUpperCase() });

    await post(body, PROJECT.toUpperCase());

    expect(pushRequest(db)?.args).toMatchObject({
      p_project_id: PROJECT,
      p_snapshot_id: SNAPSHOT_ID,
      p_workspace_id: WORKSPACE,
      p_payload: body,
    });
  });

  it("does not look inside a note's mindmap for unknown fields", async () => {
    signedIn({ push: [pushed()] });
    const mindmap = { anything: { nested: ["at", { all: true }] }, unknown_key: 1 };

    const response = await post(snapshotBody({ notes: [snapshotNote({ mindmap })] }));

    expect(response.status).toBe(201);
  });

  it("counts characters as code points: a title of 300 emoji is accepted", async () => {
    signedIn({ push: [pushed()] });

    const response = await post(snapshotBody({ notes: [snapshotNote({ title: "\u{1F680}".repeat(300) })] }));

    expect(response.status).toBe(201);
  });

  it("accepts a body of exactly 2 MiB", async () => {
    signedIn({ push: [pushed()] });
    const raw = JSON.stringify(snapshotBody());
    const exact = raw + " ".repeat(MiB2 - Buffer.byteLength(raw));
    expect(Buffer.byteLength(exact)).toBe(MiB2);

    const response = await postRaw(exact);

    expect(response.status).toBe(201);
  });
});

describe("POST /api/v1/projects/{id}/hackathon-snapshots: the check order", () => {
  it("refuses a revoked (or otherwise bad) token with 401, before anything else", async () => {
    authenticate.mockRejectedValue(unauthorized());

    const response = await post(snapshotBody());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    expect((await errorOf(response)).code).toBe("unauthorized");
  });

  it("runs nothing of its own before authentication, which checks revocation (D-59)", async () => {
    const db = signedIn({ push: [pushed()] });
    authenticate.mockRejectedValueOnce(unauthorized());

    const response = await post(snapshotBody());

    expect(response.status).toBe(401);
    expect(db.requests).toEqual([]);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("refuses a token revoked after authentication when the function says so: 401", async () => {
    signedIn({ push: [dbError("42501", "This app's access to qdit was revoked.")] });

    const response = await post(snapshotBody());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
  });

  it("refuses another OAuth client with 403, before the project, the role or the body", async () => {
    const db = signedIn({ doqtri: false });

    const response = await post({ not: "a snapshot" }, "not-a-uuid");

    expect(response.status).toBe(403);
    expect(await errorOf(response)).toEqual({
      code: "forbidden",
      message: "Only doqtri can send hackathon snapshots.",
      details: null,
    });
    expect(db.requests.map((r) => r.name)).toEqual(["is_doqtri_oauth_client"]);
  });

  it("answers 503 when the client check cannot run, never a pass", async () => {
    const db = signedIn({ doqtri: dbError("", "fetch failed") });

    const response = await post(snapshotBody());

    expect(response.status).toBe(503);
    expect(db.requests.map((r) => r.name)).toEqual(["is_doqtri_oauth_client"]);
  });

  it("answers 404 for a project the caller cannot see, before the body", async () => {
    const db = signedIn({ role: null });

    const response = await post({ not: "a snapshot" });

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toEqual({ code: "not_found", message: "No such project.", details: null });
    expect(pushRequest(db)).toBeUndefined();
  });

  it("answers 404 for a malformed project id", async () => {
    const db = signedIn();

    const response = await post(snapshotBody(), "not-a-uuid");

    expect(response.status).toBe(404);
    expect(db.requests.map((r) => r.name)).toEqual(["is_doqtri_oauth_client"]);
  });

  it.each(["viewer", "member"])("answers 403 for a %s, before the body", async (role) => {
    const db = signedIn({ role });

    const response = await post({ not: "a snapshot" });

    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe("forbidden");
    expect(pushRequest(db)).toBeUndefined();
  });

  it("lets an owner push", async () => {
    signedIn({ role: "owner", push: [pushed()] });
    expect((await post(snapshotBody())).status).toBe(201);
  });

  it("answers 403 when the function refuses the role or the client (42501)", async () => {
    signedIn({ push: [dbError("42501", "Only doqtri can send hackathon snapshots.")] });

    const response = await post(snapshotBody());

    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe("forbidden");
  });

  it("answers 404 for an unknown hackathon slug", async () => {
    signedIn({ push: [dbError("P0002", "No such hackathon.")] });

    const response = await post(snapshotBody({ hackathon_slug: "no-such-event" }));

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toEqual({ code: "not_found", message: "No such hackathon.", details: null });
  });

  it("answers 404 when the function no longer sees the project", async () => {
    signedIn({ push: [dbError("P0002", "No such project.")] });

    const response = await post(snapshotBody());

    expect(response.status).toBe(404);
    expect((await errorOf(response)).message).toBe("No such project.");
  });

  it.each(["snapshot_conflict", "snapshot_limit", "hackathon_not_open", "hackathon_closed"])(
    "answers 409 %s",
    async (reason) => {
      signedIn({ push: [dbError("QD409", reason)] });

      const response = await post(snapshotBody());

      expect(response.status).toBe(409);
      expect(await errorOf(response)).toEqual({ code: "conflict", message: expect.any(String), details: { reason } });
    },
  );

  it("answers 500, not a 409 it does not list, for an unknown conflict", async () => {
    signedIn({ push: [dbError("QD409", "doc_linked_elsewhere")] });
    expect((await post(snapshotBody())).status).toBe(500);
  });

  it.each([
    [dbError("22023", "snapshot_id is required.", "snapshot_id"), 400, { snapshot_id: "snapshot_id is required." }],
    [dbError("22023", "payload must be a JSON object with a workspace.", "payload"), 400, { body: "payload must be a JSON object with a workspace." }],
    [dbError("22023", "note_count must be 0 to 200.", "note_count"), 500, undefined],
    [dbError("QD413", "snapshot_too_large"), 400, { body: "is too large to store" }],
    [dbError("PGRST301", "JWT expired"), 401, undefined],
    [dbError("", "fetch failed"), 503, undefined],
    [dbError("XX000", "boom"), 500, undefined],
  ])("maps the function's %j", async (result, status, fields) => {
    signedIn({ push: [result] });

    const response = await post(snapshotBody());

    expect(response.status).toBe(status);
    if (fields) expect((await errorOf(response)).details).toEqual({ fields });
  });
});

describe("POST /api/v1/projects/{id}/hackathon-snapshots: the body (400)", () => {
  async function fieldsFor(response: Response) {
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("invalid_request");
    return error.details.fields;
  }

  it("refuses a body over 2 MiB on `body`, without calling the function", async () => {
    const db = signedIn();
    const raw = JSON.stringify(snapshotBody());

    const response = await postRaw(raw + " ".repeat(MiB2 + 1 - Buffer.byteLength(raw)));

    expect(await fieldsFor(response)).toEqual({ body: "must be at most 2 MiB" });
    expect(pushRequest(db)).toBeUndefined();
  });

  it("refuses a body over 2 MiB even when every field is within its own limit", async () => {
    signedIn();
    // 21 notes of 100,000 bytes each: each within 102,400, together over 2 MiB.
    const notes = Array.from({ length: 21 }, (_, i) =>
      snapshotNote({ doc_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, markdown: "x".repeat(100_000) }),
    );

    const response = await post(snapshotBody({ notes, global_mindmap: { nodes: [], links: [] } }));

    expect(await fieldsFor(response)).toEqual({ body: "must be at most 2 MiB" });
  });

  it("refuses a body that is not JSON", async () => {
    signedIn();
    expect(await fieldsFor(await postRaw("{", {}))).toEqual({ body: "must be valid JSON" });
    signedIn();
    expect(await fieldsFor(await postRaw("{}", { contentType: "text/plain" }))).toEqual({ body: "must be application/json" });
  });

  it("refuses unknown fields at each level, by path", async () => {
    const db = signedIn();
    const body = snapshotBody({
      extra: true,
      notes: [snapshotNote({ colour: "red" })],
      global_mindmap: {
        nodes: [{ id: "n", label: "", kind: "concept", depth: 0, doc_ids: [SNAPSHOT_DOC], weight: 1 }],
        links: [{ source: "n", target: "n", label: "self" }],
        layout: "force",
      },
    });

    expect(await fieldsFor(await post(body))).toEqual({
      extra: "unknown field",
      "notes[0].colour": "unknown field",
      "global_mindmap.layout": "unknown field",
      "global_mindmap.nodes[0].weight": "unknown field",
      "global_mindmap.links[0].label": "unknown field",
    });
    expect(pushRequest(db)).toBeUndefined();
  });

  it("refuses every limit past its edge, each at its own path", async () => {
    signedIn();
    const body = snapshotBody({
      hackathon_slug: "a".repeat(65),
      notes: [
        snapshotNote({
          title: "\u{1F680}".repeat(301),
          markdown: "x".repeat(102_401),
          mindmap: { t: "x".repeat(65_529) },
        }),
      ],
      global_mindmap: {
        nodes: [
          { id: "i".repeat(129), label: "l".repeat(301), kind: "k".repeat(33), depth: -1, doc_ids: [SNAPSHOT_DOC] },
        ],
        links: [],
      },
    });

    expect(await fieldsFor(await post(body))).toEqual({
      hackathon_slug: "must be 1 to 64 of a-z, 0-9 and -",
      "notes[0].title": "must be at most 300 characters",
      "notes[0].markdown": "must be at most 102,400 bytes in UTF-8",
      "notes[0].mindmap": "must be at most 65,536 bytes as JSON",
      "global_mindmap.nodes[0].id": "must be 1 to 128 characters",
      "global_mindmap.nodes[0].label": "must be at most 300 characters",
      "global_mindmap.nodes[0].kind": "must be 1 to 32 characters",
      "global_mindmap.nodes[0].depth": "must be an integer >= 0",
    });
  });

  it("refuses more than 200 notes, 5,000 nodes or 20,000 links on the array", async () => {
    signedIn();
    const notes = Array.from({ length: 201 }, (_, i) =>
      snapshotNote({ doc_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, markdown: "" }),
    );
    const nodes = Array.from({ length: 5_001 }, (_, i) => ({ id: `n${i}`, label: "", kind: "k", depth: 0, doc_ids: [] }));
    const links = Array.from({ length: 20_001 }, () => ({ source: "n0", target: "n0" }));

    expect(await fieldsFor(await post(snapshotBody({ notes, global_mindmap: { nodes, links } })))).toEqual({
      notes: "must hold at most 200 notes",
      "global_mindmap.nodes": "must hold at most 5,000 nodes",
      "global_mindmap.links": "must hold at most 20,000 links",
    });
  });

  it("refuses a lone surrogate sent as a JSON escape, on its field, without calling the function", async () => {
    const db = signedIn();
    const raw = JSON.stringify(snapshotBody()).replace('"title":"Payroll v1 plan"', '"title":"Payroll \\ud800 plan"');
    expect(raw).toContain("\\ud800");

    expect(await fieldsFor(await postRaw(raw))).toEqual({
      "notes[0].title": "must be well-formed Unicode (no lone surrogates)",
    });
    expect(pushRequest(db)).toBeUndefined();
  });

  it("records a __proto__ key as unknown", async () => {
    signedIn();
    const raw = `{"__proto__":{"admin":true},${JSON.stringify(snapshotBody()).slice(1)}`;
    expect(await fieldsFor(await postRaw(raw))).toEqual({ ["__proto__"]: "unknown field" });
  });

  it("counts emoji as one character each: 301 in a title is one too many", async () => {
    signedIn();
    const response = await post(snapshotBody({ notes: [snapshotNote({ title: "\u{1F9E0}".repeat(301) })] }));
    expect(await fieldsFor(response)).toEqual({ "notes[0].title": "must be at most 300 characters" });
  });

  it("refuses missing fields and wrong references", async () => {
    signedIn();
    const body: Record<string, unknown> = snapshotBody({
      notes: [snapshotNote({ source: undefined })],
      global_mindmap: {
        nodes: [{ id: "n", label: "", kind: "k", depth: 0, doc_ids: ["00000000-0000-4000-8000-000000000000"] }],
        links: [{ source: "n", target: "ghost" }],
      },
    });
    delete body.generated_at;
    delete (body.notes as Record<string, unknown>[])[0].source;

    expect(await fieldsFor(await post(body))).toEqual({
      generated_at: "is required",
      "notes[0].source": "is required",
      "global_mindmap.nodes[0].doc_ids[0]": "must be the doc_id of a note in notes",
      "global_mindmap.links[0].target": "must be the id of a node in nodes",
    });
  });
});

describe("POST /api/v1/projects/{id}/hackathon-snapshots: mindmap_url (v1.4.0, QDIT-66)", () => {
  const TOKEN = "Ab3_-xYz0123456789AbCd";

  afterEach(() => {
    delete process.env.DOQTRI_ORIGIN;
  });

  it("stores a body with a link: the link travels in the payload, the arguments are unchanged", async () => {
    const db = signedIn({ push: [pushed()] });
    const body = snapshotBody({ mindmap_url: `https://www.doqtri.xyz/m/${TOKEN}` });
    const raw = JSON.stringify(body);

    const response = await postRaw(raw);

    expect(response.status).toBe(201);
    expect(pushRequest(db)?.args).toEqual({
      p_hackathon_slug: "stellar-build-2026",
      p_project_id: PROJECT,
      p_snapshot_id: SNAPSHOT_ID,
      p_workspace_id: WORKSPACE,
      p_payload: body,
      p_payload_sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
      p_note_count: 1,
    });
  });

  it("follows DOQTRI_ORIGIN", async () => {
    process.env.DOQTRI_ORIGIN = "https://staging.doqtri.xyz";
    signedIn({ push: [pushed()] });
    const response = await post(snapshotBody({ mindmap_url: `https://staging.doqtri.xyz/m/${TOKEN}` }));
    expect(response.status).toBe(201);
  });

  it.each([
    `http://www.doqtri.xyz/m/${TOKEN}`,
    `https://other.example/m/${TOKEN}`,
    `https://www.doqtri.xyz/x/${TOKEN}`,
    "https://www.doqtri.xyz/m/short",
  ])("refuses %s with 400 on mindmap_url and stores nothing", async (url) => {
    const db = signedIn({ push: [pushed()] });

    const response = await post(snapshotBody({ mindmap_url: url }));

    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("invalid_request");
    expect(Object.keys(error.details.fields)).toEqual(["mindmap_url"]);
    expect(pushRequest(db)).toBeUndefined();
  });

  it("does not read DOQTRI_ORIGIN for a body without a link, so a bad setting breaks only links", async () => {
    process.env.DOQTRI_ORIGIN = "not an origin";
    signedIn({ push: [pushed()] });
    expect((await post(snapshotBody())).status).toBe(201);
  });

  it("answers the database's own refusal (its origin differs) as 400 on mindmap_url", async () => {
    signedIn({ push: [dbError("22023", "must be a doqtri mindmap link", "mindmap_url")] });

    const response = await post(snapshotBody({ mindmap_url: `https://www.doqtri.xyz/m/${TOKEN}` }));

    expect(response.status).toBe(400);
    expect((await errorOf(response)).details.fields).toEqual({ mindmap_url: "must be a doqtri mindmap link" });
  });

  it("answers a replay of the same bytes 200, and another link under the same snapshot_id 409", async () => {
    signedIn({ push: [pushed({ replay: true })] });
    const body = snapshotBody({ mindmap_url: `https://www.doqtri.xyz/m/${TOKEN}` });

    expect((await post(body)).status).toBe(200);

    signedIn({ push: [dbError("QD409", "snapshot_conflict")] });
    const other = await post({ ...body, mindmap_url: `https://www.doqtri.xyz/m/${"Z".repeat(30)}` });
    expect(other.status).toBe(409);
    expect((await errorOf(other)).details).toEqual({ reason: "snapshot_conflict" });
  });
});
