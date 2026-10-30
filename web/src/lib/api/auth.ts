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
import { signingKey } from "./jwks";

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
 * Before anything leaves the process, the token header is decoded here: `alg`
 * must be ES256 or RS256 and `kid` must name a key in the Auth server's JWKS
 * (`./jwks.ts`, which owns that cache and its negative cache). Anything else
 * is a 401 with no network call. Both values are the caller's to choose, and
 * left to auth-js they would each buy an outbound request: an `HS*` alg or a
 * missing `kid` makes `getClaims()` ask the Auth server (`getUser(token)`),
 * and an unknown `kid` makes it refetch the JWKS every time. The contract
 * (section 5) requires JWKS verification anyway, so the HS256 fallback is not
 * ours to offer.
 *
 * `auth.getClaims(token, { jwks })` (supabase-js 2.111) is then handed exactly
 * that one key, verifies the signature with WebCrypto and rejects an expired
 * `exp`. It turns only `AuthError`s into `{ error }`; a header or payload that
 * is base64url but not JSON, or a key WebCrypto will not import, makes it
 * throw instead. Those are malformed tokens too, so they are caught and are
 * the same 401.
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
 *   - `client_id` is a UUID, as Supabase issues them (D-77). The revoke table
 *     keys on a uuid, so a revoke could never be recorded for any other
 *     shape. `oauth_token_revoked()` now counts such a token as revoked
 *     itself (D-96), which is what closes PostgREST; here it is refused
 *     before that lookup, as a malformed token, the same 401.
 *
 * And one thing only the database knows (D-59):
 *
 *   - the token was not issued at or before its user's latest revoke of its
 *     client. Revoking an app in qdit's Settings records the time
 *     (`oauth_client_revocations`); Auth cannot recall a signed JWT, so this
 *     is what makes a disconnect take effect at once rather than at `exp`.
 *     One RPC, `oauth_token_revoked()`, run with the caller's own token: it
 *     reads `sub`, `client_id` and `iat` from that token, so it answers for
 *     the caller and nobody else. Once per request, never cached across
 *     requests, since a revoke must bite on the very next one. When the
 *     lookup fails the answer is `503 unavailable`, not a pass: a revoked
 *     app must not get in because the database was slow.
 *
 * Every token failure is the same `401 unauthorized` — see `unauthorized()`.
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

/**
 * The algorithms Supabase asymmetric signing keys use, and the only ones
 * auth-js can verify. `HS*` is absent on purpose: see the header.
 */
const ALGORITHMS = new Set(["ES256", "RS256"]);

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
 * when the JWKS cannot be fetched and none is cached — a 401 there would make
 * doqtri refresh a perfectly good grant and, on a second failure, disconnect
 * the user over our outage.
 */
export async function authenticate(request: Request): Promise<ApiAuth> {
  const token = readBearerToken(request.headers);
  if (!token) throw unauthorized();

  const header = readHeader(token);
  if (!header) throw unauthorized();

  const key = await signingKey(
    `${expectedIssuer()}/.well-known/jwks.json`,
    header.kid,
  );
  // A key published for one algorithm is never used with another.
  if (!key || (key.alg !== undefined && key.alg !== header.alg)) {
    throw unauthorized();
  }

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

  let result: Awaited<ReturnType<typeof verifier.auth.getClaims>>;
  try {
    result = await verifier.auth.getClaims(token, { jwks: { keys: [key] } });
  } catch (thrown) {
    // Not an AuthError, so not from the network: a payload that is not JSON,
    // a key WebCrypto refuses. Malformed, therefore 401 (contract section 6).
    if (thrown instanceof ApiError) throw thrown;
    throw unauthorized();
  }
  const { data, error } = result;

  if (error) {
    // With the key supplied, getClaims() makes no request of its own; this
    // stays so that an auth-js change which brings one back degrades to 503.
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

  if (await revoked(supabase)) throw unauthorized();

  return {
    supabase,
    claims,
    userId: claims.sub,
    clientId: claims.client_id,
  };
}

/**
 * Whether the user revoked this app after the token was issued (D-59; see the
 * header). Fails closed: anything but a plain `true` or `false` from the
 * database is a 503, never a pass.
 */
async function revoked(supabase: SupabaseClient<Database>): Promise<boolean> {
  let data: unknown = null;
  let error: unknown = null;
  try {
    ({ data, error } = await supabase.rpc("oauth_token_revoked"));
  } catch (thrown) {
    error = thrown;
  }

  if (!error && typeof data === "boolean") return data;

  console.error("api auth: could not check the token against revocations", error ?? data);
  throw new ApiError(
    "unavailable",
    "qdit could not verify the token right now. Try again shortly.",
    { headers: { "Retry-After": "5" } },
  );
}

/**
 * `alg` and `kid` from the token header, or null when the header is not JSON
 * or names anything this module will not verify. Local only.
 */
function readHeader(token: string): { alg: string; kid: string } | null {
  let header: unknown;
  try {
    const segment = token.slice(0, token.indexOf("."));
    header = JSON.parse(atob(segment.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }

  if (typeof header !== "object" || header === null) return null;
  const { alg, kid } = header as Record<string, unknown>;

  if (typeof alg !== "string" || !ALGORITHMS.has(alg)) return null;
  if (typeof kid !== "string" || kid.length === 0 || kid.length > 255) return null;
  return { alg, kid };
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
    UUID.test(clientId) &&
    // getClaims() already rejects a missing or past `exp`. Checked again so
    // the contract's list is enforced in one readable place, not partly
    // inside a dependency whose behaviour can change on upgrade.
    typeof exp === "number" &&
    exp * 1000 > Date.now()
  );
}
