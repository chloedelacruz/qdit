"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MILESTONE_OWNER_ONLY,
  MILESTONE_STATUS,
  MILESTONE_TRANSITIONS,
  milestoneActionLabel,
  type MilestoneStatus,
} from "@/lib/constants";
import { updateMilestoneStatus } from "@/lib/actions";
import { cn } from "@/lib/utils";

/**
 * Moves a milestone through the approval flow.
 *
 * Not a status picker. `milestone_status` is the `milestone_proof` contract's
 * state machine, so this offers only the transitions the contract would accept
 * from the current state — Proposed submits, Submitted is approved or rejected
 * by the project owner, Rejected re-submits, Approved is final. A milestone
 * that reached an illegal state here would be a milestone the contract refuses
 * to reproduce once the on-chain call is wired up.
 *
 * `updateMilestoneStatus` re-checks every rule. This only decides what to show.
 */
export function MilestoneStatusMenu({
  milestoneId,
  status,
  isOwner,
  canEdit,
  className,
}: {
  milestoneId: string;
  status: MilestoneStatus;
  /** Approve and reject are the project owner's, matching the contract. */
  isOwner: boolean;
  canEdit: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(status);

  const available = MILESTONE_TRANSITIONS[optimistic].filter(
    (next) => isOwner || !MILESTONE_OWNER_ONLY.includes(next),
  );

  function change(next: MilestoneStatus) {
    startTransition(async () => {
      setOptimistic(next);
      const result = await updateMilestoneStatus(milestoneId, next);

      if (result.error) toast.error(result.error);
    });
  }

  // Approved is terminal, and a non-owner looking at a Submitted milestone has
  // nothing to do either. Render the badge alone rather than a dead control.
  if (!canEdit || available.length === 0) {
    return <StatusBadge state={MILESTONE_STATUS[optimistic]} dot={false} />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Status: ${MILESTONE_STATUS[optimistic].label}. Change status.`}
        className={cn(
          "focus-ring transition-qdit rounded-md",
          "hover:brightness-95 dark:hover:brightness-110",
          pending && "opacity-60",
          className,
        )}
      >
        <StatusBadge state={MILESTONE_STATUS[optimistic]} dot={false} />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>
          {optimistic === "submitted" ? "Decision" : "Move to"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {available.map((next) => (
          <DropdownMenuItem
            key={next}
            variant={next === "rejected" ? "destructive" : "default"}
            onSelect={() => change(next)}
          >
            {milestoneActionLabel(optimistic, next)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
