"use client";

import { Loader2 } from "lucide-react";
import React, { useActionState, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  /** Omit when driving the dialog from outside, e.g. a row's overflow menu. */
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  submitLabel: string;
  successMessage: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: (state: ActionState) => React.ReactNode;
}) {
  /**
   * Uncontrolled by default — a create dialog owns its own trigger and state.
   * Edit dialogs live behind a dropdown item, which has already closed by the
   * time the dialog should appear, so those pass `open` in from the row.
   */
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

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
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}

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
 * The form's select, built on Radix rather than a native `<select>`.
 *
 * A native select's dropdown is painted by the browser, not built from the
 * DOM. That makes it unstylable, unselectable and absent from screenshots —
 * and on Chrome it takes the popup's background from the control's own
 * `background-color`, which here was translucent (`dark:bg-input/30`). Blended
 * against the platform's white it produced a near-white popup carrying the
 * dark theme's light `color`: options that were technically rendered and
 * effectively invisible. `color-scheme: dark` alone does not fix it, and no
 * stylesheet can reach the popup to try.
 *
 * Radix renders the list as real elements, so it takes `bg-popover` like every
 * other overlay in the app, and a test can actually see it.
 *
 * **The value still has to reach `FormData`.** These forms post natively to a
 * server action, and Radix's trigger is a button, which submits nothing. The
 * hidden input below is what carries the value — deliberately ours rather than
 * relying on Radix's internal form bubbling, so the contract is visible here.
 *
 * Accepts `<option>` children so it reads like the native element it replaces:
 * the alternative was rewriting twenty-odd call sites into an options array,
 * a much larger diff for the same markup.
 */
export function SelectField({
  id,
  name,
  defaultValue,
  value: controlledValue,
  onValueChange,
  className,
  "aria-label": ariaLabel,
  children,
}: {
  id?: string;
  /** Omit when driving the value yourself — nothing is posted then. */
  name?: string;
  defaultValue?: string;
  /** Controlled mode, for the pickers that are not inside a form. */
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  "aria-label"?: string;
  children: React.ReactNode;
}) {
  const options = optionsFrom(children);
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");

  const value = controlledValue ?? uncontrolled;
  const setValue = (next: string) => {
    if (controlledValue === undefined) setUncontrolled(next);
    onValueChange?.(next);
  };

  return (
    <>
      {/*
        What the server actually receives. NONE maps back to "", which every
        action already reads as "not set" via orNull().

        No `required` here even where the old select had one: a hidden input is
        barred from constraint validation, so it would be decoration. The
        schemas are the gate — `userId: z.guid("Choose someone to add.")` — and
        the form is `noValidate` regardless.
      */}
      {name ? <input type="hidden" name={name} value={value} /> : null}

      <Select
        value={value === "" ? NONE : value}
        onValueChange={(next) => setValue(next === NONE ? "" : next)}
      >
        <SelectTrigger id={id} aria-label={ariaLabel} className={cn("h-8 w-full", className)}>
          <SelectValue />
        </SelectTrigger>

        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value || NONE}
              // Radix reserves "" to mean "cleared", and throws on an item that
              // uses it, so the empty option travels under a sentinel and is
              // translated back at both boundaries.
              value={option.value === "" ? NONE : option.value}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

/** Stands in for `<option value="">`, which Radix will not accept. */
const NONE = "__none__";

type ParsedOption = { value: string; label: string; disabled?: boolean };

/**
 * Reads `<option>` children into plain data.
 *
 * `React.Children.toArray` flattens the arrays that `.map()` produces at the
 * call sites and drops nulls, so a caller can keep writing the markup it always
 * wrote.
 */
function optionsFrom(children: React.ReactNode): ParsedOption[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    const props = child.props as { value?: string; disabled?: boolean; children?: React.ReactNode };
    return [
      {
        value: props.value ?? "",
        label: typeof props.children === "string" ? props.children : String(props.children ?? ""),
        disabled: props.disabled,
      },
    ];
  });
}

/** Two-up row for fields that belong together, e.g. status + due date. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
