import { databaseError, unauthorized } from "@/lib/api/errors";
import { apiRoute, endpointNotFound, json } from "@/lib/api/handler";
import { toHackathon, type ApiHackathon } from "@/lib/api/resources";

/**
 * `GET /api/v1/hackathons` — the hackathons a signed-in qdit user is offered
 * (contract v1.3.0, section 8; WP-4.7, D-122, QDIT-60).
 *
 * doqtri's Send to qdit hackathon dialog shows this list so the user picks a
 * hackathon instead of pasting its link. Any authorised client may call it;
 * it names no project, so no project role is needed.
 *
 * The `hackathons` table stays closed to apps (its restrictive OAuth SELECT
 * guard), so this cannot be a PostgREST read. It calls
 * `list_open_hackathons_for_client()` with the caller's own token instead: a
 * SECURITY DEFINER function that applies the listing rules itself (not
 * hidden, no `test-` slug, not closed; `opens_at`, then slug; at most 50) and
 * returns only the five public fields
 * (supabase/migrations/20261111120000_hackathon_list_for_clients.sql).
 *
 * It takes no query parameters. Like `GET /me`, it ignores any it is sent.
 * It does not page yet, so `next_cursor` is always `null`.
 */
export const GET = apiRoute(async ({ auth }) => {
  const { data, error } = await auth.supabase.rpc("list_open_hackathons_for_client");

  if (error) {
    console.error("api v1 hackathons: list failed", error);
    // The function's only 42501s are "no user" and "revoked token": token
    // problems, which the contract answers 401 here (a revoke that landed
    // after authenticate() checked). It never refuses for a role, so this
    // endpoint has no 403.
    if (error.code === "42501") throw unauthorized();
    throw databaseError(error);
  }

  const hackathons: ApiHackathon[] = (data ?? []).flatMap((row) => {
    const hackathon = toHackathon(row);
    return hackathon ? [hackathon] : [];
  });

  return json({ data: hackathons, next_cursor: null });
});

// Read-only endpoint: every other method is an unknown endpoint (D-27, see
// `endpointNotFound`), not Next's empty-body 405 or its automatic HEAD and
// OPTIONS answers.
export const HEAD = endpointNotFound;
export const OPTIONS = endpointNotFound;
export const POST = endpointNotFound;
export const PUT = endpointNotFound;
export const PATCH = endpointNotFound;
export const DELETE = endpointNotFound;
