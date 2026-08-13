"use client";

import { Loader2, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { AccountBalance } from "@/app/api/balance/route";
import { HashLink } from "@/components/hash-link";
import { Button } from "@/components/ui/button";
import { SendPayment } from "@/components/wallet/send-payment";
import { WalletBalance } from "@/components/wallet/wallet-balance";
import { ICON } from "@/lib/icons";
import { NETWORK_LABELS, type StellarNetwork } from "@/lib/stellar";
import { connectWallet, currentAddress, disconnectWallet, isRejectedError, onWalletState } from "@/lib/wallet";

/**
 * Connect, balance, send — the whole wallet surface, in one component because
 * all three are about the same address and it changes underneath them.
 *
 * The address is the only piece of state worth centralising: the balance is
 * derived from it, the send form spends from it, and a person switching account
 * inside their extension has to move all three at once. `onWalletState` is what
 * makes that happen without a reload — the kit reports the switch, the effect
 * below refetches, and a stale balance never survives long enough to be sent
 * against.
 *
 * Nothing here touches the session. Disconnecting drops the browser's link to
 * the wallet; it does not sign anyone out, and the account's registered address
 * is immutable regardless (see `wallet-connect.tsx`).
 */
export function WalletPanel({
  registered,
  network,
}: {
  /** The address this account signs in with, from `profiles.wallet_address`. */
  registered: string | null;
  network: StellarNetwork;
}) {
  const [address, setAddress] = useState<string | undefined>();
  // Distinct from "no wallet": until the kit has answered, we know nothing, and
  // rendering "not connected" in the meantime is a lie that flashes.
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [balance, setBalance] = useState<AccountBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // The kit reads localStorage, so the connected address is unknown until after
  // hydration. Never render it during SSR.
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void currentAddress().then((current) => {
      if (!active) return;
      setAddress(current);
      setReady(true);
    });

    void onWalletState((next) => {
      if (active) setAddress(next);
    }).then((off) => {
      if (active) unsubscribe = off;
      else off();
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const loadBalance = useCallback(async () => {
    if (!address) return;

    setLoadingBalance(true);
    setBalanceError(null);

    try {
      const response = await fetch(
        `/api/balance?address=${encodeURIComponent(address)}&network=${network}`,
      );
      const body = await response.json();

      if (!response.ok) {
        setBalanceError(body.error ?? "Could not read that account's balance.");
        setBalance(null);
      } else {
        setBalance(body as AccountBalance);
      }
    } catch {
      setBalanceError("Could not reach the network. Try again in a moment.");
      setBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }, [address, network]);

  useEffect(() => {
    // Deferred by a microtask rather than called straight from the effect body.
    // `loadBalance` flips the loading flag before it awaits anything, and a
    // state update made synchronously inside an effect cascades a second render
    // before the first has painted — the same shape the connection effect above
    // uses, where the update lands in a `.then`.
    if (address) void Promise.resolve().then(loadBalance);
  }, [address, loadBalance]);

  /*
    A balance belongs to the address it was fetched for, so it is matched rather
    than cleared. Switching account in the extension would otherwise show the
    previous account's XLM for as long as the refetch takes — and that is the
    number someone is about to decide how much to send against.
  */
  const shown = balance && balance.address === address ? balance : null;

  async function connect() {
    setConnecting(true);
    try {
      setAddress(await connectWallet());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isRejectedError(message)) toast.error(message);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await disconnectWallet();
    // The kit emits a state update too, but not in every version and not for
    // every module. Setting it here makes the button's effect unconditional.
    setAddress(undefined);
    toast.success("Wallet disconnected");
  }

  const drifted = Boolean(address && registered && address !== registered);

  return (
    <div className="space-y-5">
      <section aria-label="Wallet connection" className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {!ready ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Checking for a wallet…
            </span>
          ) : address ? (
            <>
              <HashLink value={address} kind="account" network={network} />
              <span className="text-sm text-muted-foreground">
                Connected on {NETWORK_LABELS[network]}
              </span>
              <Button variant="outline" size="sm" onClick={() => void disconnect()}>
                <Unplug data-icon="inline-start" aria-hidden />
                Disconnect
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm text-muted-foreground">No wallet connected.</span>
              <Button size="sm" onClick={() => void connect()} disabled={connecting}>
                {connecting ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <ICON.wallet data-icon="inline-start" aria-hidden />
                )}
                {connecting ? "Waiting for your wallet…" : "Connect wallet"}
              </Button>
            </>
          )}
        </div>

        {drifted ? (
          <p className="text-sm text-warning">
            This is not the address you sign in with. It can still send XLM — it is your
            wallet — but proofs signed from it will be refused.
          </p>
        ) : null}
      </section>

      {address ? (
        <>
          <WalletBalance
            balance={shown}
            loading={loadingBalance}
            error={balanceError}
            onRefresh={() => void loadBalance()}
          />

          <SendPayment
            address={address}
            balance={shown}
            network={network}
            onSent={() => void loadBalance()}
          />
        </>
      ) : null}
    </div>
  );
}
