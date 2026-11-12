import "server-only";

import { doqtriOrigin, isDoqtriMindmapUrl } from "@/lib/doqtri-origin";
import type { MindmapLinkStatus } from "@/lib/hackathon/mindmap-link";

/**
 * Whether doqtri still serves a team's mindmap link (WP-4.7, QDIT-67,
 * DOQ-54; contract v1.5.0, section 8, `POST /api/mindmap-links/status`).
 *
 * A link stops working when the team revokes it in doqtri, and 24 hours
 * after the hackathon's grades are released. qdit only holds the URL, so it
 * asks doqtri, from the server, before it prefills, shows or exports one:
 *
 *   - One request for every link a page or export needs (`checkMindmapLinks`
 *     takes them all at once), at most 500 tokens a request, so only an
 *     export of more than 500 entries makes a second one, in parallel.
 *   - The whole check gives up after 2 seconds. No answer, a non-200, a
 *     malformed body or a token missing from it is `unknown`, and unknown is
 *     shown as live: doqtri being down or older than v1.5.0 changes nothing.
 *   - Each definite answer is kept in this server instance's memory for at
 *     most 60 seconds (less if doqtri's `Cache-Control` says so, none on
 *     `no-store`). Unknown is never kept, so the next page asks again.
 *
 * Only the token is sent, and only for a link that is exactly
 * `DOQTRI_ORIGIN/m/<token>`. A token opens the page, so it is never logged.
 */

export const STATUS_PATH = "/api/mindmap-links/status";
/** The contract's batch limit. */
export const MAX_TOKENS_PER_REQUEST = 500;
/** The most a page waits for doqtri (QDIT-67 AC 2). */
export const STATUS_TIMEOUT_MS = 2_000;
/** The longest any answer is reused. */
export const STATUS_CACHE_MS = 60_000;
/** Entries kept at most; the oldest go first. */
const CACHE_LIMIT = 5_000;

/** A link's status, keyed by the link exactly as passed in. Absent means unknown. */
export type MindmapLinkStatuses = ReadonlyMap<string, MindmapLinkStatus>;

/** The status of one link in a check's result; unknown when the check did not cover it. */
export function statusOf(statuses: MindmapLinkStatuses, url: string | null | undefined): MindmapLinkStatus {
  return (url && statuses.get(url)) || "unknown";
}

type CacheEntry = { live: boolean; until: number };

/** Token -> answer. Module state: one per server instance, which is all a 60 s cache needs. */
export type StatusCache = Map<string, CacheEntry>;
const sharedCache: StatusCache = new Map();

/** Empties this instance's cache. For tests. */
export function clearStatusCache(): void {
  sharedCache.clear();
}

export type StatusDeps = {
  fetch?: typeof fetch;
  /** ms since the epoch. */
  now?: () => number;
  /** `DOQTRI_ORIGIN` as configured; the env var by default. */
  origin?: string | undefined;
  cache?: StatusCache;
  timeoutMs?: number;
};

/**
 * How long an answer may be reused, from its `Cache-Control`: at most
 * 60 s, `max-age` when smaller, nothing on `no-store`, `no-cache` or
 * `max-age=0`. A missing or unreadable header is the 60 s cap.
 */
export function cacheLifetimeMs(header: string | null): number {
  if (!header) return STATUS_CACHE_MS;
  const directives = header.toLowerCase().split(",").map((d) => d.trim());
  if (directives.some((d) => d === "no-store" || d === "no-cache")) return 0;
  const maxAge = directives.find((d) => d.startsWith("max-age="));
  if (maxAge) {
    const seconds = Number(maxAge.slice("max-age=".length));
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, STATUS_CACHE_MS);
  }
  return STATUS_CACHE_MS;
}

function remember(cache: StatusCache, token: string, live: boolean, until: number) {
  cache.delete(token);
  cache.set(token, { live, until });
  // Map keeps insertion order, so the first keys are the oldest answers.
  for (const key of cache.keys()) {
    if (cache.size <= CACHE_LIMIT) break;
    cache.delete(key);
  }
}

/** The answer's `live` per token, or null when the body is not the contract's shape. */
function readAnswer(body: unknown, tokens: readonly string[]): Map<string, boolean> | null {
  if (typeof body !== "object" || body === null) return null;
  const links = (body as { links?: unknown }).links;
  if (typeof links !== "object" || links === null || Array.isArray(links)) return null;
  const answers = new Map<string, boolean>();
  for (const token of tokens) {
    if (!Object.prototype.hasOwnProperty.call(links, token)) continue;
    const entry = (links as Record<string, unknown>)[token];
    const live = typeof entry === "object" && entry !== null ? (entry as { live?: unknown }).live : undefined;
    if (typeof live === "boolean") answers.set(token, live);
  }
  return answers;
}

/** One request for up to 500 tokens. Never throws; what it could not learn is left out. */
async function ask(
  origin: string,
  tokens: readonly string[],
  deps: { fetch: typeof fetch; signal: AbortSignal },
): Promise<{ answers: Map<string, boolean>; lifetimeMs: number }> {
  const none = { answers: new Map<string, boolean>(), lifetimeMs: 0 };
  try {
    const response = await deps.fetch(`${origin}${STATUS_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
      body: JSON.stringify({ tokens }),
      // A redirect would take the tokens somewhere else: never followed.
      redirect: "manual",
      cache: "no-store",
      signal: deps.signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      console.warn(`mindmap link status: doqtri answered HTTP ${response.status}; links shown as unknown`);
      return none;
    }
    const answers = readAnswer(await response.json(), tokens);
    if (!answers) {
      console.warn("mindmap link status: doqtri's answer is not the contract's shape; links shown as unknown");
      return none;
    }
    return { answers, lifetimeMs: cacheLifetimeMs(response.headers.get("cache-control")) };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.warn(
      `mindmap link status: ${timedOut ? "no answer from doqtri in time" : "doqtri could not be reached"}; links shown as unknown`,
    );
    return none;
  }
}

/**
 * The status of every doqtri mindmap link in `urls`, in one go. Nulls,
 * repeats and links that are not `DOQTRI_ORIGIN/m/<token>` are skipped (they
 * come back unknown through `statusOf`). Never throws, and resolves within
 * about `STATUS_TIMEOUT_MS` whatever doqtri does.
 */
export async function checkMindmapLinks(
  urls: Iterable<string | null | undefined>,
  deps: StatusDeps = {},
): Promise<MindmapLinkStatuses> {
  const statuses = new Map<string, MindmapLinkStatus>();

  let origin: string;
  try {
    origin = doqtriOrigin("origin" in deps ? deps.origin : process.env.DOQTRI_ORIGIN);
  } catch (error) {
    console.error("mindmap link status:", error instanceof Error ? error.message : error);
    return statuses;
  }

  const prefix = `${origin}/m/`;
  const tokenOf = new Map<string, string>();
  for (const url of urls) {
    if (url && !tokenOf.has(url) && isDoqtriMindmapUrl(url, origin)) tokenOf.set(url, url.slice(prefix.length));
  }
  if (tokenOf.size === 0) return statuses;

  const cache = deps.cache ?? sharedCache;
  const now = deps.now ?? Date.now;
  const started = now();

  const known = new Map<string, boolean>();
  const missing: string[] = [];
  for (const token of new Set(tokenOf.values())) {
    const hit = cache.get(token);
    if (hit && hit.until > started) known.set(token, hit.live);
    else missing.push(token);
  }

  if (missing.length > 0) {
    // One signal for every request: the whole check, not each request, has 2 s.
    const signal = AbortSignal.timeout(deps.timeoutMs ?? STATUS_TIMEOUT_MS);
    const batches: string[][] = [];
    for (let i = 0; i < missing.length; i += MAX_TOKENS_PER_REQUEST) {
      batches.push(missing.slice(i, i + MAX_TOKENS_PER_REQUEST));
    }
    const results = await Promise.all(
      batches.map((batch) => ask(origin, batch, { fetch: deps.fetch ?? fetch, signal })),
    );
    const answeredAt = now();
    for (const { answers, lifetimeMs } of results) {
      for (const [token, live] of answers) {
        known.set(token, live);
        if (lifetimeMs > 0) remember(cache, token, live, answeredAt + lifetimeMs);
      }
    }
  }

  for (const [url, token] of tokenOf) {
    const live = known.get(token);
    statuses.set(url, live === undefined ? "unknown" : live ? "live" : "dead");
  }
  return statuses;
}
