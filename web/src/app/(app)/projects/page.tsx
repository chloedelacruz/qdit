import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { HashLink } from "@/components/hash-link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DEPLOYMENT_STATUS, PROJECT_STATUS } from "@/lib/constants";
import { NETWORK_LABELS } from "@/lib/stellar";
import { DEMO_PROJECTS } from "@/lib/placeholder-data";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Projects"
        description="Every build, with its milestones, deployment state and on-chain proof."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            New project
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2">
        {DEMO_PROJECTS.map((project) => (
          <Card key={project.id} className="hover-lift">
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/projects/${project.slug}`} className="font-medium hover:underline">
                  {project.name}
                </Link>
                <StatusBadge state={PROJECT_STATUS[project.status]} />
              </div>

              <p className="text-sm text-muted-foreground">{project.description}</p>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge state={DEPLOYMENT_STATUS[project.deployment]} />
                <span className="text-xs text-muted-foreground">
                  {NETWORK_LABELS[project.network]}
                </span>
              </div>

              {project.contractId ? (
                <HashLink value={project.contractId} kind="contract" network={project.network} />
              ) : null}

              <p className="text-xs text-muted-foreground tabular-nums">
                {project.doneCount}/{project.taskCount} tasks · {project.milestoneCount} milestones
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
