"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { Hint } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  accountUrl,
  contractUrl,
  truncateHash,
  txUrl,
  type StellarNetwork,
} from "@/lib/stellar";
import { ICON } from "@/lib/icons";

type Kind = "contract" | "tx" | "account";

const URL_FOR: Record<Kind, (value: string, network: StellarNetwork) => string> = {
  contract: contractUrl,
  tx: txUrl,
  account: accountUrl,
};

const LABEL: Record<Kind | "hash", string> = {
  contract: "contract",
  tx: "transaction",
  account: "account",
  hash: "hash",
};

/**
 * Displays a contract ID, tx hash or wallet address: middle-truncated, mono,
 * copyable, and linked to the explorer for the right network.
 *
 * `kind="hash"` is a digest that is not a ledger object, such as a proof hash
 * (the SHA-256 of a milestone's content): shown and copyable the same way,
 * with no explorer link, because stellar.expert has no page for it (D-83).
 *
 * The two icon-only buttons carry their name in `aria-label` and, once the
 * page is interactive, in a `Hint` too (QDIT-34, spec §Iconography). The
 * hint is added only after hydration, on purpose: the public proof page
 * renders this component and is guarded by a golden-HTML test, and the
 * static renders in the unit tests have no `TooltipProvider` to hang a
 * tooltip on. A tooltip is a pointer and focus affordance with nothing to
 * draw on the server, so the server markup stays exactly what it was. The
 * `title` on the truncated value stays as well — it is the full value, which
 * is the one thing `title=` is still for.
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
  lead?: number;
  tail?: number;
  className?: string;
} & ({ kind: Kind; network: StellarNetwork } | { kind: "hash"; network?: undefined })) {
  const [copied, setCopied] = useState(false);
  const hydrated = useHydrated();

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

      <WithHint on={hydrated} label={copied ? "Copied" : `Copy ${LABEL[kind]}`}>
        <Button
          variant="ghost"
          size="xs"
          className="size-6 px-0 pointer-coarse:size-11"
          aria-label={copied ? "Copied" : `Copy ${LABEL[kind]}`}
          onClick={copy}
        >
          {copied ? <ICON.copied className="text-success" /> : <ICON.copy />}
        </Button>
      </WithHint>

      {kind !== "hash" && network ? (
        <WithHint on={hydrated} label={`View ${LABEL[kind]} on stellar.expert`}>
          <Button variant="ghost" size="xs" className="size-6 px-0 pointer-coarse:size-11" asChild>
            <a
              href={URL_FOR[kind](value, network)}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`View ${LABEL[kind]} on stellar.expert`}
            >
              <ICON.external />
            </a>
          </Button>
        </WithHint>
      ) : null}
    </span>
  );
}

const noSubscription = () => () => {};

/**
 * False during SSR and hydration, true from the first client render after.
 * `useSyncExternalStore` rather than a mount effect: the server snapshot is
 * what hydration uses, so the first client render matches the server markup
 * and there is no state update inside an effect to cascade a second render.
 */
function useHydrated() {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

function WithHint({
  on,
  label,
  children,
}: {
  on: boolean;
  label: string;
  children: React.ReactElement;
}) {
  return on ? <Hint label={label}>{children}</Hint> : children;
}
