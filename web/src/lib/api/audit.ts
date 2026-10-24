import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/types/database";

/**
 * Writes one `api_requests` row per authenticated `/api/v1` request.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SERVICE ROLE, AND WHY ONLY HERE
 * ---------------------------------------------------------------------------
 * `supabase/migrations/20261024100000_api_requests.sql` gives the table RLS
 * with no policies and grants `authenticated` nothing, so no token — first
 * party or OAuth — can read or write it through PostgREST. The only writer is
 * this function, with the secret key, and that is the one thing the contract
 * (section 5) allows the service role to do on the API path.
 *
 * The alternative was a SECURITY DEFINER function granted to `authenticated`.
 * It would be callable by any signed-in user straight through PostgREST, so
 * the log would record whatever a caller chose to claim about itself (path,
 * status) and anyone could flood it. Granting it to `service_role` only would
 * make it a direct insert with more surface. Here every value comes from the
 * verified claims and the response this server actually sent.
 *
 * The row is written from `after()`, once the response is gone, so the log
 * costs the caller no latency, and a failed write is logged and dropped — an
 * audit outage must not become an API outage.
 */

export type ApiRequestRecord = {
  requestId: string;
  clientId: string;
  userId: string;
  method: string;
  path: string;
  status: number;
};

/** Longest path stored. The column's CHECK matches. */
const MAX_PATH = 2048;

export async function recordApiRequest(record: ApiRequestRecord): Promise<void> {
  const secret =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    console.error(
      "api audit: SUPABASE_SECRET_KEY is not set; api_requests row dropped " +
        `(request ${record.requestId}). See web/.env.example.`,
    );
    return;
  }

  const admin = createSupabaseClient<Database>(getSupabaseUrl(), secret, {
    // Per call, and never the caller: no session is read or written.
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.from("api_requests").insert({
    request_id: record.requestId,
    client_id: record.clientId,
    user_id: record.userId,
    method: record.method.toUpperCase(),
    path: record.path.slice(0, MAX_PATH),
    status: record.status,
  });

  if (error) {
    console.error(
      `api audit: could not record request ${record.requestId}`,
      error,
    );
  }
}
