"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  accountUrl,
  contractUrl,
  truncateHash,
  txUrl,
  type StellarNetwork,
} from "@/lib/stellar";

type Kind = "contract" | "tx" | "account";

const URL_FOR: Record<Kind, (value: string, network: StellarNetwork) => string> = {
  contract: contractUrl,
  tx: txUrl,
  account: accountUrl,
};

const LABEL: Record<Kind, string> = {
  contract: "contract",
  tx: "transaction",
  account: "account",
};

/**
 * Displays a contract ID, tx hash or wallet address: middle-truncated, mono,
 * copyable, and linked to the explorer for the right network.
 */
export function HashLink({
  value,
  kind,
  network,
  lead,
  tail,
  className,
}: {
  value: string;
  kind: Kind;
  network: StellarNetwork;
  lead?: number;
  tail?: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  }

  return (
    <span
      className={cn(
        "well transition-qdit inline-flex items-center gap-1 rounded-md border border-border py-0.5 pr-0.5 pl-2 hover:border-primary/35",
        className,
      )}
    >
      <span data-slot="hash" className="text-xs" title={value}>
        {truncateHash(value, lead, tail)}
      </span>

      <Button
        variant="ghost"
        size="xs"
        className="size-6 px-0"
        aria-label={copied ? "Copied" : `Copy ${LABEL[kind]}`}
        onClick={copy}
      >
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>

      <Button variant="ghost" size="xs" className="size-6 px-0" asChild>
        <a
          href={URL_FOR[kind](value, network)}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`View ${LABEL[kind]} on stellar.expert`}
        >
          <ExternalLink />
        </a>
      </Button>
    </span>
  );
}
