"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { savePitchOrder } from "@/lib/hackathon/staff-actions";
import { ICON } from "@/lib/icons";

export interface PitchFinalist {
  submission_id: string;
  team_name: string;
}

/** Moves item `i` by `delta`, clamped to the list. Pure, for the buttons below. */
export function move<T>(list: readonly T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/**
 * The order finalists pitch in (WP-4.7): up and down, then Save, which sends
 * the whole list to set_pitch_order. Judges see this order.
 */
export function StaffPitchOrder({
  hackathonId,
  finalists,
}: {
  hackathonId: string;
  finalists: PitchFinalist[];
}) {
  const [order, setOrder] = useState(finalists);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = order.some((f, i) => f.submission_id !== finalists[i]?.submission_id);

  return (
    <div>
      <ol className="divide-y divide-border">
        {order.map((f, i) => (
          <li key={f.submission_id} className="flex min-h-9 items-center gap-3 px-3 py-1 text-sm">
            <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{f.team_name}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Move ${f.team_name} up`}
              disabled={i === 0 || pending}
              onClick={() => setOrder((o) => move(o, i, -1))}
            >
              <ICON.chevronDown className="rotate-180" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Move ${f.team_name} down`}
              disabled={i === order.length - 1 || pending}
              onClick={() => setOrder((o) => move(o, i, 1))}
            >
              <ICON.chevronDown />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2">
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() =>
            start(async () => {
              const result = await savePitchOrder(
                hackathonId,
                order.map((f) => f.submission_id),
              );
              setError(result.ok ? null : (result.error ?? "Could not save."));
              if (result.ok) toast.success("Pitch order saved.");
            })
          }
        >
          {pending ? <ICON.spinner className="animate-spin" data-icon="inline-start" /> : null}
          Save pitch order
        </Button>
        {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
