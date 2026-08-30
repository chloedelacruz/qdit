"use client";

import { Download } from "lucide-react";

import { HashLink } from "@/components/hash-link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NETWORK_LABELS } from "@/lib/stellar";
import type { MilestoneRow } from "@/lib/queries";

/**
 * Everything that has happened to one milestone, oldest first.
 *
 * A tester explained why this matters better than a spec could: showing only
 * the newest hash tells a funder nothing, and "v1 was rejected on this date, v2
 * was approved on this date" is the story they actually want to be shown. The
 * data was already on the ledger; the app was not reading it back.
 *
 * Anchors and decisions are merged into one list because they are one sequence
 * to a reader. The ledger entry proves a decision happened and names the key
 * that signed it; the review says why. Kept in separate tables, shown as one
 * timeline, and each entry says which of the two it is — because one of them is
 * checkable by a stranger and the other is qdit's word for it.
 */
export function MilestoneHistoryDialog({
  milestone,
  open,
  onOpenChange,
}: {
  milestone: MilestoneRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          <DialogDescription>{milestone.title}</DialogDescription>
        </DialogHeader>

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has happened to this milestone yet — no decisions, and
            nothing anchored.
          </p>
        ) : (
          /* min-w-0 for the same reason the share dialog needs it: a reason can
              contain a long unbroken string, and a grid item will not shrink
              below its content. */
          <ScrollArea className="min-w-0" viewportClassName="max-h-96">
            <ol className="space-y-3 pr-3">
              {entries.map((entry) => (
                <li
                  key={`${entry.kind}-${entry.at}`}
                  className="border-l-2 border-border pl-3"
                >
                  {entry.kind === "anchor" ? (
                    <>
                      <p className="text-sm">
                        {ANCHOR_VERB[entry.anchor.action]}
                        <span className="text-muted-foreground">
                          {" "}
                          — version {entry.anchor.version}
                        </span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
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
                    </>
                  ) : (
                    <>
                      <p className="text-sm">
                        {REVIEW_VERB[entry.review.toStatus] ?? "Moved"}
                        <span className="text-muted-foreground">
                          {" "}
                          by {entry.review.reviewerName}
                        </span>
                      </p>
                      {entry.review.reason ? (
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          “{entry.review.reason}”
                        </p>
                      ) : null}
                    </>
                  )}

                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(entry.at).toLocaleString()}
                    {entry.kind === "anchor"
                      ? ` · ${NETWORK_LABELS[entry.anchor.network]}`
                      : " · in qdit, not on the ledger"}
                  </p>
                </li>
              ))}
            </ol>
          </ScrollArea>
        )}

        {/* The certificate: this same history as one self-contained file a
            regulated tester can archive — the round-2 ask that was specific, "a
            signed export I can attach to a report that still verifies six months
            from now". Offered only once something is on chain, because a
            certificate of nothing is not evidence of anything. */}
        {milestone.anchors.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              A single file, verifiable against the ledger without qdit.
            </p>
            <Button asChild variant="outline" size="sm">
              <a
                href={`/api/export/certificate?project=${milestone.projectSlug}&milestone=${milestone.id}`}
                download
              >
                <Download data-icon="inline-start" />
                Download certificate
              </a>
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
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
