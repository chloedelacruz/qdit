import { NextResponse } from "next/server";

import { createGraderClient } from "@/lib/hackathon/grader";
import { supabaseGradingStore } from "@/lib/hackathon/grading-store";
import { runSweep, SWEEP_BUDGET_MS } from "@/lib/hackathon/grading-worker";
import { createServiceClient, serviceSecretKey } from "@/lib/hackathon/service-client";
import { isCronAuthorized } from "@/lib/webhooks/cron-auth";

/**
 * `GET /api/cron/grade-hackathon` — works through the hackathon AI review
 * queue (WP-4.7, D-119). Called with `Authorization: Bearer <CRON_SECRET>`
 * every minute by the qdit-grade-hackathon pg_cron job through pg_net
 * (supabase/migrations/20261110100000_hackathons.sql, URL and bearer from
 * Vault), and once a day by Vercel Cron (web/vercel.json) as a backstop: a
 * Hobby project rejects a more frequent Vercel cron. Anything else gets a 401
 * and does nothing. The same check as /api/cron/deliver-webhooks.
 *
 * One run claims and grades for up to 240 s (lib/hackathon/grading-worker.ts);
 * leases keep overlapping runs from grading one job twice. The answer is
 * counts only: never a score, a team or any submission content (D-116).
 *
 * Configuration faults answer 503 and are logged by name, never by value.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, details: null } }, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("grading cron: CRON_SECRET is not set; refusing every call. See web/.env.example.");
    return failure(503, "unavailable", "Hackathon grading is not configured.");
  }
  if (!isCronAuthorized(request.headers.get("authorization"), cronSecret)) {
    return failure(401, "unauthorized", "Missing or wrong cron secret.");
  }

  const secretKey = serviceSecretKey();
  if (!secretKey) {
    console.error("grading cron: SUPABASE_SECRET_KEY is not set. See web/.env.example.");
    return failure(503, "unavailable", "Hackathon grading is not configured.");
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("grading cron: ANTHROPIC_API_KEY is not set. See web/.env.example.");
    return failure(503, "unavailable", "Hackathon grading is not configured.");
  }

  try {
    const counts = await runSweep(
      { budgetMs: SWEEP_BUDGET_MS },
      { store: supabaseGradingStore(createServiceClient(secretKey)), client: createGraderClient(apiKey) },
    );
    return NextResponse.json({ data: counts }, { headers: NO_STORE });
  } catch {
    console.error("grading cron: sweep failed");
    return failure(500, "internal_error", "Hackathon grading run failed.");
  }
}
