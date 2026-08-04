import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A titled block of rows. Shared by the dashboard panels and the project
 * overview, which were previously two near-identical local copies.
 *
 * `priority` marks the page's primary object (spec §Visual Priority): it steps
 * the container up one elevation and gives the heading icon the accent. Exactly
 * one Section per page should set it — a second cancels the first out.
 */
export function Section({
  icon: Icon,
  title,
  count,
  href,
  priority = false,
  empty,
  className,
  children,
}: {
  icon: LucideIcon;
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
    <section className={className} aria-labelledby={headingId}>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold">
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

        {href ? (
          <Link
            href={href}
            aria-label={`View all ${title.toLowerCase()}`}
            className="transition-qdit shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            View all
          </Link>
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
