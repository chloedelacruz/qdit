import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_FILTERS } from "@/lib/filters";
import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `listMilestones` gives a linked milestone what its doc card needs (WP-2.6):
 * the heading, the doc version, and the doc link as far as the viewer can
 * read it. A link whose doc link RLS hides comes back with `doc: null`, the
 * no-access state, and the link row's own copy of the title is not carried
 * into it.
 */
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: async () => null,
}));

const { listMilestones } = await import("./queries");

const DOC = "c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f";

function milestone(link: unknown) {
  return {
    id: "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61",
    project_id: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34",
    title: "Escrow contract",
    description: null,
    status: "submitted",
    due_date: null,
    order_index: 0,
    projects: { name: "Payroll", slug: "payroll", chain_contract_id: null, public_proofs: false },
    tasks: [{ count: 0 }],
    done: [{ count: 0 }],
    stellar_proofs: [],
    milestone_anchors: [],
    milestone_reviews: [],
    milestone_external_links: link,
  };
}

function external(docLink: unknown) {
  return {
    doc_id: DOC,
    node_id: "h4",
    node_label: "Escrow contract",
    doc_version: 7,
    // The copy the link row keeps; never used by the card.
    doc_title: "Payroll v1 plan",
    project_doc_links: docLink,
  };
}

function database(rows: unknown[]) {
  const db = fakeDatabase({
    from: {
      profiles: [{ data: [], error: null }],
      milestones: [
        { data: null, error: null, count: rows.length },
        { data: rows, error: null, count: rows.length },
      ],
    },
  });
  createClient.mockResolvedValue(db.client);
  return db;
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.DOQTRI_ORIGIN;
});

describe("listMilestones: the doqtri link", () => {
  it("embeds the doc link and its connections through the milestone link", async () => {
    const db = database([]);

    await listMilestones({}, EMPTY_FILTERS);

    const select = String(db.requests[2].calls.find(([method]) => method === "select")?.[1]);
    expect(select.replace(/\s+/g, " ")).toContain(
      "milestone_external_links( doc_id, node_id, node_label, doc_version, project_doc_links(doc_title, doc_url, doc_link_connections(lost_at, lost_reason)) )",
    );
  });

  it("loaded: the doc link is readable and a connection is live", async () => {
    database([
      milestone(
        external({
          doc_title: "Payroll v1 plan",
          doc_url: `https://www.doqtri.xyz/d/${DOC}`,
          doc_link_connections: [{ lost_at: null, lost_reason: null }],
        }),
      ),
    ]);

    const { rows } = await listMilestones({}, EMPTY_FILTERS);

    expect(rows[0].link).toEqual({
      docId: DOC,
      nodeId: "h4",
      nodeLabel: "Escrow contract",
      docVersion: 7,
      doc: {
        title: "Payroll v1 plan",
        url: `https://www.doqtri.xyz/d/${DOC}`,
        host: "www.doqtri.xyz",
        connection: { live: true },
      },
    });
  });

  it("not-connected: the doc link is readable but no connection is live", async () => {
    database([
      milestone([
        external({
          doc_title: "Payroll v1 plan",
          doc_url: "https://evil.example/d/1",
          doc_link_connections: [{ lost_at: "2026-10-25T09:00:00Z", lost_reason: "left_project" }],
        }),
      ]),
    ]);

    const { rows } = await listMilestones({}, EMPTY_FILTERS);

    expect(rows[0].link?.doc).toEqual({
      title: "Payroll v1 plan",
      // Off doqtri's origin (D-45): kept as text, never as a link.
      url: null,
      host: "",
      connection: { live: false, reason: "left_project" },
    });
  });

  it("no-access: the link row is readable, its doc link is not", async () => {
    database([milestone(external(null))]);

    const { rows } = await listMilestones({}, EMPTY_FILTERS);

    expect(rows[0].link).toEqual({
      docId: DOC,
      nodeId: "h4",
      nodeLabel: "Escrow contract",
      docVersion: 7,
      doc: null,
    });
    expect(JSON.stringify(rows[0].link)).not.toContain("Payroll v1 plan");
  });

  it("an unlinked milestone has no link", async () => {
    database([milestone(null)]);

    const { rows } = await listMilestones({}, EMPTY_FILTERS);

    expect(rows[0].link).toBeNull();
  });
});
