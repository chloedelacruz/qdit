import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/types/database";

import type { ClaimedEvent, DeliveryOutcome, Outbox } from "./deliver";

/**
 * The outbox as the cron route reaches it: the two delivery functions of
 * supabase/migrations/20261024130000_integration_webhooks.sql, called with
 * the secret key. They are granted to service_role only, and the tables
 * themselves are closed to every client role, so this is the one path to
 * them. No user token is involved: the route acts for qdit, not for anyone.
 */

/** Longer than one round can take (a 10 s timeout, in parallel). */
export const LEASE_SECONDS = 120;

export function supabaseOutbox(secretKey: string): Outbox {
  const admin = createSupabaseClient<Database>(getSupabaseUrl(), secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async claim(limit: number): Promise<ClaimedEvent[]> {
      const { data, error } = await admin.rpc("claim_integration_events", {
        p_limit: limit,
        p_lease_seconds: LEASE_SECONDS,
      });
      if (error) throw new Error(`webhooks: claim failed: ${error.message}`);
      return data ?? [];
    },

    async record(report): Promise<DeliveryOutcome> {
      const { data, error } = await admin.rpc("record_integration_delivery", {
        p_id: report.id,
        p_claim_token: report.claimToken,
        p_delivered: report.delivered,
        p_error: report.error,
        p_next_attempt_at: report.nextAttemptAt?.toISOString() ?? null,
      });
      if (error) throw new Error(`webhooks: record failed: ${error.message}`);
      return data;
    },
  };
}
