/**
 * doqtri's origin, and whether a `doc_url` belongs to it (D-45).
 *
 * A doc link's `doc_url` is where a qdit user goes to read the plan, and qdit
 * renders it as a link. D-45 pins it to doqtri: it must start with doqtri's
 * origin. The origin is deployment config (`DOQTRI_ORIGIN`), not data, so
 * the database only holds `doc_url` to a plain https URL
 * (`project_doc_links`' CHECK) and the origin is enforced here, in two places:
 *
 *   - the API refuses a `doc_url` off the origin (`POST /projects/{id}/docs`,
 *     `400 invalid_request` on `doc_url`);
 *   - the "Plan docs" row renders `doc_url` as a link only when it is on the
 *     origin, which covers rows the API did not check (a row written before
 *     the origin changed, or `link_project_doc()` called over PostgREST by a
 *     project admin's own session; no client writes the table directly, D-48).
 *
 * Server-only by convention: `DOQTRI_ORIGIN` has no `NEXT_PUBLIC_` prefix.
 * Pure otherwise, so the rules are unit tested directly.
 */

export const DEFAULT_DOQTRI_ORIGIN = "https://www.doqtri.xyz";

/**
 * `DOQTRI_ORIGIN`, as an origin: `https://host[:port]`, no path, lower case.
 * Unset or empty is the default. A trailing `/` is forgiven; anything else
 * that is not exactly an https origin throws, so a typo in the config fails
 * loudly instead of silently accepting or refusing every doc.
 */
export function doqtriOrigin(value: string | undefined = process.env.DOQTRI_ORIGIN): string {
  const raw = (value ?? "").trim();
  if (raw === "") return DEFAULT_DOQTRI_ORIGIN;

  let url: URL | null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  const bare = raw.replace(/\/$/, "");
  if (!url || url.protocol !== "https:" || url.origin.toLowerCase() !== bare.toLowerCase()) {
    throw new Error(
      `DOQTRI_ORIGIN must be an https origin such as ${DEFAULT_DOQTRI_ORIGIN} (no path), got ${JSON.stringify(raw)}.`,
    );
  }
  return url.origin;
}

/** Whitespace, control characters and backslashes: never in a doqtri URL. */
const UNSAFE = /[\s\u0000-\u001f\u007f-\u009f\\]/;

/**
 * True when `url` starts with `origin` and the origin is the whole authority:
 * what follows it is nothing, or a path, query or fragment. So
 * `https://www.doqtri.xyz.evil.example/` and `https://www.doqtri.xyz@evil.example/`
 * are off the origin even though they start with the same characters, and
 * `HTTPS://WWW.DOQTRI.XYZ/` or `https://www.doqtri.xyz:443/` are refused for
 * not being written the way doqtri writes its own URLs.
 */
export function isDoqtriDocUrl(url: string, origin: string): boolean {
  if (!url.startsWith(origin) || UNSAFE.test(url)) return false;
  const rest = url.slice(origin.length);
  if (rest !== "" && !/^[/?#]/.test(rest)) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
