import { toCsv } from "@/lib/hackathon/leaderboard";
import { getStaffHackathon, getStaffRole, loadLeaderboard } from "@/lib/hackathon/staff-queries";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * The released results as CSV, for the organisers' slides (WP-4.7, QDIT-48;
 * D-116, D-119).
 *
 * A first-party cookie-session route, not /api/v1: no OAuth token ever
 * reaches grades. Anyone who is not this hackathon's admin, signed out
 * included, gets the same 404 as an unknown slug, so the route does not
 * admit the hackathon has an admin console. Before release it is refused
 * (409) without asking for the leaderboard at all.
 *
 * The rows are hackathon_leaderboard's, ranked by rankFinal and written by
 * toCsv: the same order the admin page shows.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const notFound = () => new Response("Not found.", { status: 404 });

  const user = await getUser();
  if (!user) return notFound();

  const supabase = await createClient();
  const hackathon = await getStaffHackathon(supabase, slug);
  if (!hackathon) return notFound();
  if ((await getStaffRole(supabase, hackathon.id, user.id)) !== "admin") return notFound();

  if (hackathon.released_at == null) {
    return new Response("Grades are sealed until release.", { status: 409 });
  }

  const rows = await loadLeaderboard(supabase, hackathon.id);
  const filename = `${hackathon.slug.replace(/[^a-z0-9-]/g, "-")}-results.csv`;

  return new Response(toCsv(rows), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
