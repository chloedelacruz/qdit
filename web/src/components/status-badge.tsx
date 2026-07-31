import { cn } from "@/lib/utils";
import { TONE_BADGE, TONE_DOT, type Tone } from "@/lib/constants";

/**
 * One badge for every state machine in the app. Takes a resolved
 * `{ label, tone }` so callers pass e.g. `TASK_STATUS[task.status]` directly and
 * no component has to know about a specific enum.
 */
export function StatusBadge({
  state,
  dot = true,
  className,
}: {
  state: { label: string; tone: Tone };
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_BADGE[state.tone],
        className,
      )}
    >
      {dot ? <span className={cn("size-1.5 rounded-full", TONE_DOT[state.tone])} /> : null}
      {state.label}
    </span>
  );
}
