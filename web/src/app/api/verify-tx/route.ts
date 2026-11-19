import { NextResponse } from "next/server";

import { clientKey, rateLimit } from "@/lib/auth/rate-limit";
import { getUser } from "@/lib/supabase/server";
import { HORIZON_URL, isTxHash, type StellarNetwork } from "@/lib/stellar";

/**
 * Spec §8 — paste a transaction hash, confirm it exists, show what it was.
 *
 * Horizon is a plain REST API, so this is a `fetch` and no SDK. `stellar.ts`
 * stays dependency-free by design and its header says network calls belong in a
 * route; this is that route. Nothing here touches the `milestone_proof`
 * contract, so it works today, before anything is deployed.
 *
 * Open to signed-out callers: the landing page promises that anyone can paste
 * a hash back and get the network's answer, and `/verify` is that page. What
 * stops it being a free Horizon proxy is the rate limit below, not a session:
 * a signed-in user is counted per account, everyone else per client address.
 */

/** A person checking proofs by hand stays far below these. */
export const SIGNED_IN_LIMIT = { limit: 60, windowMs: 60_000 };
export const ANONYMOUS_LIMIT = { limit: 20, windowMs: 60_000 };

export type VerifiedTx = {
  hash: string;
  network: StellarNetwork;
  successful: boolean;
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  feeCharged: string;
  operationCount: number;
  memo: string | null;
};

type HorizonTx = {
  hash: string;
  successful: boolean;
  ledger: number;
  created_at: string;
  source_account: string;
  fee_charged: string | number;
  operation_count: number;
  memo?: string;
};

function isNetwork(value: string): value is StellarNetwork {
  return value === "testnet" || value === "mainnet";
}

export async function GET(request: Request) {
  const user = await getUser();
  const allowed = user
    ? rateLimit(`verify-tx:user:${user.id}`, SIGNED_IN_LIMIT)
    : rateLimit(clientKey(request, "verify-tx"), ANONYMOUS_LIMIT);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many checks. Wait a minute and try again." },
      { status: 429 },
    );
  }

  const { searchParams } = new URL(request.url);
  const hash = (searchParams.get("hash") ?? "").trim();
  const network = searchParams.get("network") ?? "testnet";

  if (!isTxHash(hash)) {
    return NextResponse.json(
      { error: "A transaction hash is 64 hex characters." },
      { status: 400 },
    );
  }

  if (!isNetwork(network)) {
    return NextResponse.json({ error: "Unknown network." }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(`${HORIZON_URL[network]}/transactions/${hash}`, {
      headers: { accept: "application/json" },
      // Ledger history is immutable once written, but a hash that is not found
      // now may exist in a moment — so a miss must not be cached.
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach Horizon. Try again in a moment." },
      { status: 502 },
    );
  }

  if (response.status === 404) {
    return NextResponse.json(
      { error: `No such transaction on ${network}. Check the network.` },
      { status: 404 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: `Horizon returned ${response.status}.` },
      { status: 502 },
    );
  }

  const tx = (await response.json()) as HorizonTx;

  const verified: VerifiedTx = {
    hash: tx.hash,
    network,
    successful: tx.successful,
    ledger: tx.ledger,
    createdAt: tx.created_at,
    sourceAccount: tx.source_account,
    feeCharged: String(tx.fee_charged),
    operationCount: tx.operation_count,
    memo: tx.memo ?? null,
  };

  return NextResponse.json(verified);
}
