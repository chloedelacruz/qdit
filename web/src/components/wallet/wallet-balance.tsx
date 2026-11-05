"use client";


import type { AccountBalance } from "@/app/api/balance/route";
import { InfoBubble } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/stat-tile";
import { FundTestnetButton } from "@/components/wallet/fund-testnet-button";
import { formatXlm } from "@/lib/stellar";
import { ICON } from "@/lib/icons";

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
            <ICON.spinner className="animate-spin" data-icon="inline-start" />
          ) : (
            <ICON.refresh data-icon="inline-start" />
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
        <div className="space-y-2">
          {/* The consequence sits one tap away; the fact and its fix stay in
              view (QDIT-34). */}
          <div className="flex items-center gap-1.5 text-sm text-warning">
            This account does not exist on {balance.network} yet.
            <InfoBubble label="accounts that do not exist yet">
              <p>
                Until it is funded it holds nothing, so it cannot pay a fee — not for
                a payment, and not for anchoring a milestone.
              </p>
            </InfoBubble>
          </div>
          {balance.network === "testnet" ? (
            /*
              A button rather than the link this used to be. Friendbot's reply
              is raw JSON in a second tab, which told nobody anything, and the
              refresh that made the new balance appear was a third step people
              had to know to take. Funding and re-reading are one action now.
            */
            <FundTestnetButton address={balance.address} onFunded={onRefresh} />
          ) : (
            <p className="text-sm text-muted-foreground">Fund it before sending.</p>
          )}
        </div>
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
