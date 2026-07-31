import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { TASK_STATUS, TASK_STATUS_ORDER } from "@/lib/constants";
import { DEMO_TASKS } from "@/lib/placeholder-data";
import { Plus } from "lucide-react";

export const metadata: Metadata = { title: "Board" };

export default function BoardPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Board"
        description="Todo → In Progress → Done. Drag-and-drop lands once the data layer is wired up."
        actions={
          <Button>
            <Plus data-icon="inline-start" />
            New task
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {TASK_STATUS_ORDER.map((status) => {
          const tasks = DEMO_TASKS.filter((task) => task.status === status);

          return (
            <section
              key={status}
              data-slot="board-column"
              data-status={status}
              aria-label={TASK_STATUS[status].label}
              className="flex flex-col gap-3"
            >
              <header className="flex items-center gap-2">
                <StatusBadge state={TASK_STATUS[status]} />
                <span data-slot="board-count" className="text-xs text-muted-foreground tabular-nums">
                  {tasks.length}
                </span>
              </header>

              <div className="flex flex-col gap-2">
                {tasks.map((task) => (
                  <article
                    key={task.id}
                    className="hover-lift rounded-xl bg-card p-3 ring-1 ring-foreground/10"
                  >
                    <p className="text-sm font-medium">{task.title}</p>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {task.milestone ? <span>{task.milestone}</span> : null}
                      {task.assignee ? <span>{task.assignee}</span> : <span>Unassigned</span>}
                      {task.dueDate ? <span className="tabular-nums">{task.dueDate}</span> : null}
                    </div>
                  </article>
                ))}

                {tasks.length === 0 ? (
                  <p className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                    Nothing here
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
