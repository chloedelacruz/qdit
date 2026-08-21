"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
 *
 * ---------------------------------------------------------------------------
 * TWO CHANGES THE TESTERS ASKED FOR
 * ---------------------------------------------------------------------------
 * **A rejection goes through a dialog.** It used to be a menu item: one click,
 * status flips, done — and the person on the other end got a red chip and no
 * explanation. Four testers raised it. The dialog exists to make the reason
 * unavoidable, and the server and the database both refuse a rejection without
 * one, so this is a prompt rather than the enforcement.
 *
 * **Re-submit is a button, not a menu item.** A tester sat on a rejected
 * milestone believing it was a dead end, because the only way forward was
 * hidden inside a dropdown hanging off a status badge that does not look like
 * a control. The way out of the one state people get stuck in should not be
 * something you have to discover.
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
  const [deciding, setDeciding] = useState<MilestoneStatus | null>(null);

  const available = MILESTONE_TRANSITIONS[optimistic].filter(
    (next) => isOwner || !MILESTONE_OWNER_ONLY.includes(next),
  );

  function change(next: MilestoneStatus, reason?: string) {
    startTransition(async () => {
      setOptimistic(next);
      const result = await updateMilestoneStatus(milestoneId, next, reason);

      if (result.error) toast.error(result.error);
    });
  }

  // A decision says something about someone's work, so it gets a dialog. A
  // submission is someone speaking for themselves, and does not.
  function select(next: MilestoneStatus) {
    if (MILESTONE_OWNER_ONLY.includes(next)) setDeciding(next);
    else change(next);
  }

  const badge = <StatusBadge state={MILESTONE_STATUS[optimistic]} dot={false} />;

  // Approved is terminal, and a non-owner looking at a Submitted milestone has
  // nothing to do either. Render the badge alone rather than a dead control.
  if (!canEdit || available.length === 0) return badge;

  // Rejected is the one state with a single way out and a reason to hurry: the
  // badge stays, and the way forward sits beside it in the open.
  if (optimistic === "rejected") {
    return (
      <span className={cn("flex items-center gap-2", className)}>
        {badge}
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={pending}
          onClick={() => change("submitted")}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Re-submit
        </Button>
      </span>
    );
  }

  return (
    <>
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
          {badge}
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
              onSelect={() => select(next)}
            >
              {milestoneActionLabel(optimistic, next)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DecisionDialog
        decision={deciding}
        from={optimistic}
        pending={pending}
        onCancel={() => setDeciding(null)}
        onConfirm={(reason) => {
          const next = deciding;
          setDeciding(null);
          if (next) change(next, reason);
        }}
      />
    </>
  );
}

/**
 * Approve or reject, with the reason attached.
 *
 * Required to reject, optional to approve — an approval that says nothing is
 * still unambiguous, and a rejection that says nothing is the complaint this
 * whole feature answers. The note about where the reason lives is on screen
 * rather than in the docs: someone about to write one deserves to know it is
 * stored in qdit and not on the ledger.
 */
function DecisionDialog({
  decision,
  from,
  pending,
  onCancel,
  onConfirm,
}: {
  decision: MilestoneStatus | null;
  from: MilestoneStatus;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const rejecting = decision === "rejected";
  const empty = reason.trim().length === 0;

  return (
    <Dialog
      open={decision !== null}
      onOpenChange={(open) => {
        if (open) return;
        setReason("");
        onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {decision ? milestoneActionLabel(from, decision) : ""}
          </DialogTitle>
          <DialogDescription>
            {rejecting
              ? "Say what is wrong. Whoever submitted this sees it, and without it they are left guessing."
              : "Add a note if there is anything worth recording. Optional."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="milestone-decision-reason">
            {rejecting ? "Reason" : "Note"}
          </Label>
          <Textarea
            id="milestone-decision-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            maxLength={2000}
            required={rejecting}
            placeholder={
              rejecting
                ? "The deployment link points at the wrong branch."
                : "Anything worth remembering about this decision."
            }
          />
          <p className="text-xs text-muted-foreground">
            Kept in qdit, not on the ledger. Anchoring records that the decision
            happened and which wallet signed it; this is the half that says why.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={rejecting ? "destructive" : "default"}
            disabled={pending || (rejecting && empty)}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {decision ? milestoneActionLabel(from, decision) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
