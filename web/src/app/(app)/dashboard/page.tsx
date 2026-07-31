import type { Metadata } from "next";
import Link from "next/link";

import { HashLink } from "@/components/hash-link";
import { PageHeader } from "@/components/page-header";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DEPLOYMENT_STATUS, MILESTONE_STATUS, PROJECT_STATUS } from "@/lib/constants";
import { DEMO_MILESTONES, DEMO_PROJECTS } from "@/lib/placeholder-data";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const totalTasks = DEMO_PROJECTS.reduce((sum, p) => sum + p.taskCount, 0);
  const doneTasks = DEMO_PROJECTS.reduce((sum, p) => sum + p.doneCount, 0);
  const activeMilestones = DEMO_MILESTONES.filter(
    (m) => m.status === "proposed" || m.status === "submitted",
  ).length;
  const liveDeployments = DEMO_PROJECTS.filter((p) => p.deployment === "mainnet_live").length;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Dashboard"
        description="Build progress, milestone state and deployment proof across every project."
        actions={
          <Button asChild>
            <Link href="/projects">View projects</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total tasks" value={totalTasks} hint={`${DEMO_PROJECTS.length} projects`} />
        <StatTile
          label="Completed"
          value={doneTasks}
          progress={totalTasks === 0 ? 0 : doneTasks / totalTasks}
          hint={`${Math.round((doneTasks / totalTasks) * 100)}% of all tasks`}
        />
        <StatTile label="Active milestones" value={activeMilestones} hint="Proposed or submitted" />
        <StatTile label="Live on Mainnet" value={liveDeployments} hint="Contracts serving traffic" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Projects</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul>
              {DEMO_PROJECTS.map((project, index) => (
                <li key={project.id}>
                  {index > 0 ? <Separator /> : null}
                  <Link
                    href={`/projects/${project.slug}`}
                    className="transition-qdit block px-4 py-3.5 hover:bg-muted/50"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{project.name}</span>
                      <StatusBadge state={PROJECT_STATUS[project.status]} />
                      <StatusBadge
                        state={DEPLOYMENT_STATUS[project.deployment]}
                        className="ml-auto"
                      />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
                    <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                      {project.doneCount}/{project.taskCount} tasks · {project.milestoneCount}{" "}
                      milestones
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Milestone proof</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {DEMO_MILESTONES.map((milestone) => (
              <div key={milestone.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{milestone.title}</span>
                  <StatusBadge state={MILESTONE_STATUS[milestone.status]} />
                </div>
                <p className="text-xs text-muted-foreground">{milestone.project}</p>
                {milestone.txHash ? (
                  <HashLink value={milestone.txHash} kind="tx" network={milestone.network} />
                ) : (
                  <p className="text-xs text-muted-foreground italic">No proof attached yet</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
