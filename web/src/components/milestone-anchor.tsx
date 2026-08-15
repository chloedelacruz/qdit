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
  type PreparedAnchor,
} from "@/lib/chain/actions";
import { ICON } from "@/lib/icons";
import type { MilestoneAnchor } from "@/lib/queries";
import {
  NETWORK_LABELS,
  formatXlm,
  fromStroops,
  truncateHash,
  type StellarNetwork,
} from "@/lib/stellar";
import { FundTestnetButton } from "@/components/wallet/fund-testnet-button";
import {
  connectWallet,
  currentAddress,
  isRejectedError,
  isUnfundedError,
  signTransaction,
  walletNetwork,
  wrongNetworkMessage,
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
 *   2. the fee that simulation computed is shown, and the flow waits. A tester
 *      asked to see what this costs before the wallet opens; the number already
 *      existed by then and was simply never surfaced.
 *   3. the wallet signs the returned XDR string, and sees nothing else.
 *   4. `submitMilestoneAnchor` — the server re-verifies that the signed
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
  // The prepared, simulated transaction — held between the quote and the
  // signature so the thing signed is exactly the thing that was quoted.
  const [quote, setQuote] = useState<PreparedAnchor | null>(null);
  const [signer, setSigner] = useState<string | null>(null);

  function reset() {
    setStage("idle");
    setError(null);
    setUnfunded(null);
    setDone(null);
    setQuote(null);
    setSigner(null);
  }

  /**
   * Step one: authorize, hash, build, simulate — and stop.
   *
   * This used to run straight on into the signing prompt. It stops now because
   * a tester asked, in as many words, to see the fee before the popup: the
   * simulation is what computes the resource fee, so by the time the wallet
   * opens the number already exists and was simply never shown. Nothing here
   * costs anything or touches the ledger, so quoting first is free.
   */
  function estimate() {
    setError(null);
    setUnfunded(null);

    startTransition(async () => {
      try {
        // Connect on demand rather than up front: someone reading the dialog
        // has not decided to sign yet.
        setStage("preparing");
        const address = (await currentAddress()) ?? (await connectWallet());

        // Ask the wallet what network it is on before building anything for it.
        // Signing on the wrong one produces an RPC error about a missing
        // account, which reads as "this is broken" rather than "switch
        // networks" — and cost a tester most of an evening.
        const walletOn = await walletNetwork();
        if (walletOn !== undefined && walletOn !== network) {
          setError(wrongNetworkMessage(walletOn));
          setStage("idle");
          return;
        }

        const prepared = await prepareMilestoneAnchor(milestoneId, action, address);
        if (!prepared.ok) {
          setError(prepared.error);
          setStage("idle");
          return;
        }

        setSigner(address);
        setQuote(prepared.data);
        setStage("idle");
      } catch (caught) {
        handleFailure(caught);
      }
    });
  }

  /** Step two: sign what was quoted, submit it, record the row. */
  function confirm() {
    if (!quote || !signer) return;

    setError(null);

    startTransition(async () => {
      try {
        setStage("signing");
        const signed = await signTransaction(quote.xdr);

        setStage("submitting");
        const result = await submitMilestoneAnchor(
          milestoneId,
          action,
          signed,
          quote.proofHash,
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
        handleFailure(caught);
      }
    });
  }

  async function handleFailure(caught: unknown) {
    const message = caught instanceof Error ? caught.message : String(caught);
    setStage("idle");

    // Closing the wallet prompt is a decision, not a failure.
    if (isRejectedError(message)) return;
    // An account with no ledger entry cannot pay a fee. On testnet that is
    // one click to fix, so say so instead of showing the raw RPC error.
    if (isUnfundedError(message)) {
      setUnfunded((await currentAddress()) ?? null);
      return;
    }
    setError(message);
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
            <div className="space-y-2">
              <p className="text-warning">
                That account does not exist on {network} yet, so it cannot pay a fee.
              </p>
              {network === "testnet" ? (
                // Funding here, in the dialog, rather than in a second tab that
                // returns JSON and leaves the anchor half-finished behind it.
                <FundTestnetButton
                  address={unfunded}
                  onFunded={() => setUnfunded(null)}
                  label="Fund it with Friendbot"
                />
              ) : (
                <p className="text-muted-foreground">Fund it before signing.</p>
              )}
            </div>
          ) : null}

          {/*
            The quote. Shown before the wallet opens, because the simulation
            that computes this fee has already run by then and the number was
            simply never surfaced — a tester asked for exactly this, and a
            second one wanted it to project what mainnet anchoring would cost
            over a quarter.
          */}
          {quote && !done ? (
            <div className="well space-y-1.5 rounded-md border border-border px-3 py-2">
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Network fee</span>
                <span data-slot="hash" className="text-sm">
                  {quote.feeStroops
                    ? `${formatXlm(fromStroops(BigInt(quote.feeStroops)))} XLM`
                    : "unavailable"}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Simulated against {NETWORK_LABELS[network]}. Paid by the account
                that signs; nothing has been sent yet.
              </p>
              {quote.proofHash ? (
                <p className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">Proof hash</span>
                  <span data-slot="hash" className="text-xs">
                    {truncateHash(quote.proofHash, 8, 8)}
                  </span>
                </p>
              ) : null}
            </div>
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
          {/*
            Two buttons, one at a time. The first quotes and stops; the second
            signs what was quoted. Splitting them is what makes the fee mean
            anything — a number shown at the same instant the wallet opens is a
            number nobody reads.
          */}
          {!done ? (
            quote ? (
              <Button onClick={confirm} disabled={busy}>
                <ICON.anchor aria-hidden />
                Sign and submit
              </Button>
            ) : (
              <Button onClick={estimate} disabled={busy || !registered}>
                {VERB[action]}
              </Button>
            )
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
