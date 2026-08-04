import type { Metadata } from "next";

import { DataList } from "@/components/data-list";
import { MilestoneRowActions } from "@/components/entity-row-actions";
import { FilterBar } from "@/components/filter-bar";
import { MilestoneStatusMenu } from "@/components/milestone-status-menu";
import { PageHeader } from "@/components/page-header";
import { MilestoneListRow } from "@/components/rows";
import { MILESTONE_STATUS } from "@/lib/constants";
import { ICON } from "@/lib/icons";
import { parseFilters, type SearchParams } from "@/lib/filters";
import {
  canContribute,
  getCurrentUserId,
  listMilestones,
  listProjectOptions,
  listProjectOwners,
  listProjectRoles,
} from "@/lib/queries";

export const metadata: Metadata = { title: "All milestones" };

export default async function AllMilestonesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = parseFilters(await searchParams);
  const [page, projects, roles, owners, userId] = await Promise.all([
    listMilestones({}, filters),
    listProjectOptions(),
    listProjectRoles(),
    listProjectOwners(),
    getCurrentUserId(),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="All milestones"
        description="Every milestone across the workspace, and whether it carries proof."
      />

      <FilterBar
        filters={filters}
        placeholder="Search milestones…"
        sorts={["updated", "name", "progress", "due"]}
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
            label: "Status",
            options: Object.entries(MILESTONE_STATUS).map(([value, meta]) => ({
              value,
              label: meta.label,
            })),
          },
        ]}
      />

      <DataList
        filters={filters}
        total={page.total}
        matched={page.matched}
        shown={page.rows.length}
        noun="milestones"
        empty={{
          icon: ICON.milestone,
          title: "No milestones yet",
          description: "Milestones you create inside a project will all show up here.",
        }}
      >
        {page.rows.map((milestone) => (
          <MilestoneListRow
            key={milestone.id}
            milestone={milestone}
            showProject
            statusControl={
              <MilestoneStatusMenu
                milestoneId={milestone.id}
                status={milestone.status}
                isOwner={owners.get(milestone.projectId) === userId}
                canEdit={canContribute(roles.get(milestone.projectId) ?? null)}
              />
            }
            actions={
              <MilestoneRowActions
                milestone={milestone}
                canEdit={canContribute(roles.get(milestone.projectId) ?? null)}
              />
            }
          />
        ))}
      </DataList>
    </div>
  );
}
