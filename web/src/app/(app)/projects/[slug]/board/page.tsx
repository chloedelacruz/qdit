import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CreateTaskDialog } from "@/components/entity-dialogs";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { TaskBoard } from "@/components/task-board";
import { parseFilters, type SearchParams } from "@/lib/filters";
import {
  canContribute,
  getProject,
  getProjectRole,
  listBoard,
  listMembers,
  listMilestoneOptions,
} from "@/lib/queries";

export const metadata: Metadata = { title: "Board" };

export default async function ProjectBoardPage({
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
  const [board, members, milestones, role] = await Promise.all([
    listBoard({ projectId: project.id }, filters),
    listMembers(),
    listMilestoneOptions(project.id),
    getProjectRole(project.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        breadcrumb={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${slug}` },
        ]}
        title="Board"
        description="Todo → In Progress → Done."
        actions={
          <CreateTaskDialog
            projectId={project.id}
            milestones={milestones}
            members={members}
          />
        }
      />

      <FilterBar
        filters={filters}
        placeholder="Search tasks…"
        sorts={["due", "name"]}
        facets={[
          {
            key: "assignee",
            label: "Assignee",
            options: members.map((member) => ({ value: member.id, label: member.name })),
          },
          {
            key: "milestone",
            label: "Milestone",
            options: milestones.map((milestone) => ({
              value: milestone.id,
              label: milestone.title,
            })),
          },
        ]}
      />

      {board.matched === 0 && board.total > 0 ? (
        <p className="well rounded-xl border border-dashed border-border-strong px-6 py-12 text-center text-sm text-muted-foreground">
          None of this project&apos;s {board.total} tasks match these filters.
        </p>
      ) : (
        <TaskBoard
          columns={board.columns}
          milestones={milestones}
          members={members}
          canEdit={canContribute(role)}
        />
      )}
    </div>
  );
}
