"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ICON, type IconComponent } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * The three small primitives that let the app say less on screen (QDIT-34).
 *
 * - `Hint` — a tooltip that also opens on tap. Radix tooltips are hover and
 *   focus only, so on a phone a hint would simply not exist; spec
 *   §Iconography says an icon-only control is allowed only when its name can
 *   be read on every input.
 * - `InfoBubble` — the ⓘ beside a heading. The explainer paragraph that used
 *   to sit under the heading lives in here instead, one tap away.
 * - `DisabledReason` — a control the person cannot use *yet*, shown disabled
 *   with the reason, instead of a dialog that opens only to say no.
 */

type Side = "top" | "right" | "bottom" | "left";

const TAP_GRACE_MS = 400;

export function Hint({
  label,
  side = "top",
  children,
  className,
}: {
  /** What the tooltip says. A node so a reason can carry a link. */
  label: React.ReactNode;
  side?: Side;
  /** The trigger. Must be a single element that can hold a ref. */
  children: React.ReactElement;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // When a tap opened it. Radix follows a touch with its own close requests —
  // the trigger's click and the pointerleave that fires after pointerup — which
  // would shut the tooltip the instant it appeared. Those arrive within a few
  // hundred milliseconds; a later tap outside still closes it as normal.
  const tappedAt = useRef(0);

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (!next && Date.now() - tappedAt.current < TAP_GRACE_MS) return;
        setOpen(next);
      }}
    >
      <TooltipTrigger
        asChild
        // A touch has no hover. Toggle on tap, and stop Radix from treating the
        // same pointerdown as "dismiss" — it closes a tooltip on trigger press.
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") return;
          event.preventDefault();
          setOpen((current) => {
            tappedAt.current = current ? 0 : Date.now();
            return !current;
          });
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={6} className={cn("text-pretty", className)}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * An icon-only control with its name in a tooltip and in `aria-label`.
 *
 * For the repeated row actions the spec amendment allows to drop their word —
 * share, history, certificate. Renders a link when given `href`.
 */
export function IconAction({
  label,
  icon: Icon,
  href,
  download,
  external,
  onClick,
  side,
  className,
}: {
  label: string;
  icon: IconComponent;
  href?: string;
  download?: boolean;
  external?: boolean;
  onClick?: () => void;
  side?: Side;
  className?: string;
}) {
  const classes = cn(
    "focus-ring transition-qdit grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground",
    "hover:bg-muted hover:text-foreground",
    // A finger needs 44px; the glyph stays 16px and the hit area grows.
    "pointer-coarse:size-11",
    className,
  );
  const glyph = <Icon className="size-4" />;

  return (
    <Hint label={label} side={side}>
      {href ? (
        download || external ? (
          <a
            href={href}
            aria-label={label}
            className={classes}
            {...(download ? { download: true } : {})}
            {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
          >
            {glyph}
          </a>
        ) : (
          <Link href={href} aria-label={label} className={classes}>
            {glyph}
          </Link>
        )
      ) : (
        <button type="button" aria-label={label} onClick={onClick} className={classes}>
          {glyph}
        </button>
      )}
    </Hint>
  );
}

/**
 * The ⓘ beside a heading. Opens on click, tap or Enter, and stays open while
 * the person reads — an explainer is longer than a tooltip should hold.
 */
export function InfoBubble({
  label,
  children,
  side = "bottom",
  className,
}: {
  /** Names the thing being explained, for the trigger's accessible name. */
  label: string;
  children: React.ReactNode;
  side?: Side;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`About ${label}`}
        data-slot="info-bubble"
        className={cn(
          "focus-ring transition-qdit inline-grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground",
          "hover:text-foreground data-[state=open]:text-foreground",
          // 44px under a finger, without pushing the heading line taller.
          "pointer-coarse:-my-3 pointer-coarse:size-11",
          className,
        )}
      >
        <ICON.info className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        className="w-72 space-y-2 text-sm leading-6 text-muted-foreground"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A disabled control that says why.
 *
 * A disabled `<button>` takes no pointer or focus events, so the hint hangs on
 * a focusable wrapper instead — which is also what keeps it reachable from the
 * keyboard. `fix` points at the place that resolves it ("Register on the
 * overview"), so the reason is never a dead end either.
 */
export function DisabledReason({
  reason,
  fix,
  side,
  children,
  className,
}: {
  reason: string;
  fix?: { href: string; label: string };
  side?: Side;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Hint side={side} label={<ReasonText reason={reason} fix={fix} />}>
      <span
        tabIndex={0}
        aria-disabled="true"
        data-slot="disabled-reason"
        className={cn("focus-ring inline-flex cursor-not-allowed rounded-md", className)}
      >
        {/* The control itself ignores the pointer, so the wrapper gets it. */}
        <span className="pointer-events-none inline-flex">{children}</span>
        <span className="sr-only">{reason}</span>
      </span>
    </Hint>
  );
}

/** The reason line, with its fix as a link. Shared by menus and buttons. */
export function ReasonText({
  reason,
  fix,
}: {
  reason: string;
  fix?: { href: string; label: string };
}) {
  return (
    <span className="flex flex-col gap-1">
      <span>{reason}</span>
      {fix ? (
        <Link href={fix.href} className="font-medium underline underline-offset-2">
          {fix.label}
        </Link>
      ) : null}
    </span>
  );
}
