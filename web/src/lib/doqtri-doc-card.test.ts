import { describe, expect, it } from "vitest";

import {
  connectionOf,
  milestoneDocCard,
  planDocCard,
  type LinkedDoc,
  type MilestoneDocLink,
} from "./doqtri-doc-card";

/**
 * The doc card's three states (WP-2.6), from the rows qdit itself holds:
 * no-access when the viewer cannot read the doc link, not-connected when no
 * doqtri connection keeps it, loaded otherwise.
 */

const LIVE = { lost_at: null, lost_reason: null };
const REVOKED = { lost_at: "2026-10-25T09:00:00Z", lost_reason: "revoked" as const };
const LEFT = { lost_at: "2026-10-25T10:00:00Z", lost_reason: "left_project" as const };

function doc(connection: LinkedDoc["connection"]): LinkedDoc {
  return {
    title: "Payroll v1 plan",
    url: "https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
    host: "www.doqtri.xyz",
    connection,
  };
}

function link(linked: LinkedDoc | null): MilestoneDocLink {
  return { nodeId: "h4", nodeLabel: "Escrow contract", docVersion: 7, doc: linked };
}

const ANCHOR = {
  action: "submit" as const,
  version: 2,
  txHash: "5e1f0c3a9b7d2e4f6a8c0b1d3e5f7a9c2b4d6e8f0a1c3e5b7d9f1a3c5e7b9d0f",
  network: "testnet" as const,
};

describe("connectionOf", () => {
  it("is live while any connection is", () => {
    expect(connectionOf([REVOKED, LIVE])).toEqual({ live: true });
  });

  it("is lost for the reason of the connection lost last", () => {
    expect(connectionOf([LEFT, REVOKED])).toEqual({ live: false, reason: "left_project" });
    expect(connectionOf([REVOKED])).toEqual({ live: false, reason: "revoked" });
  });

  it("is lost for an unknown reason when there is no connection at all", () => {
    expect(connectionOf([])).toEqual({ live: false, reason: "unknown" });
    expect(connectionOf(null)).toEqual({ live: false, reason: "unknown" });
  });
});

describe("milestoneDocCard", () => {
  it("loaded: the doc, the heading, the version and the proof", () => {
    expect(milestoneDocCard(link(doc({ live: true })), ANCHOR, true)).toEqual({
      state: "loaded",
      title: "Payroll v1 plan",
      url: "https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
      host: "www.doqtri.xyz",
      node: { id: "h4", label: "Escrow contract" },
      docVersion: 7,
      proof: { kind: "milestone", anchor: ANCHOR, stale: true },
      loss: null,
    });
  });

  it("not-connected: the same stored data, with why the connection went", () => {
    const card = milestoneDocCard(link(doc({ live: false, reason: "revoked" })), null, false);
    expect(card).toMatchObject({
      state: "not-connected",
      title: "Payroll v1 plan",
      node: { id: "h4", label: "Escrow contract" },
      docVersion: 7,
      proof: { kind: "milestone", anchor: null, stale: false },
      loss: "revoked",
    });
  });

  it("no-access: nothing about the doc at all", () => {
    expect(milestoneDocCard(link(null), ANCHOR, false)).toEqual({ state: "no-access" });
  });

  it("is never stale without an anchor", () => {
    const card = milestoneDocCard(link(doc({ live: true })), null, true);
    expect(card.state !== "no-access" && card.proof).toEqual({ kind: "milestone", anchor: null, stale: false });
  });
});

describe("planDocCard", () => {
  it("summarises the doc's milestones and keeps its connection state", () => {
    expect(
      planDocCard({ ...doc({ live: false, reason: "unknown" }), milestoneCount: 3, anchoredCount: 1, docVersion: 8 }),
    ).toEqual({
      state: "not-connected",
      title: "Payroll v1 plan",
      url: "https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
      host: "www.doqtri.xyz",
      node: null,
      docVersion: 8,
      proof: { kind: "doc", anchored: 1, total: 3 },
      loss: "unknown",
    });
  });
});
