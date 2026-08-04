import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DataList } from "@/components/data-list";
import { CreateDeploymentDialog } from "@/components/entity-dialogs";
import { DeploymentRowActions } from "@/components/entity-row-actions";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { DeploymentListRow } from "@/components/rows";
import { StatusBadge } from "@/components/status-badge";
import { DEPLOYMENT_STATUS, DEPLOYMENT_STATUS_ORDER } from "@/lib/constants";
import { ICON } from "@/lib/icons";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { canAdminister, getProject, getProjectRole, listDeployments } from "@/lib/queries";
import { NETWORK_LABELS } from "@/lib/stellar";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Deployments" };

export default async function ProjectDeploymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) notFound();

  const filters = parseFilters(await searchParams);
  // Project scope returns the full append-only history, not just current state.
  const [page, role] = await Promise.all([
    listDeployments({ projectId: project.id }, filters),
    getProjectRole(project.id),
  ]);

  // "deployments: insert as member", but update/delete are admin-only. Recording
  // a release is the only write here, so membership is the bar for the button.
  const canRecord = role !== null && role !== "viewer";
  const canRemove = canAdminister(role);
  const stageIndex = DEPLOYMENT_STATUS_ORDER.indexOf(project.deployment);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${slug}` },
        ]}
        title="Deployments"
        description="The full release history, newest first."
        meta={<StatusBadge state={DEPLOYMENT_STATUS[project.deployment]} dot={false} />}
        actions={canRecord ? <CreateDeploymentDialog projectId={project.id} /> : undefined}
      />

      {/* Pipeline: not started → testnet → ready for mainnet → live. */}
      <ol
        data-slot="deploy-pipeline"
        aria-label={`${project.name} deployment pipeline`}
        className="mb-6 flex items-center gap-1.5"
      >
        {DEPLOYMENT_STATUS_ORDER.map((stage, index) => (
          <li
            key={stage}
            data-slot="deploy-stage"
            data-reached={index <= stageIndex}
            className="flex-1"
          >
            <span className="sr-only">{DEPLOYMENT_STATUS[stage].label}</span>
            <span
              aria-hidden
              className={cn(
                "transition-qdit block h-1 rounded-full",
                index <= stageIndex ? "bg-primary" : "well",
              )}
            />
          </li>
        ))}
      </ol>

      <FilterBar
        filters={filters}
        placeholder="Search release notes or paste a tx hash…"
        sorts={["updated"]}
        facets={[
          {
            key: "status",
            label: "Stage",
            options: Object.entries(DEPLOYMENT_STATUS).map(([value, meta]) => ({
              value,
              label: meta.label,
            })),
          },
          {
            key: "network",
            label: "Network",
            options: Object.entries(NETWORK_LABELS).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
      />

      <DataList
        filters={filters}
        total={page.total}
        matched={page.matched}
        shown={page.rows.length}
        noun="deployments"
        empty={{
          icon: ICON.deployment,
          title: "Not deployed yet",
          description:
            "Once this contract reaches Testnet, record its ID and transaction hash to start the history.",
          action: canRecord ? (
            <CreateDeploymentDialog
              projectId={project.id}
              label="Record the first deployment"
            />
          ) : undefined,
        }}
      >
        {page.rows.map((deployment) => (
          <DeploymentListRow
            key={deployment.id}
            deployment={deployment}
            actions={
              <DeploymentRowActions deployment={deployment} canAdminister={canRemove} />
            }
          />
        ))}
      </DataList>
    </div>
  );
}
