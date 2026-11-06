import type { Metadata } from "next";

import { CreateProjectDialog } from "@/components/entity-dialogs";
import { DataList } from "@/components/data-list";
import { ProjectRowActions } from "@/components/entity-row-actions";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { ProjectListRow } from "@/components/rows";
import { PROJECT_STATUS } from "@/lib/constants";
import { ICON } from "@/lib/icons";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { canAdminister, listProjects, listProjectRoles } from "@/lib/queries";
import { NETWORK_LABELS } from "@/lib/stellar";

export const metadata: Metadata = { title: "Projects" };

const ANCHORING = Boolean(process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID);

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = parseFilters(await searchParams);
  const [page, roles] = await Promise.all([listProjects(filters), listProjectRoles()]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Projects"
        info="Every build, with its milestones, deployment state and on-chain proof."
        actions={<CreateProjectDialog anchoring={ANCHORING} />}
      />

      <FilterBar
        filters={filters}
        placeholder="Search projects or paste a contract ID…"
        sorts={["updated", "name", "progress"]}
        facets={[
          {
            key: "status",
            label: "Status",
            options: Object.entries(PROJECT_STATUS).map(([value, meta]) => ({
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
        noun="projects"
        empty={{
          icon: ICON.project,
          title: "No projects yet",
          description: "Tasks, milestones and the proof trail for a grant reviewer.",
          action: <CreateProjectDialog label="Create your first project" anchoring={ANCHORING} />,
        }}
      >
        {page.rows.map((project) => (
          <ProjectListRow
            key={project.id}
            project={project}
            actions={
              <ProjectRowActions
                project={project}
                canAdminister={canAdminister(roles.get(project.id) ?? null)}
              />
            }
          />
        ))}
      </DataList>
    </div>
  );
}
