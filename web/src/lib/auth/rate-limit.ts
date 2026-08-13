import "server-only";

/**
 * A fixed-window counter, in memory.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 * This is a floor, not a ceiling. The state lives in one process, so it counts
 * per instance rather than per deployment: two instances behind a load balancer
 * enforce twice the limit, and a restart forgets everything. A determined
 * attacker with a pool of addresses is not stopped by this.
 *
 * It is here anyway, because the endpoints it guards do signature verification
 * and — on the sign-up path — an admin write, and the difference between "no
 * limit at all" and "a few per minute per address" is the difference between a
 * loop that costs nothing and one that does not. When qdit runs on more than
 * one instance, replace the map with a shared store and keep the call sites.
 *
 * Deliberately not a token bucket or a sliding window: a fixed window is a
 * counter and a timestamp, and the failure mode of the cheap version (up to
 * double the limit across a window boundary) is irrelevant at these numbers.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/**
 * Above this many tracked keys, expired entries are swept before inserting.
 *
 * Without it the map grows once per distinct client forever, which is a slow
 * memory leak that only shows up under exactly the traffic this is meant to
 * survive.
 */
const SWEEP_THRESHOLD = 10_000;

export type RateLimit = { limit: number; windowMs: number };

/** True when the call is allowed. Counts the call as used when it returns true. */
export function rateLimit(key: string, { limit, windowMs }: RateLimit): boolean {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    if (windows.size > SWEEP_THRESHOLD) {
      for (const [k, window] of windows) {
        if (now >= window.resetAt) windows.delete(k);
      }
    }

    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (existing.count >= limit) return false;

  existing.count += 1;
  return true;
}

/**
 * Who to count against.
 *
 * `request.ip` was removed in Next 16, so the proxy header is the only source.
 * It is client-controllable when nothing trustworthy sits in front of the app,
 * which is another reason this is a floor: a spoofed header buys a fresh
 * bucket. The first entry is the original client; the rest are proxies.
 */
export function clientKey(request: Request, scope: string): string {
  return headerKey(request.headers, scope);
}

/**
 * The same, for a caller that has headers but no `Request`.
 *
 * Server Actions are the reason: they are POST endpoints reachable by anyone
 * who can send the POST — the framework says so plainly — so the one that
 * creates accounts wants the same limiter the route handlers have. What it does
 * not have is a `Request` object; `headers()` from `next/headers` is what it
 * gets instead.
 */
export function headerKey(headers: Headers, scope: string): string {
  const forwarded = headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `${scope}:${ip}`;
}
