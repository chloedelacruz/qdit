import type { Metadata } from "next";

import { CreateProjectDialog } from "@/components/create-dialogs";
import { DataList } from "@/components/data-list";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { ProjectListRow } from "@/components/rows";
import { PROJECT_STATUS } from "@/lib/constants";
import { ICON } from "@/lib/icons";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { listProjects } from "@/lib/queries";
import { NETWORK_LABELS } from "@/lib/stellar";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = parseFilters(await searchParams);
  const page = await listProjects(filters);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Projects"
        description="Every build, with its milestones, deployment state and on-chain proof."
        actions={<CreateProjectDialog />}
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
          description:
            "A project holds your tasks, milestones and the proof trail you will hand to a grant reviewer.",
          action: <CreateProjectDialog label="Create your first project" />,
        }}
      >
        {page.rows.map((project) => (
          <ProjectListRow key={project.id} project={project} />
        ))}
      </DataList>
    </div>
  );
}
