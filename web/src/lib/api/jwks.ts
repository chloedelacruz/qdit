import "server-only";

import type { JWK } from "@supabase/supabase-js";

import { getSupabasePublishableKey } from "@/lib/supabase/env";

import { ApiError } from "./errors";

/**
 * The Auth server's signing keys, cached here rather than inside auth-js.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT LEAVE IT TO `getClaims()`
 * ---------------------------------------------------------------------------
 * auth-js caches the JWKS too, but it refetches on every token whose `kid` it
 * has not seen, and has no negative cache. `kid` comes from the token header,
 * which the caller writes, so a stream of tokens with random `kid`s would cost
 * one outbound JWKS request per inbound request, all before the rate limiter
 * (which needs a verified token to know whom to count). Worse, a `kid` the
 * JWKS lacks makes `getClaims()` fall back to `getUser()`, a second round trip.
 *
 * So `./auth.ts` resolves the key here first and hands `getClaims()` exactly
 * that one key. An unknown `kid` refetches at most once per
 * `JWKS_REFETCH_INTERVAL_MS`; in between it is simply not a key we know, and
 * the token is a 401 with no network call at all.
 *
 * ---------------------------------------------------------------------------
 * FRESHNESS AND FAILURE
 * ---------------------------------------------------------------------------
 *   - A known key is trusted for `JWKS_TTL_MS` (ten minutes, auth-js's own
 *     TTL), so a rotated-out key stops verifying within that long.
 *   - Concurrent misses share one fetch.
 *   - A failed fetch with keys already cached keeps serving the cached keys
 *     and retries after `JWKS_FAILURE_BACKOFF_MS`: a JWKS blip must not turn
 *     every good token into an error.
 *   - A failed fetch with nothing cached is `503 unavailable`, never a 401:
 *     doqtri answers a 401 by refreshing a perfectly good grant.
 *
 * In memory, per instance, like `lib/auth/rate-limit.ts`.
 */

/** How long a fetched key set is trusted. Matches auth-js's `JWKS_TTL`. */
export const JWKS_TTL_MS = 10 * 60_000;

/** Least time between two fetches after a successful one (the negative cache). */
export const JWKS_REFETCH_INTERVAL_MS = 60_000;

/** Least time between two fetches after a failed one. */
export const JWKS_FAILURE_BACKOFF_MS = 5_000;

/** A JWKS that does not answer in this long counts as failed. */
const FETCH_TIMEOUT_MS = 5_000;

type KeySet = { keys: JWK[]; fetchedAt: number };

let cache: KeySet | null = null;
let nextFetchAt = 0;
let inflight: Promise<void> | null = null;

/**
 * The signing key with this `kid`, or null when the Auth server has none.
 *
 * Throws `unavailable` only when no key set has ever been fetched and the
 * fetch fails now (or failed within the backoff).
 */
export async function signingKey(jwksUrl: string, kid: string): Promise<JWK | null> {
  const now = Date.now();
  const fresh = cache !== null && now - cache.fetchedAt < JWKS_TTL_MS;
  const known = find(kid);

  if (known && fresh) return known;

  if (inflight) {
    await inflight;
  } else if (now >= nextFetchAt) {
    inflight = refresh(jwksUrl).finally(() => {
      inflight = null;
    });
    await inflight;
  }

  if (!cache) {
    throw new ApiError(
      "unavailable",
      "qdit could not verify the token right now. Try again shortly.",
      { headers: { "Retry-After": "5" } },
    );
  }

  return find(kid);
}

/** Forgets every cached key and backoff. Tests only. */
export function resetJwksCache(): void {
  cache = null;
  nextFetchAt = 0;
  inflight = null;
}

function find(kid: string): JWK | null {
  return cache?.keys.find((key) => key.kid === kid) ?? null;
}

async function refresh(jwksUrl: string): Promise<void> {
  const startedAt = Date.now();
  nextFetchAt = startedAt + JWKS_REFETCH_INTERVAL_MS;

  try {
    const response = await fetch(jwksUrl, {
      headers: { apikey: getSupabasePublishableKey() },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`JWKS answered ${response.status}`);

    const body = (await response.json()) as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys.filter(isSigningKey) : [];

    if (keys.length === 0) {
      // A project still on a symmetric (HS256) secret publishes no keys. The
      // contract requires JWKS verification, so every token is refused until
      // the project moves to asymmetric signing keys.
      console.error("api auth: the JWKS has no signing keys; every token will be refused");
    }

    cache = { keys, fetchedAt: startedAt };
  } catch (error) {
    nextFetchAt = Date.now() + JWKS_FAILURE_BACKOFF_MS;
    console.error(
      cache
        ? "api auth: JWKS refresh failed; keeping the cached keys"
        : "api auth: JWKS fetch failed and no keys are cached",
      error,
    );
  }
}

/** A public key meant for verifying signatures, with a `kid` to find it by. */
function isSigningKey(value: unknown): value is JWK {
  if (typeof value !== "object" || value === null) return false;
  const key = value as Record<string, unknown>;
  return (
    typeof key.kid === "string" &&
    key.kid.length > 0 &&
    (key.kty === "EC" || key.kty === "RSA") &&
    (key.use === undefined || key.use === "sig")
  );
}
