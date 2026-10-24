/**
 * The `/api/v1` error vocabulary — integration contract section 6
 * (`docs/integration/CONTRACT.md`, WP-2.0).
 *
 * Every failure a client can see is one of these codes, in one body shape:
 *
 *   { "error": { "code": "...", "message": "...", "details": { ... } | null } }
 *
 * Clients branch on `code` and `details.reason`, never on `message`, so the
 * message is free to be plain English. It must also be safe to show: nothing
 * from a database error, an environment variable or a stack trace goes in it.
 * Those go to the server log, and the caller quotes `X-Request-Id` instead.
 *
 * Kept free of `server-only` and of Next imports so the shapes can be unit
 * tested without a request scope.
 */

export type ApiErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal_error"
  | "unavailable";

/** The HTTP status each code is sent with. Fixed by the contract's table. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
  unavailable: 503,
};

export type ApiErrorDetails = Record<string, unknown> | null;

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; details: ApiErrorDetails };
};

/**
 * A failure the caller is meant to see. Thrown from anywhere under a route
 * wrapped by `apiRoute()`, which turns it into the response; anything else
 * thrown becomes a bare `internal_error`.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetails;
  /** Extra response headers, e.g. `Retry-After` on a 429. */
  readonly headers: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { details?: ApiErrorDetails; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = API_ERROR_STATUS[code];
    this.details = options.details ?? null;
    this.headers = options.headers ?? {};
  }

  toBody(): ApiErrorBody {
    return {
      error: { code: this.code, message: this.message, details: this.details },
    };
  }
}

/**
 * The 401 every token problem collapses into.
 *
 * One message for every cause on purpose: telling a caller *which* check its
 * token failed (signature, issuer, missing `client_id`) is a guide to forging a
 * better one. The contract fixes the `WWW-Authenticate` value.
 */
export function unauthorized(): ApiError {
  return new ApiError(
    "unauthorized",
    "A valid qdit OAuth access token is required.",
    { headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' } },
  );
}

/** `400 invalid_request` naming the fields at fault (`details.fields`). */
export function invalidRequest(
  message: string,
  fields: Record<string, string>,
): ApiError {
  return new ApiError("invalid_request", message, { details: { fields } });
}

/**
 * The subset of a PostgREST error this module reads. Structural, so a test can
 * pass a literal and so it also fits errors from `rpc()`.
 */
export type DatabaseErrorLike = { code?: string | null; message?: string };

/**
 * Maps a failed Supabase query onto the contract's vocabulary.
 *
 *   no SQLSTATE at all     -> unavailable  (the fetch itself failed: supabase-js
 *                                           reports a network error with an
 *                                           empty `code`)
 *   PGRST301 / PGRST303    -> unauthorized (PostgREST rejected the JWT — it
 *                                           expired between our check and the
 *                                           query, or was revoked)
 *   42501                  -> forbidden    (a GRANT or a RESTRICTIVE policy,
 *                                           i.e. the D-03 guard, refused it)
 *   anything else          -> internal_error
 *
 * The original is logged by the caller, never sent.
 */
export function databaseError(error: DatabaseErrorLike): ApiError {
  const code = error.code ?? "";

  if (code === "") {
    return new ApiError(
      "unavailable",
      "qdit could not reach its database. Try again shortly.",
    );
  }
  if (code === "PGRST301" || code === "PGRST303") return unauthorized();
  if (code === "42501") {
    return new ApiError(
      "forbidden",
      "This token is not allowed to do that.",
    );
  }

  return internalError();
}

export function internalError(): ApiError {
  return new ApiError(
    "internal_error",
    "Something went wrong on qdit's side. Retry with backoff.",
  );
}
