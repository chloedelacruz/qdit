import { describe, expect, it } from "vitest";

import { snapshotFacts } from "@/lib/hackathon/snapshot-facts";
import type {
  DoqtriSnapshotNote,
  DoqtriSnapshotV1,
  QditSnapshotTask,
  QditSnapshotV1,
} from "@/lib/hackathon/types";

const WINDOW = { opens_at: "2026-11-20T09:00:00.000Z", closes_at: "2026-11-21T17:00:00.000Z" };
const DURING = "2026-11-20T12:00:00.000Z";

function task(id: string, overrides: Partial<QditSnapshotTask> = {}): QditSnapshotTask {
  return {
    id,
    milestone_id: null,
    title: id,
    description: null,
    status: "todo",
    assignee_id: null,
    priority: "medium",
    due_date: null,
    created_at: DURING,
    updated_at: DURING,
    ...overrides,
  };
}

function note(id: string, overrides: Partial<DoqtriSnapshotNote> = {}): DoqtriSnapshotNote {
  return {
    doc_id: id,
    title: id,
    markdown: "",
    mindmap: null,
    created_at: DURING,
    updated_at: DURING,
    version: null,
    source: "editor",
    ...overrides,
  };
}

const snapshot: QditSnapshotV1 = {
  schema_version: 1,
  captured_at: "2026-11-21T16:00:00.000Z",
  truncated: false,
  project: {
    id: "p1",
    slug: "team",
    name: "Team",
    description: null,
    status: "active",
    repo_url: null,
    demo_url: null,
    docs_url: null,
    created_at: DURING,
    chain_contract_id: "CABC",
    public_proofs: true,
  },
  members: [
    { user_id: "u1", role: "owner", joined_at: DURING, username: "ana", display_name: null, wallet_address: null },
    { user_id: "u2", role: "member", joined_at: DURING, username: "ben", display_name: null, wallet_address: null },
  ],
  milestones: [
    { id: "m1", title: "M1", description: null, status: "approved", due_date: null, order_index: 0, created_at: DURING, updated_at: DURING },
    { id: "m2", title: "M2", description: null, status: "submitted", due_date: null, order_index: 1, created_at: DURING, updated_at: DURING },
  ],
  tasks: [
    task("t1", { assignee_id: "u1", due_date: "2026-11-20", status: "in_progress", priority: "high" }),
    task("t2", { assignee_id: "u1", due_date: "2026-11-20", status: "done" }),
    task("t3", { assignee_id: "u2", due_date: "2026-11-21" }),
    task("t4", { assignee_id: "ghost" }),
    task("t5"),
  ],
  milestone_reviews: [
    { id: "r1", milestone_id: "m1", from_status: "submitted", to_status: "approved", reason: null, reviewer_id: "u1", created_at: DURING },
  ],
  milestone_anchors: [
    { id: "a1", milestone_id: "m1", action: "submit", proof_hash: "h", version: 1, contract_id: "CABC", network: "testnet", tx_hash: "x1", signer_address: "G", ledger: 1, created_at: DURING },
    { id: "a2", milestone_id: "m1", action: "approve", proof_hash: "h", version: 1, contract_id: "CABC", network: "testnet", tx_hash: "x2", signer_address: "G", ledger: 2, created_at: DURING },
  ],
  stellar_proofs: [],
  deployments: [],
  doc_links: [{ doc_id: "n1", doc_title: "N1", doc_url: "https://doqtri.example/vault/n1" }],
  milestone_links: [{ milestone_id: "m1", doc_id: "n1", node_id: "h0", node_label: "Solutions", doc_version: null }],
};

const doqtri: DoqtriSnapshotV1 = {
  hackathon_slug: "hack",
  snapshot_id: "s1",
  workspace_id: "w1",
  generated_at: DURING,
  notes: [
    note("n1"),
    note("n2"),
    note("n3", { source: "template" }),
    note("n4", { created_at: "2026-11-19T00:00:00.000Z" }),
    note("n5", { source: null }),
  ],
  global_mindmap: {
    nodes: [
      { id: "c1", label: "c1", kind: "concept", depth: 1, doc_ids: ["n1", "n2", "n3"] },
      { id: "c2", label: "c2", kind: "concept", depth: 1, doc_ids: ["n5"] },
    ],
    links: [],
  },
};

describe("snapshotFacts", () => {
  const facts = snapshotFacts(snapshot, doqtri, WINDOW);

  it("counts tasks", () => {
    expect(facts.tasks).toEqual({
      total: 5,
      by_status: { todo: 3, in_progress: 1, done: 1 },
      by_priority: { low: 0, medium: 4, high: 1, urgent: 0 },
      by_assignee: [
        { user_id: "u1", username: "ana", count: 2 },
        { user_id: "u2", username: "ben", count: 1 },
        { user_id: "ghost", username: null, count: 1 },
      ],
      unassigned: 1,
      fully_specified: 3,
      // t1 is due the day before captured_at and not done; t2 is done; t3 is due that day.
      overdue: 1,
    });
  });

  it("counts milestones and the proof chain", () => {
    expect(facts.milestones).toEqual({
      total: 2,
      by_status: { proposed: 0, submitted: 1, approved: 1, rejected: 0 },
      approved: 1,
      linked_to_doc_nodes: 1,
    });
    expect(facts.proof_chain).toEqual({
      anchors: 2,
      anchors_by_action: { submit: 1, approve: 1, reject: 0 },
      reviews: 1,
      stellar_proofs: 0,
      deployments: 0,
      registered_on_chain: true,
    });
    expect(facts.doc_links).toBe(1);
  });

  it("counts doqtri notes and the global mindmap", () => {
    expect(facts.doqtri).toEqual({
      notes: 5,
      notes_created_during_event: 4,
      qualifying_notes: 3,
      notes_by_source: { editor: 3, template: 1, import: 0, unknown: 1 },
      global_mindmap_nodes: 2,
      global_mindmap_links: 0,
      largest_connected_qualifying_notes: 2,
    });
  });

  it("is null for doqtri when no snapshot arrived", () => {
    expect(snapshotFacts(snapshot, null, WINDOW).doqtri).toBeNull();
  });

  it("round-trips through JSON unchanged", () => {
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
  });
});
