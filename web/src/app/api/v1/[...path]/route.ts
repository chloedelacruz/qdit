import { ApiError } from "@/lib/api/errors";
import { apiRoute } from "@/lib/api/handler";

/**
 * Every `/api/v1` path no other Route Handler claims.
 *
 * Without this, an unknown path would get Next's HTML 404 page, and the
 * contract (section 6) promises a JSON `not_found` for "unknown path or id".
 * Specific routes always win over a catch-all, so endpoints added later need
 * nothing from this file.
 *
 * It still authenticates first, like every `/api/v1` request: an anonymous
 * caller gets the same 401 here as anywhere else, and learns nothing about
 * which paths exist.
 */
const notFound = apiRoute<{ path: string[] }>(async () => {
  throw new ApiError("not_found", "No such endpoint in qdit API v1.");
});

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
