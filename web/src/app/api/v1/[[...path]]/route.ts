import { endpointNotFound } from "@/lib/api/handler";

/**
 * Every `/api/v1` path no other Route Handler claims, `/api/v1` itself
 * included (hence the optional catch-all).
 *
 * Without this, an unknown path would get Next's HTML 404 page, and the
 * contract (section 6) promises a JSON `not_found` for "unknown path or id".
 * Specific routes always win over a catch-all, so endpoints added later need
 * nothing from this file. See `endpointNotFound` for why it authenticates
 * first, and `ROUTE_METHODS` for why HEAD and OPTIONS are listed too.
 */
export const GET = endpointNotFound;
export const HEAD = endpointNotFound;
export const OPTIONS = endpointNotFound;
export const POST = endpointNotFound;
export const PUT = endpointNotFound;
export const PATCH = endpointNotFound;
export const DELETE = endpointNotFound;
