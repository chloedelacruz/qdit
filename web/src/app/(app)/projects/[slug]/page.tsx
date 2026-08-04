import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";

import { HashLink } from "@/components/hash-link";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { MilestoneListRow, ProofListRow } from "@/components/rows";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { DEPLOYMENT_STATUS, PROJECT_STATUS } from "@/lib/constants";
import { EMPTY_FILTERS } from "@/lib/filters";
import { ICON } from "@/lib/icons";
import { getProject, listMilestones, listProofs } from "@/lib/queries";
import { NETWORK_LABELS } from "@/lib/stellar";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const project = await getProject((await params).slug);
  return { title: project?.name ?? "Project" };
}

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) notFound();

  // Capped deliberately: an overview that grows without bound stops being one.
  const preview = { ...EMPTY_FILTERS, limit: 4 };
  const [milestones, proofs] = await Promise.all([
    listMilestones({ projectId: project.id }, preview),
    listProofs({ projectId: project.id }, preview),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumb={[{ label: "Projects", href: "/projects" }]}
        title={project.name}
        description={project.description ?? undefined}
        meta={
          <>
            <StatusBadge state={PROJECT_STATUS[project.status]} dot={false} />
            <StatusBadge state={DEPLOYMENT_STATUS[project.deployment]} dot={false} />
          </>
        }
        actions={
          <>
            {project.repoUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={project.repoUrl} target="_blank" rel="noreferrer noopener">
                  Repo
                  <ExternalLink data-icon="inline-end" />
                </a>
              </Button>
            ) : null}
            <Button asChild size="sm">
              <Link href={`/projects/${slug}/board`}>
                Open board
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Tasks"
          value={`${project.doneCount}/${project.taskCount}`}
          progress={project.progress}
          hint={`${Math.round(project.progress * 100)}% complete`}
        />
        <StatTile
          label="Open milestones"
          value={project.openMilestoneCount}
          hint={`${project.milestoneCount} total`}
        />
        <StatTile label="Proof records" value={proofs.total} hint="Attached to this project" />
        <StatTile
          label="Network"
          value={NETWORK_LABELS[project.network]}
          hint={DEPLOYMENT_STATUS[project.deployment].label}
        />
      </div>

      {/* Reference material — looked up, not scanned. Sunken so it stays
          available without competing (spec §Visual Priority). */}
      {project.contractId ? (
        <div className="well mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Contract</span>
          <HashLink
            value={project.contractId}
            kind="contract"
            network={project.network}
            lead={8}
            tail={8}
          />
        </div>
      ) : null}

      {/* Primary: what is still open on this project. */}
      <Section
        priority
        className="mt-6"
        icon={ICON.milestone}
        title="Milestones"
        count={milestones.total}
        href={`/projects/${slug}/milestones`}
        empty="No milestones yet."
      >
        {milestones.rows.map((milestone) => (
          <MilestoneListRow key={milestone.id} milestone={milestone} />
        ))}
      </Section>

      <Section
        className="mt-6"
        icon={ICON.proof}
        title="Recent proof"
        count={proofs.total}
        href={`/projects/${slug}/proofs`}
        empty="No proof recorded yet."
      >
        {proofs.rows.map((proof) => (
          <ProofListRow key={proof.id} proof={proof} />
        ))}
      </Section>
    </div>
  );
}
