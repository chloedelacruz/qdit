import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/types/database";

/**
 * The Supabase service-role client for the hackathon grader (WP-4.7, D-116).
 *
 * The same ad-hoc pattern as `lib/public-node.ts`: qdit acting for itself,
 * not for a user. The grading queue RPCs (claim_grading_jobs and friends) and
 * the sealed tables (hackathon_ai_runs, hackathon_grading_jobs) are granted
 * to service_role only, and the mindmap bucket is private. Server code only;
 * never import this into a Client Component.
 */

/** `SUPABASE_SECRET_KEY`, or the legacy `SUPABASE_SERVICE_ROLE_KEY`; null when neither is set. */
export function serviceSecretKey(): string | null {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
}

/** A fresh service-role client. Per call, never a visitor's session. */
export function createServiceClient(secret: string): SupabaseClient<Database> {
  return createSupabaseClient<Database>(getSupabaseUrl(), secret, {
    // None is read or written.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
