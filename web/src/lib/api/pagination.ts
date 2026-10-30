import { invalidRequest } from "./errors";

/**
 * Keyset pagination for `/api/v1` lists (contract section 8,
 * `GET /projects`): order `created_at desc, id desc`, `limit` 1 to 100
 * (default 50), and an opaque `cursor` naming the last row of the previous
 * page.
 *
 * The cursor is base64url JSON `{"c": <created_at>, "i": <id>}`. It carries
 * `created_at` exactly as PostgREST returned it — microseconds and all —
 * because a `Date` round trip would truncate to milliseconds and silently skip
 * every row that shares the truncated millisecond with the page boundary.
 *
 * Opaque to clients, but not trusted: `decodeCursor()` validates both values
 * against strict patterns before either is placed in a PostgREST filter, so a
 * crafted cursor cannot inject filter syntax.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export type Cursor = { createdAt: string; id: string };

const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]{1,512}$/;

/** `limit` from the query string. Absent means the default. */
export function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;

  const value = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= 1 && value <= MAX_LIMIT)) {
    throw invalidRequest("limit must be an integer from 1 to 100.", {
      limit: "must be an integer from 1 to 100",
    });
  }
  return value;
}

export function encodeCursor({ createdAt, id }: Cursor): string {
  return Buffer.from(JSON.stringify({ c: createdAt, i: id })).toString(
    "base64url",
  );
}

/** `cursor` from the query string, or null for the first page. */
export function decodeCursor(raw: string | null): Cursor | null {
  if (raw === null) return null;

  const bad = invalidRequest("cursor is not one this API issued.", {
    cursor: "invalid cursor",
  });

  if (!BASE64URL.test(raw)) throw bad;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw bad;
  }

  if (typeof parsed !== "object" || parsed === null) throw bad;
  const { c, i } = parsed as { c?: unknown; i?: unknown };

  if (typeof c !== "string" || !TIMESTAMP.test(c)) throw bad;
  if (typeof i !== "string" || !UUID.test(i)) throw bad;
  if (Number.isNaN(Date.parse(c))) throw bad;

  return { createdAt: c, id: i };
}

/**
 * The PostgREST `or=` filter for "after this cursor" in
 * `created_at desc, id desc` order. Only call with a decoded cursor — the
 * values are quoted, but it is the validation that makes that sufficient.
 */
export function afterCursorFilter({ createdAt, id }: Cursor): string {
  return `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${id})`;
}
