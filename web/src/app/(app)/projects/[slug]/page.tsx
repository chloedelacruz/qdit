import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";

import { ProjectRowActions } from "@/components/entity-row-actions";
import { HashLink } from "@/components/hash-link";
import { PageHeader } from "@/components/page-header";
import { ProjectChainRegistration } from "@/components/project-chain";
import { ProjectPublishing } from "@/components/project-publishing";
import { Section } from "@/components/section";
import { MilestoneListRow, ProofListRow } from "@/components/rows";
import { StatTile } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { DEPLOYMENT_STATUS, PROJECT_STATUS } from "@/lib/constants";
import { EMPTY_FILTERS } from "@/lib/filters";
import { ICON } from "@/lib/icons";
import {
  canAdminister,
  getCurrentUserId,
  getProject,
  getProjectRole,
  listMilestones,
  listProofs,
} from "@/lib/queries";
import { NETWORK_LABELS } from "@/lib/stellar";

/** Anchoring is off unless this deployment names a contract. */
const ANCHORING = Boolean(process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID);

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
  const [milestones, proofs, role, userId] = await Promise.all([
    listMilestones({ projectId: project.id }, preview),
    listProofs({ projectId: project.id }, preview),
    getProjectRole(project.id),
    getCurrentUserId(),
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
            {/* The three external destinations a project can carry. Each is
                optional, so the row collapses to whatever was actually filled
                in rather than showing dead buttons. */}
            {project.repoUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={project.repoUrl} target="_blank" rel="noreferrer noopener">
                  Repo
                  <ExternalLink data-icon="inline-end" />
                </a>
              </Button>
            ) : null}
            {project.docsUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={project.docsUrl} target="_blank" rel="noreferrer noopener">
                  Docs
                  <ExternalLink data-icon="inline-end" />
                </a>
              </Button>
            ) : null}
            {project.demoUrl ? (
              <Button asChild variant="outline" size="sm">
                <a href={project.demoUrl} target="_blank" rel="noreferrer noopener">
                  Demo
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
            {/* Editing and deleting the project itself live here rather than on
                its row in the index — this page is the project. */}
            <ProjectRowActions
              project={project}
              canAdminister={canAdminister(role)}
              persistent
            />
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

      {/* On-chain registration. Sunken like the contract row above it: this is
          a fact you look up, not one you scan for — except once, when the owner
          has to act on it. */}
      {ANCHORING ? (
        <div className="well mt-2 rounded-xl border border-border px-3 py-2">
          <ProjectChainRegistration
            projectId={project.id}
            network={project.network}
            registration={project.chainRegistration}
            isOwner={project.ownerId === userId}
          />
        </div>
      ) : null}

      {/* Publishing. Sunken with the other reference rows, and directly under
          the registration it depends on: a public proof page is only worth
          anything once something has been anchored. */}
      <div className="well mt-2 rounded-xl border border-border px-3 py-2">
        <ProjectPublishing
          projectId={project.id}
          publicProofs={project.publicProofs}
          canEdit={canAdminister(role)}
        />
      </div>

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
