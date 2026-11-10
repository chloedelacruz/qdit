import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { ManageHackathons } from "@/components/hackathon/manage-hackathons";
import { loadManagePage } from "@/lib/hackathon/manage-queries";
import { createClient, getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Manage hackathons" };

/**
 * Create, edit, hide and delete hackathons (WP-4.7, QDIT-56).
 *
 * qdit operators see every hackathon and may create and delete; a
 * hackathon's admins see theirs and may edit and hide them. Anyone else gets
 * the 404 an unknown page gives, so the page's existence says nothing.
 */
export default async function ManageHackathonsPage() {
  const [user, supabase] = await Promise.all([getUser(), createClient()]);
  if (!user) notFound();

  const { hackathons, isOperator, nowMs } = await loadManagePage(supabase);
  if (!isOperator && hackathons.length === 0) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Manage hackathons"
        breadcrumb={[{ label: "Hackathons", href: "/hackathons" }]}
        info="Create, edit, hide and delete hackathons. Hidden ones stay out of the Hackathons list and the banner but still open by link. Only a hackathon no team has sent work to can be deleted."
      />
      <ManageHackathons hackathons={hackathons} isOperator={isOperator} nowMs={nowMs} />
    </div>
  );
}
