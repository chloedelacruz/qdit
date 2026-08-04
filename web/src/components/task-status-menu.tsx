"use client";

import { Check } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TASK_STATUS, TASK_STATUS_ORDER, type TaskStatus } from "@/lib/constants";
import { updateTaskStatus } from "@/lib/actions";
import { cn } from "@/lib/utils";

/**
 * Moves a task between columns.
 *
 * Deliberately the same `StatusBadge` the board already renders — at rest the
 * board looks exactly as it did, and the control only announces itself on hover
 * and focus. A separate "edit" affordance on every card would be noise on a
 * surface whose job is scanning.
 *
 * The update is optimistic because it is a single enum write that essentially
 * never fails; on failure the badge snaps back and a toast explains why, which
 * is cheaper than making every status change wait for a round trip.
 */
export function TaskStatusMenu({
  taskId,
  status,
  className,
}: {
  taskId: string;
  status: TaskStatus;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(status);

  function change(next: TaskStatus) {
    if (next === optimistic) return;

    startTransition(async () => {
      setOptimistic(next);
      const result = await updateTaskStatus(taskId, next);

      if (result.error) {
        // `useOptimistic` reverts on its own when the transition ends without
        // the server value changing; the toast supplies the reason.
        toast.error(result.error);
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Status: ${TASK_STATUS[optimistic].label}. Change status.`}
        className={cn(
          "focus-ring transition-qdit rounded-md",
          // Only hints at being interactive on hover — see note above.
          "hover:brightness-95 dark:hover:brightness-110",
          pending && "opacity-60",
          className,
        )}
      >
        <StatusBadge state={TASK_STATUS[optimistic]} dot={false} />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuLabel>Move to</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {TASK_STATUS_ORDER.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => change(option)}>
            <Check
              className={cn(
                "size-4 shrink-0",
                option === optimistic ? "opacity-100" : "opacity-0",
              )}
            />
            {TASK_STATUS[option].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
