import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `listPlanDocs` hands the "Plan docs" row a `url` only when it is on doqtri's
 * origin (D-45). The API refuses any other `doc_url`, but the table only holds
 * it to https, so a row written through PostgREST, or before DOQTRI_ORIGIN
 * changed, can still hold one. Such a row is listed without a link.
 */
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: async () => null,
}));

const { listPlanDocs } = await import("./queries");

const PROJECT = "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34";

function row(id: string, docUrl: string) {
  return {
    id,
    doc_id: `c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9${id}`,
    doc_title: `Plan ${id}`,
    doc_url: docUrl,
    created_at: "2026-10-20T13:58:00+00:00",
    milestone_external_links: [{ count: 2 }],
  };
}

function database(rows: ReturnType<typeof row>[]) {
  const db = fakeDatabase({ from: { project_doc_links: [{ data: rows, error: null }] } });
  createClient.mockResolvedValue(db.client);
  return db;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete process.env.DOQTRI_ORIGIN;
});

describe("listPlanDocs", () => {
  it("keeps the url and host of a doc on doqtri's origin, and drops any other", async () => {
    database([
      row("1", "https://www.doqtri.xyz/d/1"),
      row("2", "https://www.doqtri.xyz.evil.example/d/2"),
      row("3", "https://evil.example/d/3"),
    ]);

    const docs = await listPlanDocs(PROJECT);

    expect(docs.map(({ id, url, host, milestoneCount }) => ({ id, url, host, milestoneCount }))).toEqual([
      { id: "1", url: "https://www.doqtri.xyz/d/1", host: "www.doqtri.xyz", milestoneCount: 2 },
      { id: "2", url: null, host: "", milestoneCount: 2 },
      { id: "3", url: null, host: "", milestoneCount: 2 },
    ]);
  });

  it("follows DOQTRI_ORIGIN", async () => {
    process.env.DOQTRI_ORIGIN = "https://staging.doqtri.xyz";
    database([row("1", "https://www.doqtri.xyz/d/1"), row("2", "https://staging.doqtri.xyz/d/2")]);

    const docs = await listPlanDocs(PROJECT);

    expect(docs.map((doc) => doc.url)).toEqual([null, "https://staging.doqtri.xyz/d/2"]);
  });

  it("lists every doc without a link when DOQTRI_ORIGIN is misconfigured", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DOQTRI_ORIGIN = "https://www.doqtri.xyz/d";
    database([row("1", "https://www.doqtri.xyz/d/1")]);

    const docs = await listPlanDocs(PROJECT);

    expect(docs.map((doc) => [doc.title, doc.url])).toEqual([["Plan 1", null]]);
    expect(logged).toHaveBeenCalledOnce();
  });
});
