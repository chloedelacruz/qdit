import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/page-header";
import {
  DEFAULT_LIMIT,
  serialiseFilters,
  hasActiveFilters,
  type Filters,
} from "@/lib/filters";
import { cn } from "@/lib/utils";

/**
 * A dense, flush list — hairline dividers, no card per row.
 *
 * Cards cost ~28px of chrome per item, which is affordable at three rows and
 * absurd at fifty. Rows also give the accent somewhere meaningful to live: the
 * `.row` utility paints a brand rail on the leading edge on hover.
 */
export function ListRow({
  href,
  active,
  className,
  children,
}: {
  href?: string;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const classes = cn(
    // ~34px at a single line of 13px text — spec §Density puts rows at 32–36px.
    "row focus-ring block border-b border-border/70 px-3 py-2 last:border-b-0",
    // Named group so RowActions can stay invisible until the row is hovered or
    // something inside it takes focus. Named, not bare `group`, because rows
    // nest inside panels that already use one.
    "group/row",
    className,
  );

  if (!href) {
    return (
      <div className={classes} data-active={active ? "true" : undefined}>
        {children}
      </div>
    );
  }

  return (
    <Link href={href} className={classes} data-active={active ? "true" : undefined}>
      {children}
    </Link>
  );
}

/** The muted, dot-separated metadata line that sits under a row title. */
export function RowMeta({
  items,
  className,
}: {
  items: (string | null | undefined)[];
  className?: string;
}) {
  const visible = items.filter((item): item is string => Boolean(item));
  if (visible.length === 0) return null;

  return (
    <p className={cn("truncate text-xs text-muted-foreground", className)}>
      {visible.join(" · ")}
    </p>
  );
}

/** Initials chip for an assignee. Unassigned reads as a dashed outline. */
export function MemberChip({
  initials,
  name,
  className,
}: {
  initials: string | null;
  name: string;
  className?: string;
}) {
  return (
    <span
      title={name}
      aria-label={name}
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-medium",
        initials
          ? "bg-accent text-accent-foreground"
          : "border border-dashed border-border-strong text-muted-foreground",
        className,
      )}
    >
      {initials ?? "–"}
    </span>
  );
}

/**
 * Wraps a list with the three states it can actually be in — genuinely empty,
 * filtered to nothing, or showing rows — plus a progressive "Load more" that
 * raises `limit` in the URL rather than holding client state.
 */
export function DataList({
  filters,
  total,
  matched,
  shown,
  noun,
  empty,
  children,
}: {
  filters: Filters;
  total: number;
  matched: number;
  shown: number;
  /** Plural noun for the counter, e.g. "tasks". */
  noun: string;
  empty: { icon?: React.ComponentType<{ className?: string }>; title: string; description?: string; action?: React.ReactNode };
  children: React.ReactNode;
}) {
  // Nothing exists yet — teach the interface rather than report a void.
  if (total === 0) {
    return (
      <EmptyState
        icon={empty.icon}
        title={empty.title}
        description={empty.description}
        action={empty.action}
      />
    );
  }

  // Something exists, but the filter excluded all of it. Different problem,
  // different fix — offer to clear rather than to create.
  if (matched === 0) {
    return (
      <EmptyState
        title={`No ${noun} match these filters`}
        description={`All ${total} ${noun} in this view were filtered out. Try widening or clearing your filters.`}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="?">Clear filters</Link>
          </Button>
        }
      />
    );
  }

  const remaining = matched - shown;
  const nextQuery = serialiseFilters({ ...filters, limit: filters.limit + DEFAULT_LIMIT });

  return (
    <div>
      {/* @container: rows drop optional columns based on this element's width,
          not the viewport's, so the same row works full-width and in a panel. */}
      <div className="surface @container overflow-hidden rounded-xl border border-border">
        {children}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 px-1">
        <p className="text-xs text-muted-foreground tabular-nums">
          Showing {shown} of {matched}
          {hasActiveFilters(filters) && matched !== total ? (
            <span className="text-muted-foreground/70"> (filtered from {total})</span>
          ) : null}{" "}
          {noun}
        </p>

        {remaining > 0 ? (
          <Button asChild variant="outline" size="sm">
            {/* Query-only href keeps the current pathname. */}
            <Link href={`?${nextQuery}`} scroll={false}>
              Load {Math.min(remaining, DEFAULT_LIMIT)} more
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Row-shaped skeleton, for `loading.tsx`. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="surface overflow-hidden rounded-xl border border-border">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-b border-border/70 px-3 py-2.5 last:border-b-0"
        >
          <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
