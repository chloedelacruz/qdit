import { ListSkeleton } from "@/components/data-list";

/**
 * Route-level fallback. Mirrors the real page's geometry — header block, filter
 * bar, list — so the layout does not jump when content arrives.
 */
export function PageSkeleton({
  rows = 6,
  className = "mx-auto max-w-5xl",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={className} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="mb-6 space-y-2">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="h-8 w-52 animate-pulse rounded-lg bg-muted" />
        <div className="h-8 w-24 animate-pulse rounded-lg bg-muted" />
        <div className="h-8 w-24 animate-pulse rounded-lg bg-muted" />
      </div>

      <ListSkeleton rows={rows} />
    </div>
  );
}
