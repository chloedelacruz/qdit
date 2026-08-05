"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { MemberChip, RowMeta } from "@/components/data-list";
import { TaskRowActions } from "@/components/entity-row-actions";
import { StatusBadge } from "@/components/status-badge";
import { TaskStatusMenu } from "@/components/task-status-menu";
import { Button } from "@/components/ui/button";
import { TASK_STATUS, type TaskStatus } from "@/lib/constants";
import { moveTask } from "@/lib/actions";
import { DEFAULT_LIMIT, serialiseFilters, type Filters } from "@/lib/filters";
import type { BoardColumn, TaskRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * The board, with cards draggable between columns.
 *
 * The status menu on each card stays. Dragging is faster when it works, but on
 * touch it costs a deliberate long press, and on a trackpad it is hard to aim
 * mid-scroll. The menu is the path that always works; the drag is the shortcut.
 *
 * State is optimistic: `moveTask` writes the new column and the order of the
 * destination column, and the layout reverts on failure with a toast. A drag
 * that waited for a round trip before the card moved would feel broken.
 */
export function TaskBoard({
  columns,
  filters,
  milestones,
  members,
  canEdit,
}: {
  columns: BoardColumn[];
  /** Drives the per-column "Load more", which pages by raising `limit`. */
  filters: Filters;
  milestones: { id: string; title: string }[];
  members: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [, startTransition] = useTransition();
  const [dragging, setDragging] = useState<TaskRow | null>(null);

  /**
   * `useOptimistic` needs a reducer that produces the whole next board, because
   * a move touches two columns — the one losing the card and the one gaining it.
   */
  const [optimistic, applyMove] = useOptimistic(
    columns,
    (current, move: { taskId: string; to: TaskStatus; index: number }) => {
      const task = current
        .flatMap((column) => column.rows)
        .find((row) => row.id === move.taskId);

      if (!task) return current;

      return current.map((column) => {
        const without = column.rows.filter((row) => row.id !== move.taskId);

        if (column.status !== move.to) {
          return {
            ...column,
            rows: without,
            matched: column.matched - (column.rows.length - without.length),
          };
        }

        const next = [...without];
        next.splice(Math.min(move.index, next.length), 0, { ...task, status: move.to });

        return {
          ...column,
          rows: next,
          matched: column.matched + (next.length - without.length),
        };
      });
    },
  );

  /**
   * Mouse and touch are split on purpose rather than sharing one PointerSensor.
   *
   * A mouse gets a small distance threshold, so clicking the status menu or the
   * overflow button on a card is not read as the beginning of a drag. A finger
   * cannot use the same rule: "moved six pixels" is also exactly how a scroll
   * starts, and columns scroll, so a distance constraint makes the drag and the
   * scroll fight over every swipe. Touch gets a delay instead — hold to drag,
   * swipe to scroll. Moving further than `tolerance` before the delay elapses
   * cancels the pending drag and lets the scroll through untouched.
   */
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setDragging(
      optimistic.flatMap((column) => column.rows).find((row) => row.id === id) ?? null,
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDragging(null);
    if (!over) return;

    const taskId = String(active.id);
    const from = optimistic.find((column) => column.rows.some((row) => row.id === taskId));
    if (!from) return;

    // `over` is either a column (dropped on empty space) or another card.
    const overId = String(over.id);
    const to =
      optimistic.find((column) => column.status === overId) ??
      optimistic.find((column) => column.rows.some((row) => row.id === overId));

    if (!to) return;

    const oldIndex = from.rows.findIndex((row) => row.id === taskId);
    const overIndex = to.rows.findIndex((row) => row.id === overId);
    const newIndex = overIndex === -1 ? to.rows.length : overIndex;

    if (from.status === to.status && oldIndex === newIndex) return;

    const orderedIds =
      from.status === to.status
        ? arrayMove(to.rows, oldIndex, newIndex).map((row) => row.id)
        : [
            ...to.rows.slice(0, newIndex).map((row) => row.id),
            taskId,
            ...to.rows.slice(newIndex).map((row) => row.id),
          ];

    startTransition(async () => {
      applyMove({ taskId, to: to.status, index: newIndex });
      const result = await moveTask(taskId, to.status, orderedIds);
      if (result.error) toast.error(result.error);
    });
  }

  // Viewers get the board as it was: no sensors, no drag handles, no overlay.
  if (!canEdit) {
    return (
      <div className="grid gap-2 md:grid-cols-3">
        {optimistic.map((column) => (
          <Column key={column.status} column={column} filters={filters}>
            {column.rows.map((task) => (
              <Card key={task.id} task={task} />
            ))}
          </Column>
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      // pointerWithin beats the default rectangle intersection for columns of
      // very different heights — an empty column is otherwise nearly impossible
      // to target, because a tall neighbour overlaps the cursor first.
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="grid gap-2 md:grid-cols-3">
        {optimistic.map((column) => (
          <DroppableColumn key={column.status} column={column} filters={filters}>
            <SortableContext
              items={column.rows.map((row) => row.id)}
              strategy={verticalListSortingStrategy}
            >
              {column.rows.map((task) => (
                <SortableCard
                  key={task.id}
                  task={task}
                  milestones={milestones}
                  members={members}
                />
              ))}
            </SortableContext>
          </DroppableColumn>
        ))}
      </div>

      {/* Rendered outside the columns so the card being dragged is not clipped
          by a column's own overflow. */}
      <DragOverlay>{dragging ? <Card task={dragging} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function DroppableColumn({
  column,
  filters,
  children,
}: {
  column: BoardColumn;
  filters: Filters;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });

  return (
    <Column column={column} filters={filters} ref={setNodeRef} isOver={isOver}>
      {children}
    </Column>
  );
}

/**
 * Each column scrolls independently and is capped in height. Without this a
 * single 300-card column pushes the other two off-screen entirely.
 */
function Column({
  column,
  filters,
  ref,
  isOver,
  children,
}: {
  column: BoardColumn;
  filters: Filters;
  ref?: React.Ref<HTMLDivElement>;
  isOver?: boolean;
  children: React.ReactNode;
}) {
  const meta = TASK_STATUS[column.status];
  const hidden = column.matched - column.rows.length;
  // `limit` is per column server-side (`listBoard` applies it to each query),
  // so one step reveals the same number of cards in whichever column you press.
  const step = Math.min(hidden, DEFAULT_LIMIT);
  const nextQuery = serialiseFilters({ ...filters, limit: filters.limit + DEFAULT_LIMIT });

  return (
    <section
      data-slot="board-column"
      data-status={column.status}
      aria-label={meta.label}
      className="well flex flex-col rounded-xl border border-border"
    >
      <header className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <StatusBadge state={meta} dot={false} />
        <span data-slot="board-count" className="text-xs text-muted-foreground tabular-nums">
          {column.matched}
        </span>
      </header>

      <div
        ref={ref}
        className={cn(
          "transition-qdit flex max-h-[min(60vh,34rem)] flex-col gap-2 overflow-y-auto p-2",
          isOver && "bg-accent/40",
        )}
      >
        {children}

        {column.matched === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing here</p>
        ) : null}

        {/* Not a label. Cards past the cap were unreachable here — and, because
            they were never rendered, undraggable too. Paging state lives in the
            URL like it does for the lists, so a board opened two pages deep is
            shareable and the back button pages back out of it. */}
        {hidden > 0 ? (
          <Button asChild variant="outline" size="sm" className="w-full">
            {/* Query-only href keeps the current pathname. */}
            <Link
              href={`?${nextQuery}`}
              scroll={false}
              data-slot="board-more"
              // Three columns each render one of these; without the column
              // name they are three identically-labelled links.
              aria-label={`Load ${step} more ${meta.label} tasks`}
            >
              Load {step} more
            </Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function SortableCard({
  task,
  milestones,
  members,
}: {
  task: TaskRow;
  milestones: { id: string; title: string }[];
  members: { id: string; name: string }[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: task.id,
      /**
       * dnd-kit defaults a draggable to `role="button"`, which would replace the
       * card's `article` role — the thing that makes a board card a card to a
       * screen reader, and what the board specs select on. Keep the semantic and
       * describe the drag separately; `attributes` still supplies the tabIndex
       * the keyboard sensor needs.
       */
      attributes: { role: "article", roleDescription: "Draggable task card" },
    });

  return (
    <Card
      task={task}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // The whole card is the handle. A dedicated grip would be a second thing
      // to hit on a surface whose cards are already only two lines tall.
      handleProps={{ ...attributes, ...listeners }}
      placeholder={isDragging}
      actions={
        <TaskRowActions
          task={task}
          milestones={milestones}
          members={members}
          canEdit
        />
      }
    />
  );
}

/**
 * Keeps a press on a control inside a card from reaching the card's own drag
 * activator. It has to cover every event the sensors listen on — `mousedown`
 * for the MouseSensor and `touchstart` for the TouchSensor — because dnd-kit
 * binds those directly, not `pointerdown`. `pointerdown` is stopped too so the
 * guard does not silently lapse if the sensors ever change again.
 */
const stopActivation = {
  onPointerDown: (event: React.SyntheticEvent) => event.stopPropagation(),
  onMouseDown: (event: React.SyntheticEvent) => event.stopPropagation(),
  onTouchStart: (event: React.SyntheticEvent) => event.stopPropagation(),
} as const;

function Card({
  task,
  ref,
  style,
  handleProps,
  placeholder,
  dragging,
  actions,
}: {
  task: TaskRow;
  ref?: React.Ref<HTMLDivElement>;
  style?: React.CSSProperties;
  handleProps?: React.HTMLAttributes<HTMLElement>;
  /** The gap left behind while this card is being dragged. */
  placeholder?: boolean;
  /** The copy following the cursor. */
  dragging?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <article
      ref={ref}
      style={style}
      {...handleProps}
      className={cn(
        "surface lift group/row rounded-lg border border-border p-2",
        // `touch-manipulation` rather than `touch-none`: the column has to keep
        // scrolling under a finger, and the TouchSensor's delay is what
        // separates the two. It only drops the double-tap zoom gesture, and
        // with it the tap delay. `select-none` stops a long press raising the
        // text-selection callout on top of the drag it was meant to start.
        handleProps && "cursor-grab touch-manipulation select-none active:cursor-grabbing",
        placeholder && "opacity-40",
        dragging && "rotate-1 cursor-grabbing shadow-lg",
      )}
    >
      <p className="text-sm">{task.title}</p>

      <div className="mt-1.5 flex items-center gap-2">
        {/* Stops a press on the menu from being read as the start of a drag. */}
        <span {...stopActivation}>
          <TaskStatusMenu taskId={task.id} status={task.status} />
        </span>

        <RowMeta className="min-w-0 flex-1" items={[task.milestoneTitle, task.dueDate]} />
        <MemberChip initials={task.assigneeInitials} name={task.assigneeName} />

        {actions ? <span {...stopActivation}>{actions}</span> : null}
      </div>
    </article>
  );
}
