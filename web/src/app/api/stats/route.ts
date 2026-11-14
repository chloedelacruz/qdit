import { chainConfig } from "@/lib/chain/client";
import { createServiceClient, serviceSecretKey } from "@/lib/hackathon/service-client";
import { loadSiteStats } from "@/lib/site-stats";

export const runtime = "nodejs";

/**
 * Public, signed-out totals for the landing page: sign-ups, projects, tasks
 * and the average anchor fee. Only counts leave the server, never rows, so
 * the service-role client is safe here. The CDN caches it briefly so visitors
 * polling the page share one Supabase and Horizon read.
 */
export async function GET() {
  const secret = serviceSecretKey();
  if (!secret) return unavailable("no service key");
  try {
    const network = chainConfig()?.network ?? "testnet";
    const stats = await loadSiteStats(createServiceClient(secret), network);
    return Response.json(stats, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" },
    });
  } catch (e) {
    return unavailable((e as Error).message);
  }
}

function unavailable(reason: string) {
  console.error(`[stats] ${reason}`);
  return Response.json(
    { error: "Stats are unavailable right now." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
