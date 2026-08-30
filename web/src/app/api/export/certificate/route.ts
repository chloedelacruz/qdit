import { getMilestoneExport } from "@/lib/queries";
import { buildCertificateHtml } from "@/lib/export";
import { getUser } from "@/lib/supabase/server";

/**
 * A per-milestone proof certificate as a downloadable file (FEEDBACK-PLAN §P1).
 *
 * One self-contained HTML document — see `buildCertificateHtml`. Served as an
 * attachment so it lands as a file a regulated tester can archive, rather than
 * rendering in the tab. Same auth gate and same RLS-decides-contents rule as
 * the CSV route beside it.
 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return new Response("Not signed in.", { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const slug = params.get("project")?.trim();
  const milestoneId = params.get("milestone")?.trim();
  if (!slug || !milestoneId) {
    return new Response("Missing project or milestone.", { status: 400 });
  }

  const cert = await getMilestoneExport(slug, milestoneId);
  if (!cert) {
    return new Response("Not found.", { status: 404 });
  }

  const html = buildCertificateHtml(cert);
  const filename = `qdit-certificate-${safeSlug(slug)}-${milestoneId.slice(0, 8)}.html`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

function safeSlug(slug: string): string {
  return slug.replace(/[^a-z0-9-]/gi, "-").slice(0, 60) || "project";
}
