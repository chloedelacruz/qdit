import { TONE_BADGE } from "@/lib/constants";
import { doqtriSnapshotLine, needsDoqtriHint, RESEND_HINT } from "@/lib/hackathon/entry-check-copy";
import { RULE_LABEL } from "@/lib/hackathon/staff-view";
import type { EntryCheck } from "@/lib/hackathon/types";
import { ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * The submission dialog's checklist (WP-4.7, QDIT-55), shown when an item is
 * not met or could not be checked. Every item is listed with the same label
 * and reason staff see, so a team can fix what is missing before it submits,
 * or submit anyway. Worded as a checklist: participant copy never says how
 * entries are assessed (queries.test.ts, "participant copy").
 */
export function EntryCheckPanel({ check }: { check: EntryCheck }) {
  const failed = check.rules.filter((r) => r.passed === false).length;
  const unchecked = check.rules.filter((r) => r.passed === null).length;

  return (
    <section
      aria-labelledby="entry-check-title"
      role="status"
      className="space-y-2 rounded-lg border border-border p-3"
    >
      <h3 id="entry-check-title" className="text-sm font-medium">
        {failed > 0
          ? `Submission checklist: ${failed} ${failed === 1 ? "item" : "items"} not met yet`
          : `Submission checklist: ${unchecked} ${unchecked === 1 ? "item" : "items"} could not be checked`}
      </h3>

      <ul className="space-y-1">
        {check.rules.map((rule) => (
          <li key={rule.id} className="flex items-start gap-2 text-xs">
            <span
              className={cn(
                "mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-sm ring-1 ring-inset",
                TONE_BADGE[rule.passed === true ? "success" : rule.passed === false ? "destructive" : "neutral"],
              )}
            >
              {rule.passed === true ? (
                <ICON.verified aria-hidden className="size-3" />
              ) : rule.passed === false ? (
                <ICON.failed aria-hidden className="size-3" />
              ) : (
                <ICON.pending aria-hidden className="size-3" />
              )}
            </span>
            <span>
              <span className="font-medium">{RULE_LABEL[rule.id]}</span>
              <span className="sr-only">
                {rule.passed === true ? ": passed" : rule.passed === false ? ": not met" : ": not checked"}
              </span>
              <span className="text-muted-foreground"> · {rule.reason}</span>
            </span>
          </li>
        ))}
      </ul>

      {needsDoqtriHint(check) ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ICON.planDoc className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {doqtriSnapshotLine(check.doqtri)} {RESEND_HINT}
          </span>
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Fix what you can, then Check again. Submit anyway sends it as it is; you can resubmit until the close.
      </p>
    </section>
  );
}
