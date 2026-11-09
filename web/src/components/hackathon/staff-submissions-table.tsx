import Link from "next/link";

import { StaffEligibilityChips } from "@/components/hackathon/staff-eligibility-chips";
import { StaffSubmissionActions } from "@/components/hackathon/staff-submission-actions";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminSubmission } from "@/lib/hackathon/staff-queries";
import {
  formatManila,
  GRADING_STATE_LABEL,
  summariseJobs,
  toPlainText,
} from "@/lib/hackathon/staff-view";

/**
 * The admin submissions table (WP-4.7, QDIT-48): team, project, version,
 * submitted, eligibility chips, grading progress (job states only, never a
 * score), late pass and the row's controls. Team content goes through
 * toPlainText.
 */
export function StaffSubmissionsTable({
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
                  {toPlainText(row.team_name, 80)}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{toPlainText(row.project_slug, 64)}</TableCell>
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
