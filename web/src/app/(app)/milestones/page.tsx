import type { Metadata } from "next";

import { HashLink } from "@/components/hash-link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { MILESTONE_STATUS } from "@/lib/constants";
import { DEMO_MILESTONES } from "@/lib/placeholder-data";

export const metadata: Metadata = { title: "Milestones" };

export default function MilestonesPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Milestones"
        description="Proposed → Submitted → Approved. Each one carries its own proof of work."
      />

      <div className="flex flex-col gap-3">
        {DEMO_MILESTONES.map((milestone) => {
          const progress =
            milestone.taskCount === 0 ? 0 : milestone.doneCount / milestone.taskCount;

          return (
            <Card key={milestone.id}>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{milestone.title}</p>
                    <p className="text-xs text-muted-foreground">{milestone.project}</p>
                  </div>
                  <StatusBadge state={MILESTONE_STATUS[milestone.status]} />
                </div>

                <div
                  className="h-1 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={Math.round(progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${milestone.title} progress`}
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {milestone.doneCount}/{milestone.taskCount} tasks
                  </span>
                  {milestone.txHash ? (
                    <HashLink value={milestone.txHash} kind="tx" network={milestone.network} />
                  ) : (
                    <span className="text-xs text-muted-foreground italic">No proof attached</span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
