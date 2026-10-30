import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { doqtriOrigin } from "@/lib/doqtri-origin";
import { getSupabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/types/database";

/**
 * Whether this deployment's `DOQTRI_ORIGIN` and its database's
 * `integration_settings.doqtri_origin` are the same origin (D-95, contract
 * section 1). The API checks a `doc_url` against the env var and
 * `link_project_doc()` against the column, so when they differ every doc link
 * is refused; while the column is unset only the API's check runs. SQL cannot
 * read the env, so the comparison is made here, from
 * `doqtri_origin_setting()` of
 * supabase/migrations/20261026120000_doqtri_origin_doc_url_check.sql, called
 * with the secret key like webhook_scheduler_health().
 *
 *   match      both are the same origin;
 *   differs    both are set and they are not;
 *   unset      the column is null, so the database checks nothing;
 *   unknown    the check failed, or `DOQTRI_ORIGIN` is not an https origin
 *              (both logged), so nothing is claimed.
 *
 * The webhook cron route reports it with every run and logs a warning for
 * anything but `match`, next to the scheduler's (lib/webhooks/scheduler-health.ts):
 * that is the log an operator already reads, and qdit has no settings page.
 */

export type DoqtriOriginHealth = {
  status: "match" | "differs" | "unset" | "unknown";
  /** `integration_settings.doqtri_origin`, or null when unset or unread. */
  database: string | null;
  /** `DOQTRI_ORIGIN` as the API applies it (the default when unset), or null when misconfigured. */
  env: string | null;
};

/** The comparison, from the function's answer and the env value. Pure. */
export function compareDoqtriOrigins(database: unknown, envValue: string | undefined): DoqtriOriginHealth {
  let env: string;
  try {
    env = doqtriOrigin(envValue);
  } catch (error) {
    console.error("doqtri origin:", error instanceof Error ? error.message : error);
    return { status: "unknown", database: typeof database === "string" ? database : null, env: null };
  }
  if (database === null) return { status: "unset", database: null, env };
  if (typeof database !== "string") return { status: "unknown", database: null, env };
  return { status: database === env ? "match" : "differs", database, env };
}

/** One line for the log, or null when there is nothing to warn about. */
export function doqtriOriginWarning(health: DoqtriOriginHealth): string | null {
  switch (health.status) {
    case "match":
      return null;
    case "differs":
      return `doqtri origin: DOQTRI_ORIGIN is ${health.env} but integration_settings.doqtri_origin is ${health.database}, so link_project_doc() refuses every doc link the API accepts. Set both to doqtri's origin; see docs/integration/qdit-oauth-setup.md.`;
    case "unset":
      return `doqtri origin: integration_settings.doqtri_origin is not set, so link_project_doc() does not check doc_url; only the API's DOQTRI_ORIGIN (${health.env}) check runs. Set it to the same value; see docs/integration/qdit-oauth-setup.md.`;
    case "unknown":
      return "doqtri origin: could not compare DOQTRI_ORIGIN with integration_settings.doqtri_origin.";
  }
}

/** Never throws: a failed check is `unknown`. */
export async function readDoqtriOriginHealth(
  secretKey: string,
  envValue: string | undefined = process.env.DOQTRI_ORIGIN,
): Promise<DoqtriOriginHealth> {
  try {
    const admin = createSupabaseClient<Database>(getSupabaseUrl(), secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("doqtri_origin_setting");
    if (error) {
      console.error("doqtri origin: reading integration_settings.doqtri_origin failed:", error.message);
      return { status: "unknown", database: null, env: null };
    }
    return compareDoqtriOrigins(data, envValue);
  } catch (error) {
    console.error(
      "doqtri origin: reading integration_settings.doqtri_origin failed:",
      error instanceof Error ? error.message : error,
    );
    return { status: "unknown", database: null, env: null };
  }
}
