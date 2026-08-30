import { getAnchorExport } from "@/lib/queries";
import { buildAnchorCsv } from "@/lib/export";
import { getUser } from "@/lib/supabase/server";

/**
 * The anchor table as a CSV download (FEEDBACK-PLAN §P1).
 *
 * A route rather than a server action because the point is a file: the response
 * carries `Content-Disposition: attachment`, and the browser saves it. Auth is
 * the same gate the rest of the app uses, and the query underneath runs as the
 * caller, so RLS decides what is in the file — a non-member gets a 404, not an
 * empty spreadsheet that admits the project exists.
 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return new Response("Not signed in.", { status: 401 });
  }

  const slug = new URL(request.url).searchParams.get("project")?.trim();
  if (!slug) {
    return new Response("Missing project.", { status: 400 });
  }

  const data = await getAnchorExport(slug);
  if (!data) {
    return new Response("Not found.", { status: 404 });
  }

  const csv = buildAnchorCsv(data);
  const filename = `qdit-anchors-${safeSlug(slug)}-${today()}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // A record of what was on chain at export time; never a cached response.
      "cache-control": "no-store",
    },
  });
}

/** A slug is already `[a-z0-9-]`, but a filename is not a place to assume that. */
function safeSlug(slug: string): string {
  return slug.replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || "project";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
