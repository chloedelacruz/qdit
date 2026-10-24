import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * True when `Authorization` is exactly `Bearer <CRON_SECRET>`. Vercel Cron
 * sends that header when the project has CRON_SECRET set.
 *
 * Both sides are hashed first so the comparison is constant time whatever
 * the lengths, and an unset or empty secret never matches anything.
 */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;

  const given = createHash("sha256").update(match[1], "utf8").digest();
  const expected = createHash("sha256").update(secret, "utf8").digest();
  return timingSafeEqual(given, expected);
}
