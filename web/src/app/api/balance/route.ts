import { NextResponse } from "next/server";

import { getUser } from "@/lib/supabase/server";
import {
  FEE_BUFFER_STROOPS,
  HORIZON_URL,
  fromStroops,
  isWalletAddress,
  minimumBalanceStroops,
  toStroops,
  type StellarNetwork,
} from "@/lib/stellar";

/**
 * The XLM balance of a connected wallet.
 *
 * Same shape as `/api/verify-tx`, and for the same reasons: Horizon is a plain
 * REST API so this is a `fetch` and no SDK, `stellar.ts` stays dependency-free
 * and does the arithmetic, and the route sits behind the auth gate so it cannot
 * be used as an open Horizon proxy.
 *
 * ---------------------------------------------------------------------------
 * WHY THREE NUMBERS AND NOT ONE
 * ---------------------------------------------------------------------------
 * "Balance" is ambiguous on Stellar and the ambiguity costs people money. The
 * protocol will not let an account drop below a minimum tied to how many
 * subentries it holds, so an account showing 1.5 XLM may be able to send
 * nothing at all. Reporting only the total invites someone to try, sign, pay a
 * fee and fail with `tx_insufficient_balance`.
 *
 * So: `balance` is what the account holds, `reserve` is what it cannot touch,
 * and `spendable` is the honest answer to "how much can I send" — the one the
 * send form validates against.
 */

export type AccountBalance = {
  address: string;
  network: StellarNetwork;
  /** False when the account has no entry on this network yet. */
  funded: boolean;
  /** Total native balance, as Horizon reports it. */
  balance: string;
  /** Locked by the minimum-balance rule, plus any selling liabilities. */
  reserve: string;
  /** balance − reserve − fee headroom, floored at zero. */
  spendable: string;
  subentryCount: number;
};

type HorizonBalance = {
  balance: string;
  asset_type: string;
  selling_liabilities?: string;
};

type HorizonAccount = {
  account_id: string;
  subentry_count: number;
  num_sponsoring?: number;
  num_sponsored?: number;
  balances: HorizonBalance[];
};

function isNetwork(value: string): value is StellarNetwork {
  return value === "testnet" || value === "mainnet";
}

/** An account with no ledger entry is a real, expected state — not an error. */
function unfunded(address: string, network: StellarNetwork): AccountBalance {
  return {
    address,
    network,
    funded: false,
    balance: "0.0000000",
    reserve: "0.0000000",
    spendable: "0.0000000",
    subentryCount: 0,
  };
}

export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const address = (searchParams.get("address") ?? "").trim();
  const network = searchParams.get("network") ?? "testnet";

  if (!isWalletAddress(address)) {
    return NextResponse.json(
      { error: "That is not a Stellar account address." },
      { status: 400 },
    );
  }

  if (!isNetwork(network)) {
    return NextResponse.json({ error: "Unknown network." }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(`${HORIZON_URL[network]}/accounts/${address}`, {
      headers: { accept: "application/json" },
      // A balance is the one thing here that must never be stale: it changes
      // with every transaction, including the one just sent from this page.
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach Horizon. Try again in a moment." },
      { status: 502 },
    );
  }

  // 404 means "no such account yet", which on Testnet is one Friendbot click
  // away from being a funded one. The UI says so; it is not a failure.
  if (response.status === 404) {
    return NextResponse.json(unfunded(address, network));
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: `Horizon returned ${response.status}.` },
      { status: 502 },
    );
  }

  const account = (await response.json()) as HorizonAccount;

  // Exactly one native balance exists on every funded account; the rest of the
  // array is trustlines to other assets, which this page does not deal in.
  const native = account.balances.find((entry) => entry.asset_type === "native");
  if (!native) {
    return NextResponse.json(unfunded(address, network));
  }

  const balance = toStroops(native.balance);
  const liabilities = toStroops(native.selling_liabilities ?? "0");
  const minimum = minimumBalanceStroops(
    account.subentry_count,
    account.num_sponsoring ?? 0,
    account.num_sponsored ?? 0,
  );

  const reserve = minimum + liabilities;
  const spendable = balance - reserve - FEE_BUFFER_STROOPS;

  const result: AccountBalance = {
    address,
    network,
    funded: true,
    balance: native.balance,
    reserve: fromStroops(reserve),
    spendable: fromStroops(spendable > 0n ? spendable : 0n),
    subentryCount: account.subentry_count,
  };

  return NextResponse.json(result);
}
