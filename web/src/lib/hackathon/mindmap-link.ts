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
