import { databaseError } from "@/lib/api/errors";
import { apiRoute, endpointNotFound, ok } from "@/lib/api/handler";
import type { ApiUser } from "@/lib/api/resources";

/**
 * `GET /api/v1/me` — who the token belongs to (contract section 8).
 *
 * doqtri calls this once after the OAuth exchange to label the connection
 * ("connected as tyron") and to learn which client id qdit sees, so it can
 * tell two of its own environments apart.
 *
 * Reads the caller's own profile through RLS ("profiles: read own or
 * teammate"). A profile row is created by trigger for every account, so a
 * missing one is a data problem, not a reason to fail: the id is still known
 * from the verified token, and every other field may be null by contract.
 */
export const GET = apiRoute(async ({ auth }) => {
  const { data, error } = await auth.supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, wallet_address")
    .eq("id", auth.userId)
    .maybeSingle();

  if (error) {
    console.error("api v1 me: profile read failed", error);
    throw databaseError(error);
  }

  const user: ApiUser = {
    id: auth.userId,
    username: data?.username ?? null,
    display_name: data?.display_name ?? null,
    avatar_url: data?.avatar_url ?? null,
    wallet_address: data?.wallet_address ?? null,
  };

  return ok({ user, client_id: auth.clientId });
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
