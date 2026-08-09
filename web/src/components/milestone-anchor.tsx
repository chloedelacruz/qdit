"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { HashLink } from "@/components/hash-link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  prepareMilestoneAnchor,
  submitMilestoneAnchor,
  type AnchorAction,
} from "@/lib/chain/actions";
import { ICON } from "@/lib/icons";
import type { MilestoneAnchor } from "@/lib/queries";
import type { StellarNetwork } from "@/lib/stellar";
import {
  connectWallet,
  currentAddress,
  friendbotUrl,
  isRejectedError,
  isUnfundedError,
  signTransaction,
} from "@/lib/wallet";

const VERB: Record<AnchorAction, string> = {
  submit: "Anchor proof",
  approve: "Approve on chain",
  reject: "Reject on chain",
};

const EXPLAINER: Record<AnchorAction, string> = {
  submit:
    "Writes a hash of this milestone and its proofs to the ledger. The content stays in qdit — only the hash is published, which is what lets someone else verify it later without being given the data.",
  approve:
    "Records your approval on chain. Only the account that registered this project can do it, and an approved milestone is final on the ledger.",
  reject:
    "Records a rejection on chain. The milestone can be re-anchored afterwards, and the version counter will show that it was.",
};

/**
 * The three-step anchoring flow.
 *
 * The signature has to happen in the browser, so this cannot be a single server
 * action:
 *
 *   1. `prepareMilestoneAnchor` — the server authorizes, hashes the milestone,
 *      builds and *simulates* the transaction. Simulation is what catches an
 *      already-approved milestone before the user is asked to sign, rather than
 *      after they have paid for a failed one.
 *   2. the wallet signs the returned XDR string, and sees nothing else.
 *   3. `submitMilestoneAnchor` — the server re-verifies that the signed
 *      transaction is the one it prepared, submits it, waits for the ledger,
 *      then records the row.
 *
 * Anchoring never changes `milestones.status`. It is a separate act from moving
 * the milestone through the approval flow, and the two are allowed to disagree.
 */
export function MilestoneAnchorDialog({
  milestoneId,
  milestoneTitle,
  action,
  network,
  registered,
  open,
  onOpenChange,
}: {
  milestoneId: string;
  milestoneTitle: string;
  action: AnchorAction;
  network: StellarNetwork;
  /** False when the project has no `create_project_ref` transaction yet. */
  registered: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [stage, setStage] = useState<"idle" | "preparing" | "signing" | "submitting">(
    "idle",
  );
  const [unfunded, setUnfunded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function reset() {
    setStage("idle");
    setError(null);
    setUnfunded(null);
    setDone(null);
  }

  function run() {
    setError(null);
    setUnfunded(null);

    startTransition(async () => {
      try {
        // Connect on demand rather than up front: someone reading the dialog
        // has not decided to sign yet.
        setStage("preparing");
        const signer = (await currentAddress()) ?? (await connectWallet());

        const prepared = await prepareMilestoneAnchor(milestoneId, action, signer);
        if (!prepared.ok) {
          setError(prepared.error);
          setStage("idle");
          return;
        }

        setStage("signing");
        const signed = await signTransaction(prepared.data.xdr);

        setStage("submitting");
        const result = await submitMilestoneAnchor(
          milestoneId,
          action,
          signed,
          prepared.data.proofHash,
        );

        if (result.error) {
          setError(result.error);
          setStage("idle");
          return;
        }

        setDone(signer);
        setStage("idle");
        toast.success(`${VERB[action]} — written to the ledger`);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setStage("idle");

        // Closing the wallet prompt is a decision, not a failure.
        if (isRejectedError(message)) return;
        // An account with no ledger entry cannot pay a fee. On testnet that is
        // one click to fix, so say so instead of showing the raw RPC error.
        if (isUnfundedError(message)) {
          const signer = await currentAddress();
          setUnfunded(signer ?? null);
          return;
        }
        setError(message);
      }
    });
  }

  const busy = pending || stage !== "idle";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{VERB[action]}</DialogTitle>
          <DialogDescription>{milestoneTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">{EXPLAINER[action]}</p>

          {!registered ? (
            <p className="text-warning">
              This project is not registered on chain yet. Its owner has to register it
              from the project overview before any milestone can be anchored.
            </p>
          ) : null}

          {stage !== "idle" ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {stage === "preparing"
                ? "Checking the rules and simulating the transaction…"
                : stage === "signing"
                  ? "Waiting for your wallet…"
                  : "Submitted. Waiting for the ledger to close…"}
            </p>
          ) : null}

          {unfunded ? (
            <p className="text-warning">
              That account does not exist on {network} yet, so it cannot pay a fee.{" "}
              {network === "testnet" ? (
                <a
                  className="underline underline-offset-2"
                  href={friendbotUrl(unfunded)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Fund it with Friendbot
                </a>
              ) : (
                "Fund it before signing."
              )}
              , then try again.
            </p>
          ) : null}

          {error ? <p className="text-destructive">{error}</p> : null}

          {done ? (
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-success">Written to the ledger.</span>
              <span className="text-muted-foreground">Signed by</span>
              <HashLink value={done} kind="account" network={network} />
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {done ? "Close" : "Cancel"}
          </Button>
          {!done ? (
            <Button onClick={run} disabled={busy || !registered}>
              <ICON.anchor aria-hidden />
              {VERB[action]}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Compact "this is on the ledger" indicator for a milestone row.
 *
 * Anchored under a hash that no longer matches the milestone is a real state
 * and worth naming — the proof is still valid evidence of what the milestone
 * *was*, it just is not evidence of what it is now.
 */
export function AnchorBadge({
  anchor,
  stale,
}: {
  anchor: MilestoneAnchor;
  stale: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <ICON.anchor
        className={stale ? "size-3.5 text-warning" : "size-3.5 text-success"}
        aria-hidden
      />
      <HashLink
        value={anchor.txHash}
        kind="tx"
        network={anchor.network}
        lead={4}
        tail={4}
      />
      {stale ? (
        <span className="text-xs text-warning" title="The milestone changed after this was anchored.">
          stale
        </span>
      ) : null}
    </span>
  );
}
