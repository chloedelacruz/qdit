"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { HashLink } from "@/components/hash-link";
import { Button } from "@/components/ui/button";
import {
  prepareProjectRegistration,
  submitProjectRegistration,
} from "@/lib/chain/actions";
import { ICON } from "@/lib/icons";
import type { StellarNetwork } from "@/lib/stellar";
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
      try {
        const signer = (await currentAddress()) ?? (await connectWallet());

        // Same check as the anchor dialog: a wallet on the wrong network fails
        // with an error about a missing account, which explains nothing.
        const walletOn = await walletNetwork();
        if (walletOn !== undefined && walletOn !== network) {
          toast.error(wrongNetworkMessage(walletOn));
          return;
        }

        const prepared = await prepareProjectRegistration(projectId, signer);
        if (!prepared.ok) {
          toast.error(prepared.error);
          return;
        }

        const signed = await signTransaction(prepared.data.xdr);
        const result = await submitProjectRegistration(projectId, signed);

        if (result.error) toast.error(result.error);
        else toast.success("Project registered on chain");
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        if (isRejectedError(message)) return;
        if (isUnfundedError(message)) {
          setUnfunded((await currentAddress()) ?? null);
          return;
        }
        toast.error(message);
      }
    });
  }

  if (registration) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <ICON.anchor className="size-3.5" aria-hidden />
          Registered on chain
        </span>
        <HashLink value={registration.contractId} kind="contract" network={network} />
        <span className="text-muted-foreground">by</span>
        <HashLink value={registration.ownerAddress} kind="account" network={network} />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <p className="text-sm text-muted-foreground">
        Not registered on chain. Only the project owner can register it, and milestones
        cannot be anchored until they do.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={register} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ICON.anchor aria-hidden />}
        Register on chain
      </Button>
      <p className="text-sm text-muted-foreground">
        One transaction, once. The wallet you sign with becomes the only account that can
        approve or reject this project&apos;s milestones on chain — pick the one you intend
        to keep.
      </p>
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
