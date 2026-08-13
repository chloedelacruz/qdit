"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { connectWallet, isRejectedError, signTransaction } from "@/lib/wallet";

/**
 * The front door.
 *
 * Three steps, two of them invisible: pick a wallet, sign a challenge, spend
 * the signature.
 *
 *   1. `connectWallet()` opens the kit's chooser and returns an address.
 *   2. `POST /api/auth/wallet/challenge` returns a transaction the server
 *      signed, which the wallet signs too. It can never be submitted — the
 *      sequence number is 0 — so this costs nothing and touches no ledger.
 *   3. `POST /api/auth/wallet/verify` checks both signatures and answers with
 *      either a session or a registration ticket.
 *
 * The signed challenge is all step 3 receives. The address is deliberately not
 * sent alongside it: the server reads it out of the transaction the signature
 * covers, so there is nothing for a caller to disagree with.
 *
 * What the person sees is one button and then either the dashboard or a short
 * form. Which one is not this component's decision and must not be guessed at
 * from anything local — a wallet that looks new to this browser may have an
 * account, and the server is the only thing that knows. So step 3's `status` is
 * routed on, and nothing else is.
 *
 * Nothing here writes a token. The session arrives as `Set-Cookie` from the
 * route handler, so `router.refresh()` is what makes the app notice it.
 */

type Intent = "sign-in" | "link";

export function ConnectWalletButton({
  intent = "sign-in",
  label = "Connect wallet",
  redirectTo = "/dashboard",
  className,
  size = "lg",
  variant,
  onLinked,
}: {
  intent?: Intent;
  label?: string;
  /** Where a successful sign-in lands. Ignored when linking. */
  redirectTo?: string;
  className?: string;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "ghost" | "secondary";
  /** Called after a successful link, so the caller can refresh its own view. */
  onLinked?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      // The routes phrase their own failures — "already linked to another qdit
      // account", "no longer valid" — and those sentences are better than
      // anything this component could invent from a status code.
      throw new Error(
        typeof payload.error === "string" ? payload.error : "Wallet sign-in failed.",
      );
    }

    return payload;
  }

  async function run() {
    setBusy(true);

    try {
      const address = await connectWallet();
      const { xdr } = await post("/api/auth/wallet/challenge", { address });

      if (typeof xdr !== "string") throw new Error("The server issued no challenge.");

      const signedXdr = await signTransaction(xdr);
      const result = await post("/api/auth/wallet/verify", { signedXdr, intent });

      if (intent === "link") {
        toast.success("Wallet linked");
        onLinked?.();
        router.refresh();
        setBusy(false);
        return;
      }

      // Refresh before navigating: the cookies are new, and the layout that
      // decides whether to render the app or bounce to /login is server-side.
      router.refresh();

      // "signed-in" is the only status that goes anywhere but registration.
      // "registration-required" means there is no account yet and the response
      // carried a ticket to make one; "complete-account" means there is one,
      // made by the retired auto-create flow, still missing the email and
      // password it should have been born with.
      router.push(result.status === "signed-in" ? redirectTo : "/register");

      // Deliberately not clearing `busy`. The navigation is what ends this
      // state, and re-enabling the button first invites a second click that
      // starts a second challenge.
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Closing the wallet chooser, or declining the signature, is a decision.
      // A red toast for it would be scolding someone for changing their mind.
      if (!isRejectedError(message)) toast.error(message);

      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={cn(className)}
      disabled={busy}
      onClick={() => void run()}
    >
      {busy ? (
        <Loader2 className="animate-spin" data-icon="inline-start" />
      ) : (
        <ICON.wallet data-icon="inline-start" aria-hidden />
      )}
      {busy ? "Waiting for your wallet…" : label}
    </Button>
  );
}
