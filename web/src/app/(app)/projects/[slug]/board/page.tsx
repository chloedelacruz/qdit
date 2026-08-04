import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CreateTaskDialog } from "@/components/create-dialogs";
import { FilterBar } from "@/components/filter-bar";
import { MemberChip, RowMeta } from "@/components/data-list";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { TaskStatusMenu } from "@/components/task-status-menu";
import { TASK_STATUS } from "@/lib/constants";
import { parseFilters, type SearchParams } from "@/lib/filters";
import {
  getProject,
  listBoard,
  listMembers,
  listMilestoneOptions,
  type BoardColumn,
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
  const [board, members, milestones] = await Promise.all([
    listBoard({ projectId: project.id }, filters),
    listMembers(),
    listMilestoneOptions(project.id),
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
        <div className="grid gap-2 md:grid-cols-3">
          {board.columns.map((column) => (
            <Column key={column.status} column={column} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Each column scrolls independently and is capped in height. Without this a
 * single 300-card column pushes the other two off-screen entirely.
 */
function Column({ column }: { column: BoardColumn }) {
  const meta = TASK_STATUS[column.status];
  const hidden = column.matched - column.rows.length;

  return (
    <section
      data-slot="board-column"
      data-status={column.status}
      aria-label={meta.label}
      className="well flex flex-col rounded-xl border border-border"
    >
      <header className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <StatusBadge state={meta} dot={false} />
        <span
          data-slot="board-count"
          className="text-xs text-muted-foreground tabular-nums"
        >
          {column.matched}
        </span>
      </header>

      <div className="flex max-h-[min(60vh,34rem)] flex-col gap-2 overflow-y-auto p-2">
        {column.rows.map((task) => (
          <article
            key={task.id}
            className="surface lift rounded-lg border border-border p-2"
          >
            <p className="text-sm">{task.title}</p>

            <div className="mt-1.5 flex items-center gap-2">
              <TaskStatusMenu taskId={task.id} status={task.status} />
              <RowMeta
                className="min-w-0 flex-1"
                items={[task.milestoneTitle, task.dueDate]}
              />
              <MemberChip initials={task.assigneeInitials} name={task.assigneeName} />
            </div>
          </article>
        ))}

        {column.matched === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing here</p>
        ) : null}

        {hidden > 0 ? (
          <p className="px-2 py-1.5 text-center text-xs text-muted-foreground tabular-nums">
            +{hidden} more
          </p>
        ) : null}
      </div>
    </section>
  );
}
