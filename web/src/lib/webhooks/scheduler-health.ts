import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/types/database";

/**
 * Whether the database's pg_cron job can deliver webhooks (D-57):
 * `webhook_scheduler_health()` of
 * supabase/migrations/20261025090000_integration_hardening.sql, called with
 * the secret key like the outbox functions.
 *
 *   configured    the job is active and Vault holds both its secrets;
 *   missing       the job is inactive or a secret is missing (named);
 *   unavailable   this database has no pg_cron, pg_net or Vault;
 *   unknown       the check itself failed (logged), so nothing is claimed.
 *
 * Anything but `configured` means only the daily Vercel cron delivers. The
 * cron route returns this with every run and logs it, which is where an
 * operator sees it: qdit has no webhook settings page.
 */

export type SchedulerHealth = {
  status: "configured" | "missing" | "unavailable" | "unknown";
  job: boolean | null;
  missingSecrets: string[];
};

const UNKNOWN: SchedulerHealth = { status: "unknown", job: null, missingSecrets: [] };

const STATUSES = new Set(["configured", "missing", "unavailable"]);

/** The function's jsonb, checked; anything unexpected reads as `unknown`. */
export function parseSchedulerHealth(value: unknown): SchedulerHealth {
  if (typeof value !== "object" || value === null) return UNKNOWN;
  const { status, job, missing_secrets: missing } = value as Record<string, unknown>;
  if (typeof status !== "string" || !STATUSES.has(status)) return UNKNOWN;
  if (typeof job !== "boolean") return UNKNOWN;
  if (!Array.isArray(missing) || !missing.every((name) => typeof name === "string")) return UNKNOWN;
  return { status: status as SchedulerHealth["status"], job, missingSecrets: missing };
}

/** One line for the log, or null when there is nothing to warn about. */
export function schedulerWarning(health: SchedulerHealth): string | null {
  switch (health.status) {
    case "configured":
      return null;
    case "missing":
      return health.missingSecrets.length > 0
        ? `webhooks cron: the pg_cron delivery job sends nothing until Vault holds ${health.missingSecrets.join(", ")}; only the daily Vercel cron delivers. See supabase/migrations/20261024130000_integration_webhooks.sql section 8.`
        : "webhooks cron: the pg_cron delivery job qdit-deliver-webhooks is missing or inactive; only the daily Vercel cron delivers.";
    case "unavailable":
      return "webhooks cron: this database has no pg_cron, pg_net or Vault; only the daily Vercel cron delivers.";
    case "unknown":
      return "webhooks cron: could not read the pg_cron delivery job's health.";
  }
}

/** Never throws: a failed check is `unknown`, and delivery goes on. */
export async function readSchedulerHealth(secretKey: string): Promise<SchedulerHealth> {
  try {
    const admin = createSupabaseClient<Database>(getSupabaseUrl(), secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("webhook_scheduler_health");
    if (error) {
      console.error("webhooks cron: scheduler health check failed:", error.message);
      return UNKNOWN;
    }
    return parseSchedulerHealth(data);
  } catch (error) {
    console.error("webhooks cron: scheduler health check failed:", error instanceof Error ? error.message : error);
    return UNKNOWN;
  }
}
