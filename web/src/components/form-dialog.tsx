"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/lib/actions";
import { cn } from "@/lib/utils";

const EMPTY: ActionState = {};

/**
 * The shell every create/edit form in the app is built on.
 *
 * It exists so the five dialogs stay identical in behaviour as well as looks:
 * same pending state, same error placement, same close-only-on-success rule.
 * Copies of this drift — one grows a spinner, another forgets to reset, a third
 * closes optimistically and eats the user's input.
 *
 * Fields are supplied as a render prop so they can read `fieldErrors` without
 * this component knowing anything about a particular entity.
 */
export function FormDialog({
  trigger,
  title,
  description,
  submitLabel,
  successMessage,
  action,
  className,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  submitLabel: string;
  successMessage: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  className?: string;
  children: (state: ActionState) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * Success is handled inside the action rather than an effect on `state.ok`.
   * The actions call `revalidatePath(..., "layout")`, which re-renders the tree
   * this dialog lives in — an effect keyed on the returned state can miss the
   * transition and leave the dialog sitting open over a row that was created.
   */
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, formData: FormData) => {
      const result = await action(previous, formData);

      if (result.ok) {
        setOpen(false);
        formRef.current?.reset();
        toast.success(successMessage);
      }

      return result;
    },
    EMPTY,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className={cn("sm:max-w-md", className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        {/* noValidate: the browser's own bubbles would pre-empt the inline
            messages, which are the ones that match the server's rules. */}
        <form ref={formRef} action={formAction} className="space-y-3.5" noValidate>
          {children(state)}

          {state.error ? (
            <p role="alert" className="text-xs text-destructive">
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Label + control + inline error. The only field wrapper in the app. */
export function Field({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {optional ? (
          <span className="font-normal text-muted-foreground">Optional</span>
        ) : null}
      </Label>

      {children}

      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A plain `<select>`, not the Radix one. Radix Select renders a button and a
 * portal — it submits nothing with a native form post, which is exactly how a
 * server action receives these forms. It would silently send an empty value.
 */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "focus-ring h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm transition-colors outline-none dark:bg-input/30",
        className,
      )}
    />
  );
}

/** Two-up row for fields that belong together, e.g. status + due date. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
