"use client";

import { useState } from "react";

import { TaskRowActions } from "@/components/entity-row-actions";
import { MemberAvatar } from "@/components/rows";
import { StatusBadge } from "@/components/status-badge";
import {
  TaskAssigneeMenu,
  TaskDueDatePicker,
  TaskMilestoneMenu,
  TaskPriorityMenu,
  type MemberOption,
} from "@/components/task-field-menus";
import { TaskStatusMenu } from "@/components/task-status-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TASK_PRIORITY } from "@/lib/constants";
import type { TaskRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * What a board card opens into.
 *
 * A card is two lines, which is the right size for scanning a column and far
 * too small to hold a task's description — so until now the description was
 * write-only: the create and edit forms captured it and nothing in the app ever
 * showed it back. This panel is where it finally lands, along with the fields
 * the card can only abbreviate.
 *
 * A sheet rather than a dialog: the board is the context you are working in,
 * and a panel down the side keeps the column you dragged from visible. It sits
 * at `--surface-raised` (spec §Depth, rung 3) over the board's cards, and the
 * description sits in a well inside it — a step *down* from the panel, never
 * another card on a card.
 *
 * On a phone there is no column beside it to keep visible — the board stacks
 * its columns there — so the panel takes the whole screen instead, and the
 * back button (the `task` param, see `TaskBoard`) is how you leave it.
 */
export function TaskDetailSheet({
  task,
  milestones,
  members,
  canEdit,
  onClose,
}: {
  /** The task to show. `null` closes the panel. */
  task: TaskRow | null;
  milestones: { id: string; title: string }[];
  members: MemberOption[];
  canEdit: boolean;
  onClose: () => void;
}) {
  /**
   * The last task shown, held through the close animation.
   *
   * `task` goes null the instant the URL drops its `task` param, which is a
   * couple of hundred milliseconds before Radix has finished animating the
   * panel out. Rendering from `task` directly empties the panel first and then
   * slides the empty shell away.
   */
  const [shown, setShown] = useState(task);

  // Adjusted during render rather than in an effect: React re-runs this
  // component before committing, so the panel never paints a frame of the
  // previous task's content.
  if (task && task !== shown) setShown(task);

  return (
    <Sheet
      open={Boolean(task)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/*
        `p-0` because the header, the fields and the description each own
        their padding — the field rows need to run full-bleed to their
        dividers.

        Full screen below `sm`, a side panel from `sm` up (QDIT-34). The
        primitive sizes a right sheet with `data-[side=right]:` classes, which
        out-rank plain `w-full` and `sm:max-w-md` on specificity — so the
        overrides carry the same variant, or they silently lose and a phone
        gets a three-quarter panel with a sliver of board beside it that is
        too narrow to use and too wide to ignore.
      */}
      <SheetContent
        side="right"
        className={cn(
          "gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md",
          "max-sm:data-[side=right]:border-l-0",
          // The stock close button is 28px; a finger needs 44.
          "pointer-coarse:[&>[data-slot=sheet-close]]:top-1.5 pointer-coarse:[&>[data-slot=sheet-close]]:right-1.5 pointer-coarse:[&>[data-slot=sheet-close]]:size-11",
        )}
      >
        {shown ? (
          <>
            <SheetHeader className="gap-2 border-b border-border/70 p-4">
              {/* `pr-8` clears the sheet's own close button, which floats at
                  the top right corner of the panel — `pr-11` once that button
                  has grown for a finger. */}
              <div className="flex items-center gap-2 pr-8 pointer-coarse:pr-11">
                <TaskStatusMenu taskId={shown.id} status={shown.status} />

                <span className="flex-1" />

                {/* Edit and delete live here rather than in a footer, the same
                    way the project page puts them beside its own title. */}
                <TaskRowActions
                  task={shown}
                  milestones={milestones}
                  members={members}
                  canEdit={canEdit}
                  persistent
                />
              </div>

              {/* Wraps rather than truncates. The card already truncates; the
                  whole reason to open this panel is to read the full thing. */}
              <SheetTitle className="text-base leading-snug wrap-anywhere">
                {shown.title}
              </SheetTitle>

              <SheetDescription className="sr-only">
                Details for this task, including its assignee, milestone, due
                date and description.
              </SheetDescription>
            </SheetHeader>

            {/* The bottom inset keeps the last of the description clear of
                the home indicator when the panel is the whole screen. */}
            <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              <dl className="border-b border-border/70">
                {/* Each value opens its own picker for anyone who can edit
                    the task (QDIT-53); a viewer reads the same values. */}
                <Field label="Assignee">
                  {canEdit ? (
                    <TaskAssigneeMenu
                      key={shown.id}
                      taskId={shown.id}
                      assignee={{
                        id: shown.assigneeId,
                        name: shown.assigneeName,
                        initials: shown.assigneeInitials,
                        avatarUrl: shown.assigneeAvatarUrl,
                      }}
                      members={members}
                      variant="field"
                    />
                  ) : (
                    <span className="flex items-center gap-2">
                      <MemberAvatar
                        avatarUrl={shown.assigneeAvatarUrl}
                        initials={shown.assigneeInitials}
                        name={shown.assigneeName}
                      />
                      <span className={shown.assigneeInitials ? undefined : "text-muted-foreground"}>
                        {shown.assigneeName}
                      </span>
                    </span>
                  )}
                </Field>

                {/* The full word, not the P0–P3 chip. The abbreviation earns
                    its place on a card that has no room to say "Urgent"; here
                    the label column already names the field, so the value can
                    simply be the value. */}
                <Field label="Priority">
                  {canEdit ? (
                    <TaskPriorityMenu key={shown.id} taskId={shown.id} priority={shown.priority} />
                  ) : (
                    <StatusBadge dot={false} state={TASK_PRIORITY[shown.priority]} />
                  )}
                </Field>

                <Field label="Milestone">
                  {canEdit ? (
                    <TaskMilestoneMenu
                      key={shown.id}
                      taskId={shown.id}
                      milestoneId={shown.milestoneId}
                      milestoneTitle={shown.milestoneTitle}
                      milestones={milestones}
                    />
                  ) : (
                    (shown.milestoneTitle ?? <Unset>No milestone</Unset>)
                  )}
                </Field>

                <Field label="Due">
                  {canEdit ? (
                    <TaskDueDatePicker key={shown.id} taskId={shown.id} dueDate={shown.dueDate} />
                  ) : shown.dueDate ? (
                    <span className="tabular-nums">{shown.dueDate}</span>
                  ) : (
                    <Unset>No due date</Unset>
                  )}
                </Field>
              </dl>

              <section className="p-4">
                <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Description
                </h3>

                {shown.description ? (
                  /* `whitespace-pre-wrap` because the field is a textarea —
                     paragraphs typed into it are real and losing them would
                     turn a written note into one run-on line. */
                  <p className="well rounded-lg p-3 leading-relaxed whitespace-pre-wrap">
                    {shown.description}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {canEdit
                      ? "None yet — add one from Edit."
                      : "No description."}
                  </p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * One labelled fact. Kept to a single 34px row (spec §Density) with the label
 * in a fixed column, so the values line up and the list scans vertically.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/70 px-4 py-2 last:border-b-0">
      <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{children}</dd>
    </div>
  );
}

/** An empty field reads as absent, not as a value. */
function Unset({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
