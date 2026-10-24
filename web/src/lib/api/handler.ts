import "server-only";

import { after } from "next/server";

import { takeFromWindows, type RateLimit } from "@/lib/auth/rate-limit";

import { recordApiRequest } from "./audit";
import { authenticate, type ApiAuth } from "./auth";
import { ApiError, internalError } from "./errors";

/**
 * The one wrapper every `/api/v1` Route Handler goes through.
 *
 * In order, for every request:
 *
 *   1. mint an `X-Request-Id` (contract section 4) — on every response,
 *      errors included, so a caller always has something to quote;
 *   2. authenticate the bearer token (`./auth.ts`) — nothing under `/api/v1`
 *      is anonymous;
 *   3. rate-limit per `(client_id, sub)` and per `client_id` (section 6),
 *      charging both windows only when both allow, so a refused request uses
 *      up nobody's budget;
 *   4. run the handler with a client scoped to the caller;
 *   5. turn any thrown `ApiError` into the contract's error body, and anything
 *      else into a bare `internal_error` with the real error in the log;
 *   6. after the response is sent, append the `api_requests` audit row
 *      (`./audit.ts`) — only for requests that authenticated, so an anonymous
 *      caller cannot grow the table, and for a rate-limited caller only the
 *      first 429 of each window, so the audit writes stay bounded by the
 *      limit they record.
 *
 * Handlers return a `Response` (use `ok()` / `json()` / `noContent()` below)
 * and throw `ApiError` for anything the caller should see.
 */

/**
 * Contract section 6 defaults. Clients are told to rely on `Retry-After`, not
 * on these numbers, so they can change without a contract change.
 *
 * In memory, per instance — the same floor-not-ceiling trade
 * `lib/auth/rate-limit.ts` documents. On several instances the effective limit
 * is a multiple of these. When that matters, count from `api_requests`
 * (indexed on `(client_id, created_at)` for this) and keep the call site.
 */
export const API_RATE_LIMITS: { perUser: RateLimit; perClient: RateLimit } = {
  perUser: { limit: 60, windowMs: 60_000 },
  perClient: { limit: 600, windowMs: 60_000 },
};

export type ApiContext<Params> = {
  request: Request;
  auth: ApiAuth;
  requestId: string;
  params: Params;
};

type RouteContext<Params> = { params: Promise<Params> };

const JSON_TYPE = "application/json; charset=utf-8";

/** A JSON response with the contract's content type. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": JSON_TYPE },
  });
}

/** `{"data": ...}` — the success envelope (contract section 4). */
export function ok(data: unknown, status = 200): Response {
  return json({ data }, status);
}

/** `204` with no body, for deletes. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function apiRoute<Params = Record<string, never>>(
  handler: (context: ApiContext<Params>) => Promise<Response>,
) {
  return async function route(
    request: Request,
    context?: RouteContext<Params>,
  ): Promise<Response> {
    const requestId = crypto.randomUUID();
    let auth: ApiAuth | null = null;
    let audit = true;
    let response: Response;

    try {
      auth = await authenticate(request);

      const verdict = takeRateLimit(auth);
      if (!verdict.allowed) {
        audit = verdict.firstRefusal;
        throw rateLimited(verdict.retryAfterMs);
      }

      const params = (await context?.params) ?? ({} as Params);
      response = await handler({ request, auth, requestId, params });
    } catch (error) {
      response = errorResponse(error, requestId);
    }

    response.headers.set("X-Request-Id", requestId);
    // Per-user data behind a bearer token. No shared cache may keep it.
    response.headers.set("Cache-Control", "no-store");

    if (auth && audit) {
      const { clientId, userId } = auth;
      const status = response.status;
      after(() =>
        recordApiRequest({
          requestId,
          clientId,
          userId,
          method: request.method,
          path: new URL(request.url).pathname,
          status,
        }),
      );
    }

    return response;
  };
}

/**
 * The answer for a path, or a method on a path, that no handler serves.
 *
 * The contract (section 6) promises a JSON `not_found` for an unknown path,
 * and an endpoint is a method and a path together, so a method a route does
 * not implement gets the same answer rather than Next's empty-body 405
 * (D-27). Each
 * `/api/v1` route file exports this for the methods it does not serve, and
 * the `[[...path]]` catch-all exports it for everything. Like every handler
 * here it authenticates first, so an anonymous caller learns nothing about
 * which endpoints exist.
 */
export const endpointNotFound = apiRoute<{ path?: string[] }>(async () => {
  throw new ApiError("not_found", "No such endpoint in qdit API v1.");
});

/**
 * The methods a Route Handler can export. Next answers any other method
 * itself, with an empty `400`, before a route file is consulted, so
 * `src/proxy.ts` sends those to `endpointNotFound` on `/api/v1` instead.
 *
 * Each `/api/v1` route file exports every one of these: its real handlers,
 * and `endpointNotFound` for the rest. `HEAD` and `OPTIONS` included, because
 * Next would otherwise answer them on its own (`HEAD` by running `GET`,
 * `OPTIONS` with an empty `204` and an `Allow` list), and neither is in the
 * contract (D-27).
 */
export const ROUTE_METHODS = [
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;

export function isRouteMethod(method: string): boolean {
  return (ROUTE_METHODS as readonly string[]).includes(method);
}

function takeRateLimit({ clientId, userId }: ApiAuth) {
  return takeFromWindows([
    { key: `api-v1:user:${clientId}:${userId}`, limit: API_RATE_LIMITS.perUser },
    { key: `api-v1:client:${clientId}`, limit: API_RATE_LIMITS.perClient },
  ]);
}

function rateLimited(retryAfterMs: number): ApiError {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new ApiError(
    "rate_limited",
    "Too many requests. Wait for Retry-After seconds and try again.",
    { headers: { "Retry-After": String(seconds) } },
  );
}

function errorResponse(error: unknown, requestId: string): Response {
  let apiError: ApiError;
  if (error instanceof ApiError) {
    apiError = error;
  } else {
    console.error(`api: unhandled error in request ${requestId}`, error);
    apiError = internalError();
  }

  const response = json(apiError.toBody(), apiError.status);
  for (const [name, value] of Object.entries(apiError.headers)) {
    response.headers.set(name, value);
  }
  return response;
}
