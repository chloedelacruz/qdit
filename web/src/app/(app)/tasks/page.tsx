import type { Metadata } from "next";

import { DataList } from "@/components/data-list";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { TaskListRow } from "@/components/rows";
import { TASK_STATUS } from "@/lib/constants";
import { ICON } from "@/lib/icons";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { listMembers, listProjectOptions, listTasks } from "@/lib/queries";

export const metadata: Metadata = { title: "All tasks" };

/**
 * The cross-project view is a list, not a board. A board's value is seeing one
 * project's flow; across 40 projects the columns stop meaning anything, so
 * this is a flat filterable list instead.
 */
export default async function AllTasksPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = parseFilters(await searchParams);
  const [page, members, projects] = await Promise.all([
    listTasks({}, filters),
    listMembers(),
    listProjectOptions(),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="All tasks"
        description="Every task across every project you have access to."
      />

      <FilterBar
        filters={filters}
        placeholder="Search tasks…"
        sorts={["due", "name"]}
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
            options: Object.entries(TASK_STATUS).map(([value, meta]) => ({
              value,
              label: meta.label,
            })),
          },
          {
            key: "assignee",
            label: "Assignee",
            options: members.map((member) => ({ value: member.id, label: member.name })),
          },
        ]}
      />

      <DataList
        filters={filters}
        total={page.total}
        matched={page.matched}
        shown={page.rows.length}
        noun="tasks"
        empty={{
          icon: ICON.task,
          title: "No tasks yet",
          description: "Tasks you create inside a project will all show up here.",
        }}
      >
        {page.rows.map((task) => (
          <TaskListRow key={task.id} task={task} showProject />
        ))}
      </DataList>
    </div>
  );
}
