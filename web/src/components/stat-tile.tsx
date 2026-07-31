import { cn } from "@/lib/utils";

/**
 * Dashboard metric tile. Value is the loudest thing on the card; everything
 * else stays muted so a row of tiles reads as one block, not five.
 */
export function StatTile({
  label,
  value,
  hint,
  progress,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  /** 0–1. Renders a hairline bar under the value. */
  progress?: number;
  className?: string;
}) {
  return (
    <div
      data-slot="stat-tile"
      className={cn("rounded-xl bg-card p-4 ring-1 ring-foreground/10", className)}
    >
      <p data-slot="stat-label" className="text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <p data-slot="stat-value" className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>

      {progress !== undefined ? (
        <div
          className="mt-3 h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }}
          />
        </div>
      ) : null}

      {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
