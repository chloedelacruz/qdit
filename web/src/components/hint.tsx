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

export function Hint({
  label,
  side = "top",
  children,
  className,
}: {
  /** What the tooltip says. Text only — nothing in a tooltip can take focus. */
  label: React.ReactNode;
  side?: Side;
  /** The trigger. Must be a single element that can hold a ref. */
  children: React.ReactElement;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  /*
    True from a touch pointerdown until the click that ends that same tap.

    Radix answers a tap with its own close requests — the trigger's
    pointerdown, the pointerleave that follows pointerup, and the trigger's
    click — which would shut the tooltip the instant the tap opened it. Only
    those are ignored, and only while this tap is in flight: a swipe ends in
    pointercancel and clears it without toggling, and any later close (a tap
    elsewhere, a scroll, Escape) goes through as normal.
  */
  const tapping = useRef(false);

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (!next && tapping.current) return;
        setOpen(next);
      }}
    >
      <TooltipTrigger
        asChild
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") return;
          tapping.current = true;
          // Stops Radix's own pointerdown handler, which closes on press.
          event.preventDefault();
        }}
        onPointerCancel={() => {
          tapping.current = false;
        }}
        // A touch has no hover, so the tap itself toggles — on click, once the
        // browser has decided it was a tap and not the start of a scroll.
        onClick={() => {
          if (!tapping.current) return;
          setOpen((current) => !current);
          // Radix's click handler runs after this one; let it be ignored, then
          // go back to honouring every close request.
          setTimeout(() => {
            tapping.current = false;
          }, 0);
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
 * a wrapper that does: a `role="button"` focus stop marked `aria-disabled`, so
 * a screen reader announces an unavailable button and its reason, and the
 * keyboard reaches it like any other control. The reason is text only — where
 * there is a fix, the surrounding UI offers it as its own focusable link.
 */
export function DisabledReason({
  reason,
  side,
  children,
  className,
}: {
  reason: string;
  side?: Side;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Hint side={side} label={reason}>
      <span
        role="button"
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
