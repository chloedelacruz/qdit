import Link from "next/link";
import type { IconComponent } from "@/lib/icons";

import { cn } from "@/lib/utils";

/**
 * A titled block of rows, shared by the dashboard panels and the project
 * overview so the two cannot drift into near-identical local copies.
 *
 * `priority` marks the page's primary object (spec §Visual Priority): it steps
 * the container up one elevation and gives the heading icon the accent. Exactly
 * one Section per page should set it — a second cancels the first out.
 */
export function Section({
  id,
  icon: Icon,
  title,
  count,
  href,
  priority = false,
  empty,
  info,
  actions,
  className,
  children,
}: {
  /** Anchor target, so a row can link straight to this block. */
  id?: string;
  /** An `InfoBubble` beside the title, for the explainer the heading used to need. */
  info?: React.ReactNode;
  /** Small controls on the heading line, before "View all". */
  actions?: React.ReactNode;
  icon: IconComponent;
  title: string;
  /** Total available, shown beside the title. Omit when it adds nothing. */
  count?: number;
  /** "View all" target. Usually a pre-filtered list. */
  href?: string;
  priority?: boolean;
  /** Rendered instead of the container when there is nothing to show. */
  empty: string;
  className?: string;
  children: React.ReactNode;
}) {
  const headingId = `section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  const isEmpty = Array.isArray(children) && children.length === 0;

  return (
    <section id={id} className={cn("scroll-mt-20", className)} aria-labelledby={headingId}>
      {/* Wraps rather than squeezing: on a phone a heading with an info
          bubble, a count, an action button and "View all" is wider than the
          line, and the controls drop under the title instead of pushing the
          page sideways. On a desktop it never wraps. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
        {/* The ⓘ sits beside the heading, not inside it, so it stays out of the
            heading's — and this region's — accessible name. */}
        <div className="flex min-w-0 items-center gap-1.5">
        <h2 id={headingId} className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          {/* Inline at 14px, never a tinted chip stacked above the heading
              (spec §Iconography). Accent only when this is the primary object. */}
          <Icon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 translate-y-px",
              priority ? "text-primary" : "text-muted-foreground",
            )}
          />
          {title}
          {count !== undefined ? (
            <span className="ml-0.5 text-xs font-normal text-muted-foreground tabular-nums">
              {count}
            </span>
          ) : null}
        </h2>
        {info}
        </div>

        {actions || href ? (
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {actions}
            {href ? (
              <Link
                href={href}
                aria-label={`View all ${title.toLowerCase()}`}
                className={cn(
                  "transition-qdit relative shrink-0 text-xs text-muted-foreground hover:text-foreground",
                  // An 11px word is a 16px target. Under a finger the hit area
                  // grows to 44px without the heading line growing with it
                  // (spec §Density: increase the hit area, never pad).
                  "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-2 pointer-coarse:after:-inset-y-3.5",
                )}
              >
                View all
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {isEmpty ? (
        <p className="well rounded-xl border border-dashed border-border-strong px-4 py-5 text-center text-xs text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div
          className={cn(
            // @container so rows shed columns to fit this panel, not the window.
            "@container overflow-hidden rounded-xl border",
            priority ? "surface-primary border-border-strong" : "surface border-border",
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}
