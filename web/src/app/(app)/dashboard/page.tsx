import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import {
  MilestoneListRow,
  ProjectListRow,
  ProofListRow,
  TaskListRow,
} from "@/components/rows";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";
import { EMPTY_FILTERS } from "@/lib/filters";
import {
  getCurrentUserId,
  getWorkspaceSummary,
  listMilestones,
  listProjects,
  listProofs,
  listTasks,
} from "@/lib/queries";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  // Every panel here is explicitly capped. A dashboard that grows with the
  // workspace stops being an overview and becomes a worse projects page.
  const userId = await getCurrentUserId();

  const [summary, projects, myTasks, attention, proofs] = await Promise.all([
    getWorkspaceSummary(),
    listProjects({ ...EMPTY_FILTERS, status: ["active"], limit: 5 }),
    listTasks(
      {},
      {
        ...EMPTY_FILTERS,
        assignee: userId ? [userId] : [],
        status: ["todo", "in_progress"],
        sort: "due",
        limit: 5,
      },
    ),
    listMilestones({}, { ...EMPTY_FILTERS, status: ["submitted"], limit: 4 }),
    // Already ordered newest-first by `listProofs`, so the cap is the whole
    // filter: the last few things this workspace put on-chain.
    listProofs({}, { ...EMPTY_FILTERS, limit: 4 }),
  ]);

  const progress = summary.taskCount === 0 ? 0 : summary.doneCount / summary.taskCount;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Dashboard"
        description="Build progress, milestone state and deployment proof across every project."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/projects">All projects</Link>
          </Button>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Assigned to me"
          value={summary.myOpenTaskCount}
          hint="Open tasks"
        />
        <StatTile
          label="Tasks complete"
          value={`${summary.doneCount}/${summary.taskCount}`}
          progress={progress}
          hint={`${Math.round(progress * 100)}% across ${summary.projectCount} projects`}
        />
        <StatTile
          label="Open milestones"
          value={summary.openMilestoneCount}
          hint="Proposed or submitted"
        />
        <StatTile
          label="Live on Mainnet"
          value={summary.mainnetLiveCount}
          hint="Contracts serving traffic"
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* The page's primary object: what this person has to do next.
            Everything else on the dashboard is context for it. */}
        <Section
          priority
          icon={ICON.assignedToMe}
          title="My open tasks"
          count={summary.myOpenTaskCount}
          href={`/tasks?assignee=${userId ?? ""}&status=todo,in_progress`}
          empty="Nothing assigned to you right now."
        >
          {myTasks.rows.map((task) => (
            <TaskListRow key={task.id} task={task} showProject />
          ))}
        </Section>

        <Section
          icon={ICON.awaiting}
          title="Awaiting approval"
          count={summary.openMilestoneCount}
          href="/milestones?status=submitted"
          empty="No milestones are waiting on a reviewer."
        >
          {attention.rows.map((milestone) => (
            <MilestoneListRow key={milestone.id} milestone={milestone} showProject />
          ))}
        </Section>
      </div>

      <Section
        className="mt-5"
        icon={ICON.project}
        title="Active projects"
        count={summary.activeProjectCount}
        href="/projects?status=active"
        empty="No active projects."
      >
        {projects.rows.map((project) => (
          <ProjectListRow key={project.id} project={project} />
        ))}
      </Section>

      {/* The claim the product makes, in the rollup that summarises it: what
          has actually been recorded on-chain lately. Read-only like every row
          on this page — each proof is editable from the registry it lives in. */}
      <Section
        className="mt-5"
        icon={ICON.proof}
        title="Recent proof"
        count={proofs.total}
        href="/proofs"
        empty="No proof recorded yet."
      >
        {proofs.rows.map((proof) => (
          <ProofListRow key={proof.id} proof={proof} showProject />
        ))}
      </Section>
    </div>
  );
}
