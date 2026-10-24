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
    doc_link_connections: [{ lost_at: null, lost_reason: null }],
    milestone_external_links: [
      { doc_version: 7, milestones: { milestone_anchors: [{ count: 1 }] } },
      { doc_version: null, milestones: { milestone_anchors: [{ count: 0 }] } },
    ],
  };
}

type Row = Omit<ReturnType<typeof row>, "doc_link_connections" | "milestone_external_links"> & {
  doc_link_connections: { lost_at: string | null; lost_reason: string | null }[];
  milestone_external_links: {
    doc_version: number | null;
    milestones: { milestone_anchors: { count: number }[] } | null;
  }[];
};

function database(rows: Row[]) {
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

describe("listPlanDocs for the doc card (WP-2.6)", () => {
  it("asks for the doc's connections and its milestones' anchors", async () => {
    const db = database([row("1", "https://www.doqtri.xyz/d/1")]);

    await listPlanDocs(PROJECT);

    const select = String(db.requests[0].calls.find(([method]) => method === "select")?.[1]);
    expect(select).toContain("doc_link_connections(lost_at, lost_reason)");
    expect(select).toContain("milestone_external_links(doc_version, milestones(milestone_anchors(count)))");
  });

  it("counts anchored milestones and keeps the newest doc version", async () => {
    database([
      {
        ...row("1", "https://www.doqtri.xyz/d/1"),
        milestone_external_links: [
          { doc_version: 7, milestones: { milestone_anchors: [{ count: 2 }] } },
          { doc_version: 9, milestones: { milestone_anchors: [{ count: 0 }] } },
          { doc_version: null, milestones: null },
        ],
      },
      { ...row("2", "https://www.doqtri.xyz/d/2"), milestone_external_links: [] },
    ]);

    const docs = await listPlanDocs(PROJECT);

    expect(docs.map(({ milestoneCount, anchoredCount, docVersion }) => ({ milestoneCount, anchoredCount, docVersion }))).toEqual([
      { milestoneCount: 3, anchoredCount: 1, docVersion: 9 },
      { milestoneCount: 0, anchoredCount: 0, docVersion: null },
    ]);
  });

  it("is connected while a connection is live, and lost when none is", async () => {
    database([
      row("1", "https://www.doqtri.xyz/d/1"),
      {
        ...row("2", "https://www.doqtri.xyz/d/2"),
        doc_link_connections: [{ lost_at: "2026-10-25T09:00:00Z", lost_reason: "revoked" }],
      },
      { ...row("3", "https://www.doqtri.xyz/d/3"), doc_link_connections: [] },
    ]);

    const docs = await listPlanDocs(PROJECT);

    expect(docs.map((doc) => doc.connection)).toEqual([
      { live: true },
      { live: false, reason: "revoked" },
      { live: false, reason: "unknown" },
    ]);
  });
});
