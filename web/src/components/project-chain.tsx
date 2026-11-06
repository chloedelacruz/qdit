"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { HashLink } from "@/components/hash-link";
import { DisabledReason, Hint, InfoBubble } from "@/components/hint";
import { Button } from "@/components/ui/button";
import {
  prepareProjectRegistration,
  submitProjectRegistration,
} from "@/lib/chain/actions";
import { runRegistration } from "@/lib/chain/register-project";
import { ICON } from "@/lib/icons";
import type { StellarNetwork } from "@/lib/stellar";
import { FundTestnetButton } from "@/components/wallet/fund-testnet-button";

/**
 * Registers a project on chain, once.
 *
 * `create_project_ref` has to run before any of the project's milestones can be
 * anchored — `submit_milestone_proof` returns `ProjectNotFound` otherwise. The
 * control is the project owner's alone, and not for the usual permissions
 * reason: **the address that registers is the only one the contract will accept
 * an approval or rejection from afterwards**, regardless of what
 * `project_members` says later. Registering with the wrong wallet is not
 * something a role change can fix.
 */
export function ProjectChainRegistration({
  projectId,
  network,
  registration,
  isOwner,
}: {
  projectId: string;
  network: StellarNetwork;
  registration: {
    contractId: string;
    ownerAddress: string;
    txHash: string;
  } | null;
  isOwner: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [unfunded, setUnfunded] = useState<string | null>(null);

  function register() {
    setUnfunded(null);

    startTransition(async () => {
      const outcome = await runRegistration(network, {
        prepare: (signer) => prepareProjectRegistration(projectId, signer),
        submit: (signedXdr) => submitProjectRegistration(projectId, signedXdr),
      });

      switch (outcome.kind) {
        case "submitted": {
          const { result } = outcome;
          if (result.error) {
            toast.error(result.error);
          } else if (result.pending) {
            // Submitted but not confirmed within the budget. Registration is
            // recorded only once it lands, so tell the truth: it is on the
            // network, and re-running once it confirms is safe — the contract
            // answers "already registered" rather than registering twice.
            toast.message("Submitted — still confirming on chain", {
              description:
                "Registration is saved once it confirms. If it doesn't appear shortly, register again — a landed one is recognised, not duplicated.",
              duration: 10_000,
            });
          } else {
            toast.success("Project registered on chain");
          }
          return;
        }
        case "unfunded":
          setUnfunded(outcome.address);
          return;
        case "wrong_network":
          toast.error(outcome.message);
          return;
        case "error":
          toast.error(outcome.message);
          return;
        case "declined":
        case "no_wallet":
          // The button is still here; closing the prompt needs no message.
          return;
      }
    });
  }

  if (registration) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ICON.anchor className="size-3.5 text-success" aria-hidden />
          On chain
        </span>
        <HashLink value={registration.contractId} kind="contract" network={network} />
        <Hint label="Owner account — the only one that can approve or reject on chain">
          <button
            type="button"
            aria-label="Owner account"
            className="focus-ring flex items-center gap-1 rounded-sm"
          >
            <ICON.assignedToMe className="size-3.5 text-muted-foreground" />
          </button>
        </Hint>
        <HashLink value={registration.ownerAddress} kind="account" network={network} />
      </div>
    );
  }

  const explainer = (
    <InfoBubble label="on-chain registration">
      <p>
        One transaction, once. The wallet that signs becomes the only account
        that can approve or reject this project&apos;s milestones on chain —
        pick the one you intend to keep. Until then, no milestone can be
        anchored.
      </p>
    </InfoBubble>
  );

  if (!isOwner) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ICON.unregistered className="size-3.5 text-warning" aria-hidden />
          Not on chain
        </span>
        <DisabledReason reason="Only the project owner can register it.">
          <Button variant="outline" size="sm" disabled>
            <ICON.anchor aria-hidden />
            Register on chain
          </Button>
        </DisabledReason>
        {explainer}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ICON.unregistered className="size-3.5 text-warning" aria-hidden />
          Not on chain
        </span>
        <Button variant="outline" size="sm" onClick={register} disabled={pending}>
          {pending ? <ICON.spinner className="animate-spin" aria-hidden /> : <ICON.anchor aria-hidden />}
          Register on chain
        </Button>
        {explainer}
      </div>
      {unfunded ? (
        <div className="space-y-2">
          <p className="text-sm text-warning">
            That account does not exist on {network} yet, so it cannot pay a fee.
          </p>
          {network === "testnet" ? (
            <FundTestnetButton
              address={unfunded}
              onFunded={() => setUnfunded(null)}
              label="Fund it with Friendbot"
            />
          ) : (
            <p className="text-sm text-muted-foreground">Fund it before signing.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
