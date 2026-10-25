import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unauthorized } from "@/lib/api/errors";
import { apiRequest, CLIENT, DOC, DOC_LINK, params, PROJECT, USER } from "@/test/api-fixtures";
import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `POST /api/v1/projects/{id}/docs` against contract section 8. The database
 * is fake: these check what the route sends `link_project_doc()` and how it
 * answers; the function itself is covered by
 * supabase/tests/integration_links.test.sql.
 */
const authenticate = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { POST } = await import("./route");

const URL_ = `https://www.doqtri.xyz/d/${DOC}`;
const BODY = { doc_id: DOC, doc_title: "Payroll v1 plan", doc_url: URL_ };

function docLinkRow(created: boolean) {
  return {
    id: DOC_LINK,
    project_id: PROJECT,
    doc_id: DOC,
    doc_title: "Payroll v1 plan",
    doc_url: URL_,
    created_at: "2026-10-20T13:58:00+00:00",
    updated_at: "2026-10-20T13:58:00+00:00",
    created,
  };
}

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

const post = (body: unknown, project = PROJECT, init: Parameters<typeof apiRequest>[1] = {}) =>
  POST(apiRequest(`/projects/${project}/docs`, { method: "POST", body, ...init }), params({ id: project }));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://qdit.atalusan.com";
  delete process.env.DOQTRI_ORIGIN;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete process.env.DOQTRI_ORIGIN;
});

describe("POST /api/v1/projects/{id}/docs", () => {
  it("links a new doc: 201 with the DocLink shape", async () => {
    const db = signedIn({ rpc: { link_project_doc: [{ data: [docLinkRow(true)], error: null }] } });

    const response = await post({ ...BODY, doc_title: "  Payroll v1 plan  " });

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body = await response.json();
    expect(body).toEqual({
      data: {
        id: DOC_LINK,
        project_id: PROJECT,
        doc_id: DOC,
        doc_title: "Payroll v1 plan",
        doc_url: URL_,
        created_at: "2026-10-20T13:58:00+00:00",
        updated_at: "2026-10-20T13:58:00+00:00",
      },
    });
    expect(db.requests).toEqual([
      {
        kind: "rpc",
        name: "link_project_doc",
        args: { p_project_id: PROJECT, p_doc_id: DOC, p_doc_title: "Payroll v1 plan", p_doc_url: URL_ },
        calls: [],
      },
    ]);
  });

  it("answers 200 when the doc was already linked here (a refresh)", async () => {
    signedIn({ rpc: { link_project_doc: [{ data: [docLinkRow(false)], error: null }] } });

    const response = await post(BODY);

    expect(response.status).toBe(200);
    expect((await response.json()).data.id).toBe(DOC_LINK);
  });

  it("lowercases ids before they reach the database", async () => {
    const db = signedIn({ rpc: { link_project_doc: [{ data: [docLinkRow(true)], error: null }] } });

    await post({ ...BODY, doc_id: DOC.toUpperCase() }, PROJECT.toUpperCase());

    expect(db.requests[0].args).toMatchObject({ p_project_id: PROJECT, p_doc_id: DOC });
  });

  it("answers 409 doc_linked_elsewhere when another project holds the doc", async () => {
    signedIn({
      rpc: { link_project_doc: [{ data: null, error: { code: "QD409", message: "doc_linked_elsewhere", hint: null } }] },
    });

    const response = await post(BODY);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toEqual({
      code: "conflict",
      message: expect.any(String),
      details: { reason: "doc_linked_elsewhere" },
    });
  });

  it("answers 403 below admin and 404 outside the project", async () => {
    signedIn({ rpc: { link_project_doc: [{ data: null, error: { code: "42501", message: "role" } }] } });
    const forbidden = await post(BODY);
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe("forbidden");

    signedIn({ rpc: { link_project_doc: [{ data: null, error: { code: "P0002", message: "No such project." } }] } });
    const missing = await post(BODY);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toEqual({ code: "not_found", message: "No such project.", details: null });
  });

  it("treats a malformed project id as an unknown id, without asking the database", async () => {
    const db = signedIn();

    const response = await post(BODY, "not-a-uuid");

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
    expect(db.requests).toEqual([]);
  });

  it.each([
    [{ doc_title: "T", doc_url: URL_ }, ["doc_id"]],
    [{ ...BODY, doc_id: "c2d1e0f9" }, ["doc_id"]],
    [{ ...BODY, doc_title: "   " }, ["doc_title"]],
    [{ ...BODY, doc_title: "x".repeat(301) }, ["doc_title"]],
    [{ ...BODY, doc_title: 7 }, ["doc_title"]],
    [{ ...BODY, doc_url: "http://www.doqtri.xyz/d/1" }, ["doc_url"]],
    [{ ...BODY, doc_url: "javascript:alert(1)" }, ["doc_url"]],
    [{ ...BODY, doc_url: `https://www.doqtri.xyz/${"a".repeat(2048)}` }, ["doc_url"]],
    // D-45: https is not enough, it has to be doqtri's origin.
    [{ ...BODY, doc_url: "https://evil.example/d/1" }, ["doc_url"]],
    [{ ...BODY, doc_url: "https://www.doqtri.xyz.evil.example/d/1" }, ["doc_url"]],
    [{ ...BODY, doc_url: "https://www.doqtri.xyz@evil.example/d/1" }, ["doc_url"]],
    [{ ...BODY, doc_url: "https://doqtri.xyz/d/1" }, ["doc_url"]],
    // Contract v1.0.3: the origin followed by `/`, not the bare origin.
    [{ ...BODY, doc_url: "https://www.doqtri.xyz" }, ["doc_url"]],
    [{ ...BODY, doc_url: "https://www.doqtri.xyz?d=1" }, ["doc_url"]],
    [{ ...BODY, doc_url: "https://www.doqtri.xyz#d1" }, ["doc_url"]],
    [{ ...BODY, project_id: PROJECT }, ["project_id"]],
    [{}, ["doc_id", "doc_title", "doc_url"]],
  ])("rejects %j as 400 invalid_request naming %j", async (body, fields) => {
    const db = signedIn();

    const response = await post(body);

    expect(response.status).toBe(400);
    const error = (await response.json()).error;
    expect(error.code).toBe("invalid_request");
    expect(Object.keys(error.details.fields).sort()).toEqual([...fields].sort());
    expect(db.requests).toEqual([]);
  });

  it("names doqtri's origin when it refuses a doc_url off it (D-45)", async () => {
    const db = signedIn();

    const response = await post({ ...BODY, doc_url: "https://evil.example/d/1" });

    expect(response.status).toBe(400);
    expect((await response.json()).error.details.fields).toEqual({
      doc_url: "must be a doqtri URL starting with https://www.doqtri.xyz/",
    });
    expect(db.requests).toEqual([]);
  });

  it("follows DOQTRI_ORIGIN", async () => {
    process.env.DOQTRI_ORIGIN = "https://staging.doqtri.xyz/";
    const staging = `https://staging.doqtri.xyz/d/${DOC}`;
    const db = signedIn({
      rpc: { link_project_doc: [{ data: [{ ...docLinkRow(true), doc_url: staging }], error: null }] },
    });

    expect((await post(BODY)).status).toBe(400);

    const response = await post({ ...BODY, doc_url: staging });
    expect(response.status).toBe(201);
    expect(db.requests.map((r) => (r.args as { p_doc_url: string }).p_doc_url)).toEqual([staging]);
  });

  it("answers the database's origin refusal as 400 on doc_url, and warns that the origins differ (D-95)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refusal = {
      code: "22023",
      message: "must be a doqtri URL starting with https://doqtri.xyz/",
      hint: "doc_url",
    };
    signedIn({ rpc: { link_project_doc: [{ data: null, error: refusal }] } });

    const response = await post(BODY);

    expect(response.status).toBe(400);
    const error = (await response.json()).error;
    expect(error.code).toBe("invalid_request");
    expect(error.details.fields).toEqual({ doc_url: "must be a doqtri URL starting with https://doqtri.xyz/" });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(/integration_settings\.doqtri_origin refused/);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("answers another 22023 as 500, not as a doc_url problem", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn({ rpc: { link_project_doc: [{ data: null, error: { code: "22023", message: "boom", hint: null } }] } });

    const response = await post(BODY);

    expect(response.status).toBe(500);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("answers 500 without touching the database when DOQTRI_ORIGIN is not an https origin", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DOQTRI_ORIGIN = "http://www.doqtri.xyz";
    const db = signedIn();

    const response = await post(BODY);

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal_error");
    expect(db.requests).toEqual([]);
  });

  it.each([
    ["no content type", { body: BODY, contentType: null }],
    ["text/plain", { body: BODY, contentType: "text/plain" }],
    ["malformed JSON", { raw: "{\"doc_id\": " }],
    ["an array", { body: [BODY] }],
    ["a body over 64 KiB", { body: { ...BODY, doc_title: "x".repeat(70_000) } }],
  ])("rejects %s as 400 invalid_request on `body`", async (_label, init) => {
    signedIn();

    const response = await POST(
      apiRequest(`/projects/${PROJECT}/docs`, { method: "POST", ...init }),
      params({ id: PROJECT }),
    );

    expect(response.status).toBe(400);
    const error = (await response.json()).error;
    expect(error.code).toBe("invalid_request");
    expect(Object.keys(error.details.fields)).toEqual(["body"]);
  });

  it("refuses a request without a valid OAuth token", async () => {
    authenticate.mockRejectedValue(unauthorized());

    const response = await post(BODY);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    expect((await response.json()).error.code).toBe("unauthorized");
  });

  it("maps an unexpected database error to internal_error without leaking it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedIn({ rpc: { link_project_doc: [{ data: null, error: { code: "XX000", message: "secret detail" } }] } });

    const response = await post(BODY);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
