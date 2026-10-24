import "server-only";

import {
  createClient as createSupabaseClient,
  isAuthApiError,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/types/database";

import { ApiError, unauthorized } from "./errors";

/**
 * Bearer authentication for `/api/v1` — integration contract section 5.
 *
 * The callers here are other apps (doqtri first) holding an access token that
 * qdit's Supabase OAuth 2.1 server issued for one qdit user (D-02). There are
 * no cookies on this path and none are read: a browser that happens to carry a
 * qdit session gets nothing from it here, which is also what makes these
 * routes immune to CSRF.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS CHECKED, AND BY WHOM
 * ---------------------------------------------------------------------------
 * `auth.getClaims(token)` (supabase-js 2.111) verifies the signature against
 * `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` with WebCrypto and rejects an
 * expired `exp`. The JWKS is cached per process for ten minutes inside
 * auth-js, keyed by storage key rather than by client instance, so building a
 * client per request does not refetch it. A project still on a symmetric
 * (HS256) secret has no JWKS; `getClaims()` then falls back to asking the Auth
 * server (`getUser(token)`), which is slower but no less verified.
 *
 * What `getClaims()` does *not* check, and this module does:
 *
 *   - `iss` is this project's Auth server. A token signed by the same keys but
 *     minted for another issuer is not ours to honour.
 *   - `role` is `authenticated`. An `anon` or `service_role` JWT is not a user.
 *   - `sub` is a user id and `client_id` is present. A first-party qdit session
 *     token has no `client_id`; the contract refuses it here so that a stolen
 *     browser session cannot drive the API, and so that the D-03 RESTRICTIVE
 *     policies (WP-2.2), which key on `client_id`, always have one to key on.
 *
 * Every failure is the same `401 unauthorized` — see `unauthorized()`.
 *
 * ---------------------------------------------------------------------------
 * THE CLIENT THIS RETURNS
 * ---------------------------------------------------------------------------
 * A Supabase client that sends the caller's token on every PostgREST request,
 * so `auth.uid()` is the caller and `auth.jwt() ->> 'client_id'` is the OAuth
 * client, and RLS decides everything (contract section 5: the service role is
 * never used on a client's behalf). It uses the `accessToken` option, which
 * makes `supabase.auth` throw on use: nothing downstream can refresh, sign out
 * or otherwise turn this into a session.
 */

export type ApiClaims = {
  /** The qdit user id (`auth.users.id`). */
  sub: string;
  /** The OAuth client the token was issued to. */
  client_id: string;
  iss: string;
  role: string;
  exp: number;
  [claim: string]: unknown;
};

export type ApiAuth = {
  /** Runs as the caller. RLS applies. */
  supabase: SupabaseClient<Database>;
  claims: ApiClaims;
  userId: string;
  clientId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Three base64url segments. Anything else is not worth a JWKS lookup, and
 * rejecting it here keeps junk out of the verifier entirely.
 */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** The issuer every accepted token must name: `<SUPABASE_URL>/auth/v1`. */
export function expectedIssuer(): string {
  return `${getSupabaseUrl().replace(/\/+$/, "")}/auth/v1`;
}

/**
 * The token from `Authorization: Bearer <token>`, or null.
 *
 * The scheme is case-insensitive (RFC 6750 section 2.1 defers to RFC 7235).
 * Exactly one space-separated token; a second one is malformed, not ignored.
 */
export function readBearerToken(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header) return null;

  const match = /^Bearer +(\S+)\s*$/i.exec(header);
  if (!match) return null;

  const token = match[1];
  return JWT_SHAPE.test(token) ? token : null;
}

/**
 * Verifies the request's bearer token and returns a client scoped to it.
 *
 * Throws `ApiError`: `unauthorized` for every token problem, `unavailable`
 * when the Auth server or its JWKS cannot be reached — a 401 there would make
 * doqtri refresh a perfectly good grant and, on a second failure, disconnect
 * the user over our outage.
 */
export async function authenticate(request: Request): Promise<ApiAuth> {
  const token = readBearerToken(request.headers);
  if (!token) throw unauthorized();

  const verifier = createSupabaseClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      // Verification only. Never a session: nothing is stored, nothing is
      // refreshed, nothing is read from a URL.
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  const { data, error } = await verifier.auth.getClaims(token);

  if (error) {
    if (
      isAuthRetryableFetchError(error) ||
      (isAuthApiError(error) && error.status >= 500)
    ) {
      console.error("api auth: could not verify token", error);
      throw new ApiError(
        "unavailable",
        "qdit could not verify the token right now. Try again shortly.",
        { headers: { "Retry-After": "5" } },
      );
    }
    throw unauthorized();
  }

  const claims = data?.claims as Record<string, unknown> | undefined;
  if (!claims || !acceptable(claims)) throw unauthorized();

  const supabase = createSupabaseClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    { accessToken: async () => token },
  );

  return {
    supabase,
    claims,
    userId: claims.sub,
    clientId: claims.client_id,
  };
}

/** The checks `getClaims()` leaves to us. See the header. */
function acceptable(claims: Record<string, unknown>): claims is ApiClaims {
  const { iss, role, sub, client_id: clientId, exp } = claims;

  return (
    iss === expectedIssuer() &&
    role === "authenticated" &&
    typeof sub === "string" &&
    UUID.test(sub) &&
    typeof clientId === "string" &&
    clientId.length > 0 &&
    clientId.length <= 255 &&
    // getClaims() already rejects a missing or past `exp`. Checked again so
    // the contract's list is enforced in one readable place, not partly
    // inside a dependency whose behaviour can change on upgrade.
    typeof exp === "number" &&
    exp * 1000 > Date.now()
  );
}
