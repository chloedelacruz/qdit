import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/webhooks/cron-auth";
import { deliverDueEvents } from "@/lib/webhooks/deliver";
import { supabaseOutbox } from "@/lib/webhooks/outbox";
import { parseEncryptionKey } from "@/lib/webhooks/secret-box";

/**
 * `GET /api/cron/deliver-webhooks` — sends due webhook events to doqtri
 * (docs/integration/CONTRACT.md section 9). Called every minute by Vercel
 * Cron (web/vercel.json) with `Authorization: Bearer <CRON_SECRET>`; anything
 * else gets a 401 and does nothing.
 *
 * One run claims and sends until nothing is due or the time budget is spent,
 * so an event released by its predecessor's delivery goes out in the same
 * run. The next run picks up the rest; leases keep two overlapping runs from
 * sending one event twice (supabase/migrations/20261024130000_integration_webhooks.sql).
 *
 * Configuration faults answer 503 and are logged by name, never by value.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** No new claim round starts after this much of the run. */
const RUN_BUDGET_MS = 40_000;

const NO_STORE = { "Cache-Control": "no-store" };

function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, details: null } }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("webhooks cron: CRON_SECRET is not set; refusing every call. See web/.env.example.");
    return failure(503, "unavailable", "Webhook delivery is not configured.");
  }
  if (!isCronAuthorized(request.headers.get("authorization"), cronSecret)) {
    return failure(401, "unauthorized", "Missing or wrong cron secret.");
  }

  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey) {
    console.error("webhooks cron: SUPABASE_SECRET_KEY is not set. See web/.env.example.");
    return failure(503, "unavailable", "Webhook delivery is not configured.");
  }

  let encryptionKey: Buffer;
  try {
    encryptionKey = parseEncryptionKey(process.env.INTEGRATION_WEBHOOK_ENCRYPTION_KEY);
  } catch (error) {
    console.error("webhooks cron:", error instanceof Error ? error.message : error);
    return failure(503, "unavailable", "Webhook delivery is not configured.");
  }

  try {
    const summary = await deliverDueEvents({
      outbox: supabaseOutbox(secretKey),
      fetch,
      encryptionKey,
      deadline: Date.now() + RUN_BUDGET_MS,
    });
    return NextResponse.json({ data: summary }, { headers: NO_STORE });
  } catch (error) {
    console.error("webhooks cron: delivery run failed", error);
    return failure(500, "internal_error", "Webhook delivery run failed.");
  }
}
