"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { HashLink } from "@/components/hash-link";
import { Button } from "@/components/ui/button";
import { saveWalletAddress } from "@/lib/actions";
import { ICON } from "@/lib/icons";
import type { StellarNetwork } from "@/lib/stellar";
import {
  connectWallet,
  disconnectWallet,
  currentAddress,
  isRejectedError,
  onWalletState,
} from "@/lib/wallet";

/**
 * Connects a Stellar wallet and records the address on the profile.
 *
 * Two addresses can disagree here, and the difference matters:
 *
 *   `saved`     — `profiles.wallet_address`, what the server knows.
 *   `connected` — what the browser's wallet reports right now.
 *
 * They drift whenever someone switches account inside their wallet extension.
 * The saved one is what other people see; the connected one is what will
 * actually sign. Showing only one of them would make a failed signature
 * inexplicable, so when they differ the component says so and offers to update.
 */
export function WalletConnect({
  saved,
  network,
}: {
  saved: string | null;
  network: StellarNetwork;
}) {
  const [connected, setConnected] = useState<string | undefined>();
  const [busy, startTransition] = useTransition();

  // The kit lives in the browser, so the connected address is unknown until
  // after hydration. Never render it during SSR.
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void currentAddress().then((address) => {
      if (active) setConnected(address);
    });
    void onWalletState((address) => {
      if (active) setConnected(address);
    }).then((off) => {
      if (active) unsubscribe = off;
      else off();
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  function persist(address: string) {
    startTransition(async () => {
      const result = await saveWalletAddress(address);
      if (result.error) toast.error(result.error);
      else toast.success("Wallet address saved");
    });
  }

  function connect() {
    startTransition(async () => {
      try {
        const address = await connectWallet();
        setConnected(address);
        if (address !== saved) persist(address);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Closing the wallet chooser is a decision, not a failure.
        if (!isRejectedError(message)) toast.error(message);
      }
    });
  }

  function disconnect() {
    startTransition(async () => {
      await disconnectWallet();
      setConnected(undefined);
    });
  }

  const drifted = Boolean(connected && saved && connected !== saved);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {saved ? (
          <HashLink value={saved} kind="account" network={network} />
        ) : (
          <span className="text-sm text-muted-foreground">
            Not set — required to sign milestone proofs on-chain.
          </span>
        )}

        {connected ? (
          <Button variant="ghost" size="sm" onClick={disconnect} disabled={busy}>
            Disconnect
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={connect} disabled={busy}>
            <ICON.wallet aria-hidden />
            {saved ? "Reconnect wallet" : "Connect wallet"}
          </Button>
        )}
      </div>

      {drifted ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            Your wallet is on a different account:
          </span>
          <HashLink value={connected!} kind="account" network={network} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => persist(connected!)}
            disabled={busy}
          >
            Use this one
          </Button>
        </div>
      ) : null}

      {connected && !saved ? (
        <p className="text-sm text-muted-foreground">Saving…</p>
      ) : null}
    </div>
  );
}
