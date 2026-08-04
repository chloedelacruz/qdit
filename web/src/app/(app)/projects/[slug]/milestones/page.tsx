import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CreateMilestoneDialog } from "@/components/entity-dialogs";
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
  getProject,
  getProjectRole,
  listMilestones,
} from "@/lib/queries";

export const metadata: Metadata = { title: "Milestones" };

export default async function ProjectMilestonesPage({
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
  const [page, role, userId] = await Promise.all([
    listMilestones({ projectId: project.id }, filters),
    getProjectRole(project.id),
    getCurrentUserId(),
  ]);

  // Approve and reject are the owner's, matching the contract's auth check.
  const canEdit = canContribute(role);
  const isOwner = project.ownerId === userId;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${slug}` },
        ]}
        title="Milestones"
        description="Proposed → Submitted → Approved. Each one carries its own proof of work."
        actions={<CreateMilestoneDialog projectId={project.id} />}
      />

      <FilterBar
        filters={filters}
        placeholder="Search milestones…"
        sorts={["updated", "name", "progress", "due"]}
        facets={[
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
          description:
            "Group tasks into a milestone so its completion can be submitted and proved on-chain.",
          action: (
            <CreateMilestoneDialog
              projectId={project.id}
              label="Create your first milestone"
            />
          ),
        }}
      >
        {page.rows.map((milestone) => (
          <MilestoneListRow
            key={milestone.id}
            milestone={milestone}
            statusControl={
              <MilestoneStatusMenu
                milestoneId={milestone.id}
                status={milestone.status}
                isOwner={isOwner}
                canEdit={canEdit}
              />
            }
            actions={<MilestoneRowActions milestone={milestone} canEdit={canEdit} />}
          />
        ))}
      </DataList>
    </div>
  );
}
