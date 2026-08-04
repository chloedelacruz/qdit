import { NextResponse } from "next/server";

import { getUser } from "@/lib/supabase/server";
import { HORIZON_URL, isTxHash, type StellarNetwork } from "@/lib/stellar";

/**
 * Spec §8 — paste a transaction hash, confirm it exists, show what it was.
 *
 * Horizon is a plain REST API, so this is a `fetch` and no SDK. `stellar.ts`
 * stays dependency-free by design and its header says network calls belong in a
 * route; this is that route. Nothing here touches the `milestone_proof`
 * contract, so it works today, before anything is deployed.
 */

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
  // Reads a third-party API on demand — behind the auth gate so it cannot be
  // used as an open Horizon proxy.
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
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
