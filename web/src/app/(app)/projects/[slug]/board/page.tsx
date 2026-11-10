import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CreateTaskDialog } from "@/components/entity-dialogs";
import { FilterBar } from "@/components/filter-bar";
import { CreateGate } from "@/components/create-gate";
import { PageHeader } from "@/components/page-header";
import { TaskBoard } from "@/components/task-board";
import { TASK_PRIORITY, TASK_PRIORITY_ORDER } from "@/lib/constants";
import { parseFilters, type SearchParams } from "@/lib/filters";
import {
  canContribute,
  getProject,
  getProjectRole,
  listBoard,
  listMilestoneOptions,
  listProjectMembers,
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
    // Only this project's members: anyone else could not see the task.
    listProjectMembers(project.id),
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
        info="Todo → In Progress → Done."
        actions={
          <CreateGate allowed={canContribute(role)} label="New task">
            <CreateTaskDialog
              projectId={project.id}
              milestones={milestones}
              members={members}
            />
          </CreateGate>
        }
      />

      <FilterBar
        filters={filters}
        placeholder="Search tasks…"
        sorts={["due", "name"]}
        facets={[
          {
            key: "priority",
            label: "Priority",
            options: TASK_PRIORITY_ORDER.map((value) => ({
              value,
              label: TASK_PRIORITY[value].label,
            })),
          },
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
          filters={filters}
          milestones={milestones}
          members={members}
          canEdit={canContribute(role)}
        />
      )}
    </div>
  );
}
