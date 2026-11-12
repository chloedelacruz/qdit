import { getStaffHackathon, getStaffRole } from "@/lib/hackathon/staff-queries";
import { loadSubmissionsExport, submissionsCsv } from "@/lib/hackathon/submissions-export";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Every entry's team name, Slides link and mindmap image links as CSV, for
 * the organisers (WP-4.7, QDIT-63, D-123).
 *
 * A first-party cookie-session route, like the results export beside it:
 * anyone who is not this hackathon's admin, signed out included, gets the
 * same 404 as an unknown slug. Unlike the results export it works before
 * release: nothing in it is score-derived.
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

  const rows = await loadSubmissionsExport(supabase, hackathon.id);
  const filename = `${hackathon.slug.replace(/[^a-z0-9-]/g, "-")}-submissions.csv`;

  return new Response(submissionsCsv(rows), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // The file holds signed links: never cached anywhere on the way.
      "cache-control": "no-store",
    },
  });
}
