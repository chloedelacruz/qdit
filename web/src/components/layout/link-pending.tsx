"use client";

import { useLinkStatus } from "next/link";

import { ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * Marks the one link whose route is on its way (QDIT-35).
 *
 * Must render inside the `<Link>` it describes — `useLinkStatus` reads the
 * nearest one. Always mounted and toggled by opacity, so the nav item never
 * changes width when it appears (the Next docs' own warning about layout
 * shift). A spinner glyph, which keeps turning under Reduce Motion, plus the
 * opacity step itself, which involves no motion at all.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden
      data-pending={pending ? "" : undefined}
      className={cn("pointer-events-none opacity-0 data-[pending]:opacity-100", className)}
    >
      <ICON.spinner className={cn("size-3.5", pending && "animate-spin")} />
    </span>
  );
}
