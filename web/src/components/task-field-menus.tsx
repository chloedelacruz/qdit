"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { MemberChip } from "@/components/data-list";
import { MemberAvatar } from "@/components/rows";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { updateTaskFields } from "@/lib/actions";
import { TASK_PRIORITY, TASK_PRIORITY_ORDER, type TaskPriority } from "@/lib/constants";
import { ICON } from "@/lib/icons";
import type { TaskFieldsInput } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * In-place pickers for a task's assignee, priority, milestone and due date
 * (QDIT-53), on the board card and in the task panel.
 *
 * Each one follows `TaskStatusMenu`: the value shows as it always did, the
 * control only announces itself on hover and focus, and the save is
 * optimistic. On failure the value snaps back (`useOptimistic` reverts when
 * the transition ends without the server value changing) and a toast says why,
 * such as `tasks_guard_assignee` refusing someone who left the project.
 */

export type MemberOption = {
  id: string;
  name: string;
  initials?: string | null;
  avatarUrl?: string | null;
};

/** Saves one field optimistically; returns the shown value and a setter. */
function useTaskField<T>(taskId: string, value: T, toPatch: (next: T) => TaskFieldsInput) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(value);

  function save(next: T) {
    if (next === optimistic) return;

    startTransition(async () => {
      setOptimistic(next);
      const result = await updateTaskFields(taskId, toPatch(next));

      if (result.error) toast.error(result.error);
      else if (result.fieldErrors) toast.error(Object.values(result.fieldErrors)[0]);
    });
  }

  return { shown: optimistic, save, pending };
}

/**
 * The panel's look for a field that opens a picker: the value fills the row,
 * and the row lights up under the pointer so the whole width is the target.
 */
const fieldTrigger = cn(
  "focus-ring transition-qdit -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left",
  "hover:bg-accent/60 data-[state=open]:bg-accent/60",
  "pointer-coarse:min-h-11",
);

function Check({ on }: { on: boolean }) {
  return <ICON.selected className={cn("size-4 shrink-0", on ? "opacity-100" : "opacity-0")} />;
}

function Unset({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

// ---------------------------------------------------------------------------

export function TaskAssigneeMenu({
  taskId,
  assignee,
  members,
  variant,
}: {
  taskId: string;
  /** The current assignee as the row carries it; `id: null` when unassigned. */
  assignee: { id: string | null; name: string; initials: string | null; avatarUrl: string | null };
  /** The task's project members: `tasks_guard_assignee` refuses anyone else. */
  members: MemberOption[];
  /** `chip` on a board card, `field` in the task panel. */
  variant: "chip" | "field";
}) {
  const { shown, save, pending } = useTaskField<string | null>(taskId, assignee.id, (next) => ({
    assigneeId: next,
  }));

  // While a save is in flight the row still carries the old assignee, so the
  // name and initials come from the member picked.
  const picked = shown === assignee.id ? null : members.find((member) => member.id === shown);
  const current = shown
    ? {
        name: picked?.name ?? assignee.name,
        initials: picked ? (picked.initials ?? initialsOf(picked.name)) : assignee.initials,
        avatarUrl: picked ? (picked.avatarUrl ?? null) : assignee.avatarUrl,
      }
    : { name: "Unassigned", initials: null, avatarUrl: null };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Assignee: ${current.name}. Change assignee.`}
        className={cn(
          variant === "chip"
            ? "focus-ring transition-qdit rounded-full hover:ring-2 hover:ring-border-strong data-[state=open]:ring-2 data-[state=open]:ring-border-strong pointer-coarse:p-1"
            : fieldTrigger,
          pending && "opacity-60",
        )}
      >
        {variant === "chip" ? (
          // No name hint here: the hint would open on the same press as the
          // menu. The menu's label names the assignee instead.
          <span
            aria-hidden
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-medium",
              current.initials
                ? "bg-accent text-accent-foreground"
                : "border border-dashed border-border-strong text-muted-foreground",
            )}
          >
            {current.initials ?? "–"}
          </span>
        ) : (
          <>
            <MemberAvatar
              avatarUrl={current.avatarUrl}
              initials={current.initials}
              name={current.name}
            />
            <span className={cn("truncate", !shown && "text-muted-foreground")}>
              {current.name}
            </span>
          </>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align={variant === "chip" ? "end" : "start"} className="min-w-48">
        <DropdownMenuLabel>
          {variant === "chip" && shown ? `Assigned to ${current.name}` : "Assign to"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => save(null)}>
          <Check on={shown === null} />
          <MemberChip initials={null} name="Unassigned" />
          Unassigned
        </DropdownMenuItem>

        {members.map((member) => (
          <DropdownMenuItem key={member.id} onSelect={() => save(member.id)}>
            <Check on={shown === member.id} />
            <MemberAvatar
              avatarUrl={member.avatarUrl ?? null}
              initials={member.initials ?? initialsOf(member.name)}
              name={member.name}
            />
            <span className="truncate">{member.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Same rule as `queries.ts`: first letters of the first two words. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

// ---------------------------------------------------------------------------

export function TaskPriorityMenu({ taskId, priority }: { taskId: string; priority: TaskPriority }) {
  const { shown, save, pending } = useTaskField(taskId, priority, (next) => ({ priority: next }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Priority: ${TASK_PRIORITY[shown].label}. Change priority.`}
        className={cn(fieldTrigger, pending && "opacity-60")}
      >
        <StatusBadge dot={false} state={TASK_PRIORITY[shown]} />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuLabel>Priority</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {TASK_PRIORITY_ORDER.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => save(option)}>
            <Check on={option === shown} />
            {TASK_PRIORITY[option].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------

export function TaskMilestoneMenu({
  taskId,
  milestoneId,
  milestoneTitle,
  milestones,
}: {
  taskId: string;
  milestoneId: string | null;
  milestoneTitle: string | null;
  /** The task's project milestones. */
  milestones: { id: string; title: string }[];
}) {
  const { shown, save, pending } = useTaskField<string | null>(taskId, milestoneId, (next) => ({
    milestoneId: next,
  }));

  const title = shown
    ? (milestones.find((milestone) => milestone.id === shown)?.title ?? milestoneTitle)
    : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Milestone: ${title ?? "none"}. Change milestone.`}
        className={cn(fieldTrigger, pending && "opacity-60")}
      >
        <span className="truncate">{title ?? <Unset>No milestone</Unset>}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="max-h-72 min-w-48 overflow-y-auto">
        <DropdownMenuLabel>Milestone</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => save(null)}>
          <Check on={shown === null} />
          No milestone
        </DropdownMenuItem>
        {milestones.map((milestone) => (
          <DropdownMenuItem key={milestone.id} onSelect={() => save(milestone.id)}>
            <Check on={shown === milestone.id} />
            <span className="truncate">{milestone.title}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------

/**
 * A popover rather than a bare date input in the row: typing a date into a
 * native input fires `change` on every complete segment, which would save a
 * new due date per keystroke. Here the date is saved once, on Save or Enter.
 */
export function TaskDueDatePicker({ taskId, dueDate }: { taskId: string; dueDate: string | null }) {
  const { shown, save, pending } = useTaskField<string | null>(taskId, dueDate, (next) => ({
    dueDate: next,
  }));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(shown ?? "");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(shown ?? "");
        setOpen(next);
      }}
    >
      <PopoverTrigger
        aria-label={`Due date: ${shown ?? "none"}. Change due date.`}
        className={cn(fieldTrigger, pending && "opacity-60")}
      >
        {shown ? <span className="tabular-nums">{shown}</span> : <Unset>No due date</Unset>}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-64 p-3">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(draft === "" ? null : draft);
            setOpen(false);
          }}
        >
          <Input
            type="date"
            aria-label="Due date"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            {shown ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  save(null);
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            ) : null}
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
