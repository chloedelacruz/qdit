import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StaffEligibilityChips } from "@/components/hackathon/staff-eligibility-chips";
import { StaffLeaderboard } from "@/components/hackathon/staff-leaderboard";
import { StaffPanel } from "@/components/hackathon/staff-panel";
import { StaffPitchOrder } from "@/components/hackathon/staff-pitch-order";
import { StaffReleasePanel } from "@/components/hackathon/staff-release-panel";
import { StaffSubmissionActions } from "@/components/hackathon/staff-submission-actions";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getStaffHackathon,
  getStaffRole,
  loadAdminConsole,
  type AdminSubmission,
} from "@/lib/hackathon/staff-queries";
import {
  formatManila,
  GRADING_STATE_LABEL,
  gradingCounts,
  summariseJobs,
} from "@/lib/hackathon/staff-view";
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
    .map((r) => ({ submission_id: r.submission_id, team_name: r.team_name }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        breadcrumb={[{ label: hackathon.name, href: `/hackathons/${slug}` }]}
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
              <SubmissionsTable
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

function SubmissionsTable({
  slug,
  hackathonId,
  closesAt,
  released,
  rows,
}: {
  slug: string;
  hackathonId: string;
  closesAt: string;
  released: boolean;
  rows: AdminSubmission[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Team</TableHead>
          <TableHead>Project</TableHead>
          <TableHead className="text-right">Version</TableHead>
          <TableHead>Submitted</TableHead>
          <TableHead>Eligibility</TableHead>
          <TableHead>Grading</TableHead>
          <TableHead>Late pass</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const summary = summariseJobs(row.jobs);
          const meta = GRADING_STATE_LABEL[summary.state];
          return (
            <TableRow key={row.submission_id}>
              <TableCell className="max-w-48 truncate font-medium">
                <Link
                  className="transition-qdit hover:text-primary"
                  href={`/hackathons/${slug}/admin/submissions/${row.submission_id}`}
                >
                  {row.team_name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{row.project_slug}</TableCell>
              <TableCell className="text-right tabular-nums">{row.version_no ?? "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatManila(row.submitted_at)}</TableCell>
              <TableCell className="whitespace-normal">
                <StaffEligibilityChips
                  eligibility={row.eligibility}
                  override={row.eligibility_override}
                  overrideReason={row.override_reason}
                />
              </TableCell>
              <TableCell className="whitespace-normal">
                <div className="flex flex-col gap-0.5">
                  <StatusBadge state={meta} className="w-fit" />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {summary.counts.done} done · {summary.counts.pending} pending · {summary.counts.running} running
                    {summary.counts.failed > 0 ? ` · ${summary.counts.failed} failed` : ""}
                    {row.complete === true ? " · complete" : ""}
                  </span>
                  {summary.failedCodes.length > 0 ? (
                    <span className="font-mono text-xs text-destructive">{summary.failedCodes.join(", ")}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.late_pass_until ? formatManila(row.late_pass_until) : "—"}
              </TableCell>
              <TableCell>
                <StaffSubmissionActions
                  hackathonId={hackathonId}
                  submissionId={row.submission_id}
                  projectId={row.project_id}
                  teamName={row.team_name}
                  override={row.eligibility_override}
                  overrideReason={row.override_reason}
                  latePassUntil={row.late_pass_until}
                  closesAt={closesAt}
                  released={released}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
