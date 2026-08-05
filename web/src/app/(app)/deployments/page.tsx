import type { Metadata } from "next";

import { DataList } from "@/components/data-list";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { DeploymentRowActions } from "@/components/entity-row-actions";
import { DeploymentListRow } from "@/components/rows";
import { DEPLOYMENT_STATUS } from "@/lib/constants";
import { ICON } from "@/lib/icons";
import { parseFilters, type SearchParams } from "@/lib/filters";
import {
  canAdminister,
  listDeployments,
  listProjectOptions,
  listProjectRoles,
} from "@/lib/queries";
import { NETWORK_LABELS } from "@/lib/stellar";

export const metadata: Metadata = { title: "All deployments" };

export default async function AllDeploymentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = parseFilters(await searchParams);
  // Unscoped: current state per project. Full history lives on the project.
  const [page, projects, roles] = await Promise.all([
    listDeployments({}, filters),
    listProjectOptions(),
    listProjectRoles(),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="All deployments"
        description="Where every contract stands on the road from Testnet to Mainnet."
      />

      <FilterBar
        filters={filters}
        placeholder="Search release notes or paste a tx hash…"
        sorts={["updated"]}
        facets={[
          {
            key: "project",
            label: "Project",
            options: projects.map((project) => ({
              value: project.id,
              label: project.name,
            })),
          },
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
          title: "No deployments yet",
          description:
            "Once a contract is deployed, record its ID and transaction hash on its project.",
        }}
      >
        {page.rows.map((deployment) => (
          <DeploymentListRow
            key={deployment.id}
            deployment={deployment}
            showProject
            actions={
              <DeploymentRowActions
                deployment={deployment}
                canAdminister={canAdminister(roles.get(deployment.projectId) ?? null)}
              />
            }
          />
        ))}
      </DataList>
    </div>
  );
}
