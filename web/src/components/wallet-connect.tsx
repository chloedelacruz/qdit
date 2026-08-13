"use client";

import { useEffect, useState } from "react";

import { ConnectWalletButton } from "@/components/auth/connect-wallet-button";
import { HashLink } from "@/components/hash-link";
import type { StellarNetwork } from "@/lib/stellar";
import { currentAddress, onWalletState } from "@/lib/wallet";

/**
 * Shows the wallet this account is bound to, and — for the accounts that
 * predate the wallet flow — offers to bind one.
 *
 * ---------------------------------------------------------------------------
 * THIS COMPONENT NO LONGER WRITES ANYTHING
 * ---------------------------------------------------------------------------
 * It used to call `saveWalletAddress()` with whatever address the kit reported,
 * including a "Use this one" button that swapped the profile's address whenever
 * the extension was on a different account. Both are gone:
 *
 *   · the address is written by registration, which happens once, and by
 *     `intent: "link"`, which is refused when one is already set;
 *   · `profiles_freeze_wallet_address` rejects the update in the database
 *     regardless of which client sends it.
 *
 * So a drifted extension is now something to *tell* somebody about rather than
 * something to offer to fix. The two addresses still disagree for the same
 * reason they always did — someone switched account inside their wallet — and
 * the consequence has changed: it is no longer "your profile is out of date",
 * it is "the thing about to sign is not the account you registered", which
 * makes a failed signature explicable instead of mysterious.
 */
export function WalletConnect({
  saved,
  network,
}: {
  saved: string | null;
  network: StellarNetwork;
}) {
  const [connected, setConnected] = useState<string | undefined>();

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

  const drifted = Boolean(connected && saved && connected !== saved);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {saved ? (
          <>
            <HashLink value={saved} kind="account" network={network} />
            <span className="text-sm text-muted-foreground">
              Signs you in. Cannot be changed.
            </span>
          </>
        ) : (
          /*
            No address yet — an account created before the wallet flow existed.
            Connecting is the only way to bind one, and it binds exactly once:
            the button proves the address with a signed challenge, which is the
            difference between claiming a wallet and having one.
          */
          <ConnectWalletButton
            intent="link"
            label="Connect wallet"
            size="sm"
            variant="outline"
          />
        )}
      </div>

      {drifted ? (
        <p className="text-sm text-muted-foreground">
          Your wallet extension is on a different account (
          <span className="font-mono text-xs">{connected}</span>). Switch it back
          to the address above to sign proofs from this account.
        </p>
      ) : null}
    </div>
  );
}
