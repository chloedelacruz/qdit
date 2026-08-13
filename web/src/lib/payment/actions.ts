"use server";

import {
  buildPayment,
  submitPayment,
  type PaymentKind,
  type PaymentResult,
} from "@/lib/payment/horizon";
import { paymentSchema } from "@/lib/schemas";
import { isWalletAddress, type StellarNetwork } from "@/lib/stellar";
import { getUser } from "@/lib/supabase/server";

/**
 * Sending XLM, in the two halves a browser-held key forces.
 *
 * `preparePayment` → the wallet signs → `sendPayment`. The pattern, and the
 * reasoning behind it, is `lib/chain/actions.ts`; what differs is what the
 * result means. An anchor is a claim about a milestone and gets a row in the
 * database. A payment is not a claim about anything qdit owns — the ledger is
 * the record, and writing a second copy of it here would only create something
 * that can disagree with the network.
 *
 * So nothing in this file writes to Postgres. The user is handed the hash and a
 * link to the explorer, which is a stronger receipt than a row would be.
 */

const NETWORK: StellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

export type PreparedPayment = {
  xdr: string;
  kind: PaymentKind;
  destination: string;
  amount: string;
  network: StellarNetwork;
};

type Prepared =
  | { ok: true; data: PreparedPayment }
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };

type Sent = { ok: true; data: PaymentResult } | { ok: false; error: string };

/** Signed-in check only. The key is the authority on spending, not the session. */
async function gate(): Promise<string | null> {
  const user = await getUser();
  return user ? null : "Your session expired. Sign in again.";
}

export async function preparePayment(
  signer: string,
  input: { destination: string; amount: string; memo: string },
): Promise<Prepared> {
  const denied = await gate();
  if (denied) return { ok: false, error: denied };

  if (!isWalletAddress(signer)) {
    return { ok: false, error: "That is not a Stellar account address." };
  }

  // Re-validated here rather than trusted from the form: this action is
  // reachable by POST without the form ever being rendered.
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  try {
    const built = await buildPayment({
      source: signer,
      destination: parsed.data.destination,
      amount: parsed.data.amount,
      memo: parsed.data.memo?.trim() || null,
      network: NETWORK,
    });

    return { ok: true, data: built };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function sendPayment(
  signedXdr: string,
  expected: { source: string; destination: string; amount: string },
): Promise<Sent> {
  const denied = await gate();
  if (denied) return { ok: false, error: denied };

  try {
    const result = await submitPayment(signedXdr, expected, NETWORK);

    // Included in a ledger and rejected by it are different outcomes, and the
    // SDK only throws for the second. Reported rather than swallowed, so the UI
    // never shows a green tick over a failed transaction.
    if (!result.successful) {
      return { ok: false, error: `Transaction ${result.txHash} failed on chain.` };
    }

    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/** Network failures arrive as thrown objects; surface the useful part. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/fetch failed|ENOTFOUND|ECONNREFUSED|timeout/i.test(message)) {
    return "Could not reach the network. Try again in a moment.";
  }

  return message;
}
