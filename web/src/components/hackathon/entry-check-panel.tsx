import { TONE_BADGE } from "@/lib/constants";
import {
  doqtriHint,
  doqtriSnapshotLine,
  groupEntryRules,
  needsDoqtriHint,
  ruleDetail,
} from "@/lib/hackathon/entry-check-copy";
import { RULE_LABEL } from "@/lib/hackathon/staff-view";
import type { EntryCheck, EntryCheckRule } from "@/lib/hackathon/types";
import { ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * The submission dialog's checklist (WP-4.7, QDIT-55), shown when an item is
 * not met or could not be checked. Every item is listed with the same label
 * and reason staff see, so a team can fix what is missing before it submits,
 * or submit anyway. Worded as a checklist: participant copy never says how
 * entries are assessed (queries.test.ts, "participant copy").
 *
 * Two groups: what qdit reads from the project, and what it reads from the
 * doqtri snapshot. The doqtri group says once which snapshot it read and how
 * to send a newer one, instead of each item repeating it.
 */
export function EntryCheckPanel({ check }: { check: EntryCheck }) {
  const failed = check.rules.filter((r) => r.passed === false).length;
  const unchecked = check.rules.filter((r) => r.passed === null).length;
  const groups = groupEntryRules(check);

  return (
    <section
      aria-labelledby="entry-check-title"
      role="status"
      className="space-y-3 rounded-lg border border-border p-3"
    >
      <h3 id="entry-check-title" className="text-sm font-medium">
        {failed > 0
          ? `Submission checklist: ${failed} ${failed === 1 ? "item" : "items"} not met yet`
          : `Submission checklist: ${unchecked} ${unchecked === 1 ? "item" : "items"} could not be checked`}
      </h3>

      {groups.qdit.length > 0 ? (
        <RuleGroup id="entry-check-qdit" title="qdit project" rules={groups.qdit} check={check} />
      ) : null}

      {groups.doqtri.length > 0 ? (
        <RuleGroup
          id="entry-check-doqtri"
          title="doqtri notes"
          rules={groups.doqtri}
          check={check}
          note={doqtriSnapshotLine(check.doqtri)}
          footer={needsDoqtriHint(check) ? doqtriHint(check) : null}
        />
      ) : null}

      <p className="border-t border-border pt-2.5 text-xs text-muted-foreground">
        Fix what you can, then Check again. Submit anyway sends it as it is; you can resubmit until the close.
      </p>
    </section>
  );
}

function RuleGroup({
  id,
  title,
  rules,
  check,
  note,
  footer,
}: {
  id: string;
  title: string;
  rules: EntryCheckRule[];
  check: EntryCheck;
  note?: string;
  footer?: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h4 id={id} className="text-xs font-medium text-muted-foreground">
          {title}
        </h4>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>
      <ul aria-labelledby={id} className="space-y-1.5">
        {rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} detail={ruleDetail(rule, check)} />
        ))}
      </ul>
      {footer ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ICON.planDoc className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{footer}</span>
        </p>
      ) : null}
    </div>
  );
}

function RuleRow({ rule, detail }: { rule: EntryCheckRule; detail: string | null }) {
  return (
    <li className="flex items-start gap-2 text-xs">
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
      <span className="min-w-0">
        <span className="font-medium">{RULE_LABEL[rule.id]}</span>
        <span className="sr-only">
          {rule.passed === true ? ": passed" : rule.passed === false ? ": not met" : ": not checked"}
        </span>
        {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
      </span>
    </li>
  );
}
