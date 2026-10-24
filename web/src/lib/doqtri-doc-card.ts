/**
 * What the doqtri doc card shows, and which of its three states it is in
 * (WP-2.6). Pure, so every rule below is unit tested directly; the queries
 * that feed it are in `lib/queries.ts` and the card is
 * `components/doqtri-doc-card.tsx`.
 *
 * qdit is the OAuth provider and holds no token for doqtri (D-02), so the
 * card never asks doqtri anything. It is built from qdit's own rows, read
 * with the viewer's session, so qdit's RLS decides what it may show:
 *
 *   milestone_external_links   the milestone's link: node id, node label,
 *                              doc version (and a copy of the doc title that
 *                              the card deliberately does not use)
 *   project_doc_links          the doc link: title and URL
 *   doc_link_connections       which (user, app) pairs keep it linked
 *   milestone_anchors          the proof state, as the milestone row has it
 *
 * The states, exactly as they are detected:
 *
 *   no-access      the viewer can read the milestone's link row but not the
 *                  doc link it points at (the embedded `project_doc_links` is
 *                  null under RLS). The card says a plan is linked and shows
 *                  nothing about it — not the title, not the copy of it on
 *                  the link row, not the node or version. Under today's
 *                  policies both rows are readable by the same viewers, so
 *                  this is the state a narrower read policy would produce,
 *                  and the one the card falls to when the two disagree.
 *   not-connected  the doc link is readable, but none of its
 *                  `doc_link_connections` rows is live: everyone whose app
 *                  wrote it revoked doqtri, left the project or deleted
 *                  their account, or it was never written through doqtri at
 *                  all. The stored copies are shown read-only, marked
 *                  "Connection to doqtri lost", because nothing will refresh
 *                  them.
 *   loaded         the doc link is readable and at least one connection is
 *                  live.
 *
 * Whether the viewer may open the doc in doqtri is doqtri's to decide (its
 * own workspace roles, D-14/D-15) and qdit cannot see it. "Open in doqtri"
 * is offered only for a `doc_url` on doqtri's origin (D-45); doqtri answers
 * anyone else with its own sign-in or no-access page.
 */

import type { StellarNetwork } from "@/lib/stellar";

/** Why a doc link has no live connection. */
export type ConnectionLoss =
  /** The last connection's user revoked doqtri in qdit's Settings. */
  | "revoked"
  /** The last connection's user is no longer in the project. */
  | "left_project"
  /**
   * No connection row at all: every one went with a deleted account, or the
   * doc was linked from a qdit session rather than through doqtri.
   */
  | "unknown";

export type DocConnection = { live: true } | { live: false; reason: ConnectionLoss };

/** A `doc_link_connections` row as the card's queries select it. */
export type ConnectionRecord = {
  lost_at: string | null;
  lost_reason: "revoked" | "left_project" | null;
};

/**
 * Live when any row is; otherwise lost, for the reason of the row lost most
 * recently, since that is the one that took the doc link's last connection.
 */
export function connectionOf(rows: readonly ConnectionRecord[] | null | undefined): DocConnection {
  const list = rows ?? [];
  if (list.some((row) => row.lost_at === null)) return { live: true };

  const newest = [...list].sort((a, b) => (b.lost_at ?? "").localeCompare(a.lost_at ?? ""))[0];
  return { live: false, reason: newest?.lost_reason ?? "unknown" };
}

/** The doc link, as far as the viewer can read it. */
export type LinkedDoc = {
  title: string;
  /** `doc_url` when it is on doqtri's origin (D-45), else null. */
  url: string | null;
  /** The host `url` opens, or `""`. */
  host: string;
  connection: DocConnection;
};

/** The proof state the card shows, when qdit has one. */
export type DocCardProof =
  | {
      kind: "milestone";
      /** The newest anchor, or null when the milestone was never anchored. */
      anchor: {
        action: "submit" | "approve" | "reject";
        version: number;
        txHash: string;
        network: StellarNetwork;
      } | null;
      /** The milestone changed after it was anchored. */
      stale: boolean;
    }
  | {
      kind: "doc";
      /** Linked milestones with at least one anchor. */
      anchored: number;
      /** Linked milestones in all. */
      total: number;
    };

export type DocCardData =
  | {
      state: "loaded" | "not-connected";
      title: string;
      url: string | null;
      host: string;
      /** The heading's label and positional id; null on the doc's own card. */
      node: { id: string; label: string } | null;
      /** DoqtriRegistry `Document.version`, or null when not anchored then. */
      docVersion: number | null;
      proof: DocCardProof;
      /** Set in the not-connected state. */
      loss: ConnectionLoss | null;
    }
  | { state: "no-access" };

/** The milestone's link, as `toMilestone` builds it. */
export type MilestoneDocLink = {
  nodeId: string;
  nodeLabel: string;
  docVersion: number | null;
  /** Null when the viewer cannot read the doc link (no-access). */
  doc: LinkedDoc | null;
};

function fromDoc(doc: LinkedDoc) {
  return {
    state: doc.connection.live ? ("loaded" as const) : ("not-connected" as const),
    title: doc.title,
    url: doc.url,
    host: doc.host,
    loss: doc.connection.live ? null : doc.connection.reason,
  };
}

/** The card on a milestone that came from doqtri. */
export function milestoneDocCard(
  link: MilestoneDocLink,
  anchor: Extract<DocCardProof, { kind: "milestone" }>["anchor"],
  stale: boolean,
): DocCardData {
  if (!link.doc) return { state: "no-access" };

  return {
    ...fromDoc(link.doc),
    node: { id: link.nodeId, label: link.nodeLabel },
    docVersion: link.docVersion,
    proof: { kind: "milestone", anchor, stale: anchor ? stale : false },
  };
}

/** The card for one entry of a project's Plan docs list. */
export function planDocCard(doc: LinkedDoc & {
  milestoneCount: number;
  anchoredCount: number;
  /** The newest `doc_version` any of its milestone links was written against. */
  docVersion: number | null;
}): DocCardData {
  return {
    ...fromDoc(doc),
    node: null,
    docVersion: doc.docVersion,
    proof: { kind: "doc", anchored: doc.anchoredCount, total: doc.milestoneCount },
  };
}

/** The sentence under "Connection to doqtri lost". */
export const LOSS_TEXT: Record<ConnectionLoss, string> = {
  revoked: "The doqtri connection that kept this plan linked was disconnected in qdit.",
  left_project: "The person whose doqtri connection kept this plan linked left the project.",
  unknown: "No doqtri connection keeps this plan linked any more.",
};
