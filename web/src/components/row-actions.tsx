"use client";

import { Loader2, MoreHorizontal } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActionState } from "@/lib/actions";
import { cn } from "@/lib/utils";

/**
 * The edit/delete affordance on a list row or a board card.
 *
 * Both the dialog and the confirm are driven from state here rather than from
 * `DialogTrigger` nested inside a `DropdownMenuItem`. Radix closes the menu on
 * select and unmounts its content — a trigger living inside it takes the dialog
 * down with it, so the dialog either never opens or opens and immediately
 * closes. Lifting the open state out is the documented way around that.
 *
 * Visible on hover and focus only. Every row would otherwise carry a permanent
 * button whose job is to be ignored, on a surface built for scanning.
 */
export function RowActions({
  label,
  canEdit = true,
  canDelete = true,
  renderEdit,
  deleteTitle,
  deleteDescription,
  onDelete,
  className,
}: {
  /** Names the entity in the menu's accessible label, e.g. "task". */
  label: string;
  canEdit?: boolean;
  canDelete?: boolean;
  renderEdit?: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => React.ReactNode;
  deleteTitle: string;
  deleteDescription: string;
  onDelete?: () => Promise<ActionState>;
  className?: string;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const showEdit = canEdit && Boolean(renderEdit);
  const showDelete = canDelete && Boolean(onDelete);

  // Nothing this person may do — render nothing rather than an empty menu.
  if (!showEdit && !showDelete) return null;

  function confirmDelete() {
    if (!onDelete) return;

    startTransition(async () => {
      const result = await onDelete();

      if (result.error) {
        toast.error(result.error);
        return;
      }

      setConfirmOpen(false);
      toast.success(`${deleteTitle.replace(/\?$/, "")} — done`);
    });
  }

  return (
    // The row is wrapped in a Link. Without this the menu button's click
    // bubbles up and navigates away underneath the open menu.
    <span
      className={cn("shrink-0", className)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for this ${label}`}
          className={cn(
            "focus-ring transition-qdit grid size-6 place-items-center rounded-md text-muted-foreground",
            "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
            "hover:bg-muted hover:text-foreground",
          )}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="min-w-36"
          // The menu restores focus to its trigger as it closes, which would
          // pull focus straight back out of the dialog that just opened.
          onCloseAutoFocus={(event) => {
            if (editOpen || confirmOpen) event.preventDefault();
          }}
        >
          {showEdit ? (
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>Edit</DropdownMenuItem>
          ) : null}

          {showEdit && showDelete ? <DropdownMenuSeparator /> : null}

          {showDelete ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {showEdit ? renderEdit?.({ open: editOpen, onOpenChange: setEditOpen }) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              // Without this the dialog closes on click, before the action has
              // reported back, and a failure has nowhere left to render.
              onClick={(event) => {
                event.preventDefault();
                confirmDelete();
              }}
            >
              {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
