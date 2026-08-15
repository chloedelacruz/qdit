"use client";

import { useCallback, useEffect, useState } from "react";

import { FundTestnetButton } from "@/components/wallet/fund-testnet-button";
import { ICON } from "@/lib/icons";
import { NETWORK_LABELS, type StellarNetwork } from "@/lib/stellar";
import {
  APP_NETWORK,
  accountExists,
  currentAddress,
  hasWalletInstalled,
  onWalletState,
  walletNetwork,
} from "@/lib/wallet";
import { cn } from "@/lib/utils";

/**
 * What you need before "Connect wallet" can work.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The sign-in page used to be a single button, and the tester round was blunt
 * about what that assumed. Three of twenty said some version of the same thing:
 * nothing on the page says you need a wallet extension, that it has to be on
 * Testnet, or that a fresh account holds nothing until Friendbot funds it. One
 * spent close to an hour on it and rated the product 1. Another got through in
 * ten minutes, said so, and then watched someone without Stellar experience sit
 * on the connect screen for fifteen minutes believing the site was broken.
 *
 * None of that was a bug. It was a page that only made sense to people who
 * already knew the answer.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CAN AND CANNOT KNOW
 * ---------------------------------------------------------------------------
 * Step 1 is answerable immediately — the kit can see which wallets announce
 * themselves to the page. Steps 2 and 3 need a wallet to talk to, so before a
 * connection they render as instructions rather than as failures. That
 * distinction is the whole design: an unchecked step here means "not yet
 * confirmed", never "you got this wrong". Nothing turns red because someone has
 * not done something yet.
 *
 * Detection is best-effort by nature — a wallet may decline to answer, Horizon
 * may be unreachable — so every check has an "unknown" state and unknown reads
 * as neutral. The instruction is still on screen either way, which is the part
 * that was actually missing.
 */

type StepState = "unknown" | "pending" | "done";

export function WalletSetup({ className }: { className?: string }) {
  const [installed, setInstalled] = useState<StepState>("unknown");
  const [address, setAddress] = useState<string | undefined>();
  const [network, setNetwork] = useState<StellarNetwork | null | undefined>();
  const [funded, setFunded] = useState<{ address: string; exists: boolean } | null>(
    null,
  );

  // Everything here lives in the browser: the kit reads localStorage, Horizon
  // is a fetch, and none of it is knowable during SSR.
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void hasWalletInstalled().then((present) => {
      if (active) setInstalled(present ? "done" : "pending");
    });

    void currentAddress().then((found) => {
      if (active) setAddress(found);
    });

    void walletNetwork().then((found) => {
      if (active) setNetwork(found);
    });

    void onWalletState((nextAddress, nextNetwork) => {
      if (!active) return;
      setAddress(nextAddress);
      setNetwork(nextNetwork);
      // A connected wallet is, self-evidently, an installed one — and it may
      // be one the pre-connect scan could not see.
      if (nextAddress) setInstalled("done");
    }).then((off) => {
      if (active) unsubscribe = off;
      else off();
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  // Horizon's answer is stored with the address it was about. Someone switching
  // account in their wallet must not keep the previous account's tick — the
  // pair goes stale together, and a mismatch reads as "not confirmed yet".
  useEffect(() => {
    if (!address) return;

    let active = true;
    void accountExists(address).then((exists) => {
      if (active && exists !== undefined) setFunded({ address, exists });
    });

    return () => {
      active = false;
    };
  }, [address]);

  const recheckFunding = useCallback(() => {
    if (!address) return;

    void accountExists(address).then((exists) => {
      if (exists !== undefined) setFunded({ address, exists });
    });
  }, [address]);

  const networkState: StepState =
    network === undefined ? "unknown" : network === APP_NETWORK ? "done" : "pending";

  const fundedState: StepState =
    address && funded?.address === address
      ? funded.exists
        ? "done"
        : "pending"
      : "unknown";

  const wrongNetwork = network !== undefined && network !== APP_NETWORK;

  return (
    <div className={cn("space-y-3", className)}>
      <h2 className="text-sm font-medium">Before you connect</h2>

      <ol className="space-y-2.5">
        <Step index={1} state={installed} title="Install a Stellar wallet">
          {installed === "done" ? (
            "A wallet is available in this browser."
          ) : (
            <>
              qdit signs in with your wallet.{" "}
              <a
                className="underline underline-offset-2"
                href="https://www.freighter.app/"
                target="_blank"
                rel="noreferrer noopener"
              >
                Freighter
              </a>{" "}
              is the usual choice — install it, then reload this page.
            </>
          )}
        </Step>

        <Step
          index={2}
          state={networkState}
          title={`Switch it to ${NETWORK_LABELS[APP_NETWORK]}`}
        >
          {wrongNetwork
            ? `Your wallet is on ${network ? NETWORK_LABELS[network] : "another network"}. Nothing here will work until it is on ${NETWORK_LABELS[APP_NETWORK]}.`
            : networkState === "done"
              ? `Your wallet is on ${NETWORK_LABELS[APP_NETWORK]}.`
              : `qdit runs on ${NETWORK_LABELS[APP_NETWORK]}. Wallets ship set to Mainnet, where this app's contract does not exist.`}
        </Step>

        <Step index={3} state={fundedState} title="Fund your account">
          {fundedState === "done" ? (
            "Your account exists on the network and can pay fees."
          ) : address ? (
            <div className="space-y-2">
              <p>
                A brand-new account holds nothing until it is funded, and
                anchoring a milestone costs a fee. Friendbot hands out test XLM
                for free.
              </p>
              {APP_NETWORK === "testnet" ? (
                <FundTestnetButton address={address} onFunded={recheckFunding} />
              ) : null}
            </div>
          ) : (
            "A brand-new account holds nothing until it is funded. Once you connect, this step funds it for you."
          )}
        </Step>
      </ol>
    </div>
  );
}

/**
 * One step. The marker carries the state so the text never has to — a done step
 * says what is true, a pending one says what to do, and neither shouts.
 */
function Step({
  index,
  state,
  title,
  children,
}: {
  index: number;
  state: StepState;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          "transition-qdit mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
          state === "done"
            ? "border-success/40 bg-success/15 text-success"
            : "border-border-strong text-muted-foreground",
        )}
      >
        {state === "done" ? <ICON.ready className="size-3" /> : index}
      </span>

      <div className="min-w-0 space-y-1">
        <p className="text-sm leading-5">
          {title}
          {state === "done" ? <span className="sr-only"> — done</span> : null}
        </p>
        <div className="text-xs leading-5 text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}
