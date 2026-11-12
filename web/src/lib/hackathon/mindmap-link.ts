import { doqtriOrigin, isDoqtriMindmapUrl } from "@/lib/doqtri-origin";

/**
 * Which stored Mindmap links qdit renders or exports (WP-4.7, QDIT-66).
 *
 * A version's `mindmap_url` passed the column's shape check and, through the
 * submit dialog, `DOQTRI_ORIGIN`. The database checks the origin only once
 * `integration_settings.doqtri_origin` is set (D-95), so a link stored by a
 * hand-written call while it was unset, or before the origin moved, is
 * checked again here, the way the "Plan docs" row checks a `doc_url`
 * (`lib/queries.ts`). A link that fails is shown as no link.
 *
 * Server-only by convention, like `DOQTRI_ORIGIN`. A misconfigured origin
 * shows no links and logs, rather than failing the page.
 */
export function mindmapLink(
  url: string | null | undefined,
  value: string | undefined = process.env.DOQTRI_ORIGIN,
): string | null {
  if (!url) return null;
  let origin: string;
  try {
    origin = doqtriOrigin(value);
  } catch (error) {
    console.error("hackathon mindmap link:", error);
    return null;
  }
  return isDoqtriMindmapUrl(url, origin) ? url : null;
}

/**
 * Whether doqtri still serves a link (QDIT-67, contract v1.5.0): `dead`
 * when it answered `live: false` (revoked, expired or never issued),
 * `unknown` when it did not answer. Unknown is treated as live everywhere.
 * `lib/hackathon/mindmap-link-status.ts` asks.
 */
export type MindmapLinkStatus = "live" | "dead" | "unknown";

/** Shown in place of Open mindmap for a dead link, on the team card and the staff page. */
export const MINDMAP_LINK_DEAD = "Mindmap link revoked or expired";

/** The submit dialog's field error for a typed or pasted dead link. */
export const MINDMAP_LINK_DEAD_ERROR = "This link was revoked or has expired.";

/** The export's Mindmap link status cells. */
export const MINDMAP_LINK_STATUS_LABEL: Record<MindmapLinkStatus, string> = {
  live: "Live",
  dead: "Revoked or expired",
  unknown: "Unknown",
};

/**
 * What the team card and the staff page show for a stored link: nothing
 * when there is none (or `mindmapLink` drops it), the dead line when doqtri
 * says it is dead, and Open mindmap otherwise, unknown included.
 */
export type MindmapLinkView = { kind: "none" } | { kind: "dead" } | { kind: "link"; url: string };

export function mindmapLinkView(
  url: string | null | undefined,
  status: MindmapLinkStatus,
  value: string | undefined = process.env.DOQTRI_ORIGIN,
): MindmapLinkView {
  const link = mindmapLink(url, value);
  if (!link) return { kind: "none" };
  return status === "dead" ? { kind: "dead" } : { kind: "link", url: link };
}
