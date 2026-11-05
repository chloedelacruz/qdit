import { HashLink } from "@/components/hash-link";
import { ICON } from "@/lib/icons";
import type { MilestoneRow } from "@/lib/queries";
import { NETWORK_LABELS } from "@/lib/stellar";
import { cn } from "@/lib/utils";

/**
 * Everything that has happened to one milestone, oldest first — inline on the
 * milestone's page (QDIT-34), where it used to be a dialog behind a hover-only
 * menu.
 *
 * A tester explained why this matters better than a spec could: showing only
 * the newest hash tells a funder nothing, and "v1 was rejected on this date, v2
 * was approved on this date" is the story they want to be shown.
 *
 * Anchors and decisions are one sequence to a reader. Each entry carries a
 * mark for which of the two it is, because one is checkable by a stranger on
 * the ledger and the other is qdit's word for it: the anchor glyph means "on
 * chain", the person glyph means "recorded in qdit".
 */
export function MilestoneTimeline({ milestone }: { milestone: MilestoneRow }) {
  const entries = [
    ...milestone.anchors.map((anchor) => ({
      at: anchor.createdAt,
      kind: "anchor" as const,
      anchor,
    })),
    ...milestone.reviews.map((review) => ({
      at: review.createdAt,
      kind: "review" as const,
      review,
    })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  if (entries.length === 0) return null;

  return (
    <ol className="space-y-0">
      {entries.map((entry) => {
        const onChain = entry.kind === "anchor";
        const Mark = onChain ? ICON.anchor : ICON.assignedToMe;

        return (
          <li
            key={`${entry.kind}-${entry.at}`}
            className="flex min-w-0 gap-3 border-b border-border/70 px-3 py-2.5 last:border-b-0"
          >
            <Mark
              aria-label={onChain ? "On the ledger" : "Recorded in qdit"}
              className={cn(
                "mt-0.5 size-3.5",
                onChain ? "text-success" : "text-muted-foreground",
              )}
            />
            <div className="min-w-0 flex-1">
              {entry.kind === "anchor" ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <p className="text-sm">
                    {ANCHOR_VERB[entry.anchor.action]}
                    <span className="text-muted-foreground"> · v{entry.anchor.version}</span>
                  </p>
                  <HashLink
                    value={entry.anchor.txHash}
                    kind="tx"
                    network={entry.anchor.network}
                    lead={6}
                    tail={6}
                  />
                  <HashLink
                    value={entry.anchor.signerAddress}
                    kind="account"
                    network={entry.anchor.network}
                    lead={4}
                    tail={4}
                  />
                </div>
              ) : (
                <>
                  <p className="text-sm">
                    {REVIEW_VERB[entry.review.toStatus] ?? "Moved"}
                    <span className="text-muted-foreground"> · {entry.review.reviewerName}</span>
                  </p>
                  {entry.review.reason ? (
                    <p className="mt-1 text-sm leading-6 break-words text-muted-foreground">
                      “{entry.review.reason}”
                    </p>
                  ) : null}
                </>
              )}

              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {new Date(entry.at).toLocaleString()}
                {entry.kind === "anchor" ? ` · ${NETWORK_LABELS[entry.anchor.network]}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const ANCHOR_VERB: Record<MilestoneRow["anchors"][number]["action"], string> = {
  submit: "Proof anchored",
  approve: "Approved on chain",
  reject: "Rejected on chain",
};

const REVIEW_VERB: Partial<Record<MilestoneRow["status"], string>> = {
  approved: "Approved",
  rejected: "Rejected",
  submitted: "Submitted for approval",
};
