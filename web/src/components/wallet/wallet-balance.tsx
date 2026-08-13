"use client";

import { Loader2, RefreshCw } from "lucide-react";

import type { AccountBalance } from "@/app/api/balance/route";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/stat-tile";
import { formatXlm } from "@/lib/stellar";
import { friendbotUrl } from "@/lib/wallet";

/**
 * The connected wallet's XLM balance.
 *
 * Presentational — the panel above owns the fetch, because the send form has to
 * validate against the same numbers and two components fetching the same
 * account would be two components disagreeing about it.
 *
 * Three tiles rather than one, for the reason `/api/balance` returns three
 * numbers: on Stellar an account cannot spend down to zero, and a single figure
 * invites someone to try. "Spendable" is the one the send form enforces, so it
 * is the one that has to be visible when they type an amount.
 */
export function WalletBalance({
  balance,
  loading,
  error,
  onRefresh,
}: {
  balance: AccountBalance | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <section aria-label="Wallet balance" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Balance</h3>

        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh balance"
        >
          {loading ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <RefreshCw data-icon="inline-start" />
          )}
          Refresh
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {balance && !balance.funded ? (
        <p className="text-sm text-warning">
          This account does not exist on {balance.network} yet, so it holds nothing and
          cannot pay a fee.{" "}
          {balance.network === "testnet" ? (
            <a
              className="underline underline-offset-2"
              href={friendbotUrl(balance.address)}
              target="_blank"
              rel="noreferrer noopener"
            >
              Fund it with Friendbot
            </a>
          ) : (
            "Fund it before sending."
          )}
          , then refresh.
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        <StatTile
          label="Total XLM"
          // A dash, not a zero: "0.00" is a fact about a funded account, and
          // claiming it before the fetch returns would be inventing one.
          value={balance ? formatXlm(balance.balance) : "—"}
          hint="Held by this account"
        />
        <StatTile
          label="Spendable"
          value={balance ? formatXlm(balance.spendable) : "—"}
          hint="After reserve and fee"
        />
        <StatTile
          label="Reserve"
          value={balance ? formatXlm(balance.reserve) : "—"}
          hint={
            balance
              ? `Locked — ${balance.subentryCount} subentr${balance.subentryCount === 1 ? "y" : "ies"}`
              : "Locked by the network"
          }
        />
      </div>
    </section>
  );
}
