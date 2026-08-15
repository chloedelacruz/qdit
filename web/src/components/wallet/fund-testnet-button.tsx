"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fundTestnetAccount } from "@/lib/wallet";

/**
 * Funds a Testnet account with Friendbot, in place.
 *
 * This replaces a link. The link opened Friendbot's raw JSON in a second tab
 * and left people to work out for themselves whether it had worked, which
 * assumes they already knew what Friendbot was — and the single worst rating in
 * the tester round came from someone who learned about it from a group chat
 * after nearly an hour of trying to get in.
 *
 * So it is a button, it reports its own outcome, and it tells the page above it
 * to re-read the balance when it succeeds. "Already funded" arrives here as a
 * thrown error and is shown as ordinary information, because it is: the account
 * is in exactly the state the person was trying to reach.
 */
export function FundTestnetButton({
  address,
  onFunded,
  size = "sm",
  variant = "outline",
  className,
  label = "Fund with Friendbot",
}: {
  address: string;
  /** Called after a successful fund, so the caller can refetch its balance. */
  onFunded?: () => void;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "ghost" | "secondary";
  className?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setBusy(true);

    try {
      await fundTestnetAccount(address);
      toast.success("Funded with 10,000 test XLM");
      startTransition(() => onFunded?.());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Already funded is the goal state, not a failure. Refresh anyway — the
      // balance on screen is the thing that was wrong.
      if (/already funded/i.test(message)) {
        toast.info(message);
        startTransition(() => onFunded?.());
      } else {
        toast.error(message);
      }
    } finally {
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
      {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
      {busy ? "Funding…" : label}
    </Button>
  );
}
