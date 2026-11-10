import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StaffLeaderboard } from "@/components/hackathon/staff-leaderboard";
import { StaffPanel } from "@/components/hackathon/staff-panel";
import { StaffPitchOrder } from "@/components/hackathon/staff-pitch-order";
import { StaffReleasePanel } from "@/components/hackathon/staff-release-panel";
import { StaffSubmissionsTable } from "@/components/hackathon/staff-submissions-table";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getStaffHackathon, getStaffRole, loadAdminConsole } from "@/lib/hackathon/staff-queries";
import { formatManila, gradingCounts, toPlainText } from "@/lib/hackathon/staff-view";
import { ICON } from "@/lib/icons";
import { createClient, getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Hackathon admin" };

/**
 * The hackathon admin console (WP-4.7, QDIT-48; D-115, D-116, D-119).
 *
 * Hackathon admins only: anyone else, judges included, gets the same 404 as
 * an unknown slug. Before release the page shows entries, eligibility, job
 * states, staff and the Release panel, and nothing score-derived: the
 * leaderboard RPC is not even called (loadAdminConsole). After release it
 * adds the ranked leaderboard, the pitch order and the CSV export.
 */
export default async function HackathonAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getUser();
  if (!user) notFound();

  const supabase = await createClient();
  const hackathon = await getStaffHackathon(supabase, slug);
  if (!hackathon) notFound();
  if ((await getStaffRole(supabase, hackathon.id, user.id)) !== "admin") notFound();

  const { submissions, staff, leaderboard } = await loadAdminConsole(supabase, hackathon);
  const released = hackathon.released_at != null;
  // eslint-disable-next-line react-hooks/purity -- a request-time render; the panel re-ticks on the client.
  const serverNow = Date.now();

  const finalists = (leaderboard ?? [])
    .filter((r) => r.finalist)
    .sort(
      (a, b) =>
        (a.pitch_order ?? Number.MAX_SAFE_INTEGER) - (b.pitch_order ?? Number.MAX_SAFE_INTEGER) ||
        (a.ai_rank ?? 0) - (b.ai_rank ?? 0),
    )
    .map((r) => ({ submission_id: r.submission_id, team_name: toPlainText(r.team_name, 80) }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Hackathons", href: "/hackathons" }, { label: hackathon.name, href: `/hackathons/${slug}` }]}
        title="Admin"
        info="Entries, eligibility and grading for this hackathon. Grades stay sealed for everyone until an admin releases them; after release only admins see them."
        meta={
          released ? (
            <StatusBadge state={{ label: `Released ${formatManila(hackathon.released_at)}`, tone: "success" }} />
          ) : (
            <StatusBadge state={{ label: "Sealed", tone: "neutral" }} />
          )
        }
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href={`/hackathons/${slug}/judge`}>Judging</Link>
            </Button>
            {released ? (
              <Button asChild size="sm">
                <a href={`/api/hackathons/${slug}/export`} download>
                  <ICON.download data-icon="inline-start" />
                  Export CSV
                </a>
              </Button>
            ) : null}
          </>
        }
      />

      {released ? (
        <Section
          priority
          icon={ICON.dashboard}
          title="Leaderboard"
          count={leaderboard?.length ?? 0}
          empty="No entries."
        >
          {leaderboard && leaderboard.length > 0 ? [<StaffLeaderboard key="board" slug={slug} rows={leaderboard} />] : []}
        </Section>
      ) : (
        <Section priority icon={ICON.locked} title="Release grades" empty="">
          <StaffReleasePanel
            hackathonId={hackathon.id}
            slug={hackathon.slug}
            closesAt={hackathon.closes_at}
            serverNow={serverNow}
            counts={gradingCounts(submissions)}
            entries={submissions.length}
          />
        </Section>
      )}

      {released ? (
        <Section icon={ICON.milestone} title="Pitch order" count={finalists.length} empty="No finalists.">
          {finalists.length > 0 ? [<StaffPitchOrder key="pitch" hackathonId={hackathon.id} finalists={finalists} />] : []}
        </Section>
      ) : null}

      <Section icon={ICON.project} title="Submissions" count={submissions.length} empty="No entries yet.">
        {submissions.length > 0
          ? [
              <StaffSubmissionsTable
                key="table"
                slug={slug}
                hackathonId={hackathon.id}
                closesAt={hackathon.closes_at}
                released={released}
                rows={submissions}
              />,
            ]
          : []}
      </Section>

      <Section icon={ICON.members} title="Staff" count={staff.length} empty="No staff.">
        <StaffPanel hackathonId={hackathon.id} staff={staff} currentUserId={user.id} />
      </Section>
    </div>
  );
}
