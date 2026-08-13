import "server-only";

import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  NotFoundError,
  Operation,
  TransactionBuilder,
  TransactionFailedError,
} from "@stellar/stellar-sdk";

import { NETWORK_PASSPHRASE } from "@/lib/chain/client";
import { HORIZON_URL, fromStroops, toStroops, type StellarNetwork } from "@/lib/stellar";

/**
 * Server half of a native XLM payment.
 *
 * The same three-step shape as `lib/chain/client.ts`, because the constraint is
 * the same one: the key lives in the browser, so no single server action can own
 * the transaction.
 *
 *   1. `buildPayment`  — load the source account, pick the operation, hand back
 *                        unsigned base64 XDR;
 *   2. the browser     — the wallet signs that string and nothing else;
 *   3. `submitPayment` — re-derive what the signed transaction is allowed to be,
 *                        then submit it to Horizon.
 *
 * Step 3 matters for the same reason it does over there: the signed XDR arrives
 * from the client and is therefore untrusted. `assertPayment` refuses anything
 * that is not the payment the server was asked to prepare, so the confirmation
 * the user is shown cannot describe a different transaction from the one that
 * was actually submitted.
 *
 * Classic operations go to Horizon rather than the Soroban RPC. Both would
 * accept the envelope, but Horizon is the endpoint that reports back the result
 * codes — `op_underfunded` and friends — which are the whole difference between
 * "it failed" and a sentence someone can act on.
 */

/**
 * Sending to an account that does not exist yet is a *different operation*.
 *
 * `payment` to an unfunded address fails with `op_no_destination`: on Stellar an
 * account only exists once something has funded it into existence, and the
 * operation that does that is `createAccount`. The distinction is invisible to
 * the person typing an address — they are "sending XLM" either way — so the
 * server picks the right operation rather than making them understand why their
 * payment bounced.
 */
export type PaymentKind = "payment" | "createAccount";

/** The minimum a `createAccount` may start an account with: two base reserves. */
const MINIMUM_STARTING_BALANCE_STROOPS = 10_000_000n;

/** Long enough to read a wallet prompt and decide, short enough to expire. */
const TIMEOUT_SECONDS = 180;

export type BuiltPayment = {
  xdr: string;
  kind: PaymentKind;
  /** Echoed back so the confirmation shows what was built, not what was typed. */
  destination: string;
  amount: string;
  network: StellarNetwork;
};

export type PaymentRequest = {
  source: string;
  destination: string;
  amount: string;
  memo: string | null;
  network: StellarNetwork;
};

function horizon(network: StellarNetwork): Horizon.Server {
  return new Horizon.Server(HORIZON_URL[network]);
}

/** True when Horizon has no entry for this account — unfunded, not broken. */
function isNotFound(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 404 || error instanceof NotFoundError;
}

async function exists(
  server: Horizon.Server,
  address: string,
): Promise<Horizon.AccountResponse | null> {
  try {
    return await server.loadAccount(address);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function buildPayment(request: PaymentRequest): Promise<BuiltPayment> {
  const { source, destination, amount, memo, network } = request;

  if (source === destination) {
    throw new Error("That is this wallet's own address — send to a different account.");
  }

  const server = horizon(network);

  const account = await exists(server, source);
  if (!account) {
    throw new Error(
      "This account does not exist on the network yet, so it cannot pay a fee.",
    );
  }

  const kind: PaymentKind = (await exists(server, destination))
    ? "payment"
    : "createAccount";

  if (kind === "createAccount" && toStroops(amount) < MINIMUM_STARTING_BALANCE_STROOPS) {
    throw new Error(
      `That account does not exist yet, so this payment would create it — which takes at least ${fromStroops(
        MINIMUM_STARTING_BALANCE_STROOPS,
      )} XLM.`,
    );
  }

  // The recommended fee moves with network congestion. Falling back to the
  // protocol floor is right when Horizon will not say: a transaction that is
  // underpriced gets queued, not lost.
  let fee = BASE_FEE;
  try {
    fee = String(await server.fetchBaseFee());
  } catch {
    // Keep BASE_FEE.
  }

  const builder = new TransactionBuilder(account, {
    fee,
    networkPassphrase: NETWORK_PASSPHRASE[network],
  })
    .addOperation(
      kind === "payment"
        ? Operation.payment({ destination, asset: Asset.native(), amount })
        : Operation.createAccount({ destination, startingBalance: amount }),
    )
    // Without a timebound a signed transaction stays submittable forever, which
    // means a wallet prompt someone ignored today is a live payment tomorrow.
    .setTimeout(TIMEOUT_SECONDS);

  if (memo) builder.addMemo(Memo.text(memo));

  return {
    xdr: builder.build().toXDR(),
    kind,
    destination,
    amount,
    network,
  };
}

export type PaymentResult = {
  txHash: string;
  ledger: number;
  successful: boolean;
  /** Source account of the submitted transaction — the address that signed. */
  signer: string;
};

/**
 * Reject a signed transaction that is not the one we prepared.
 *
 * A wallet will sign whatever it is handed, and what comes back is a string the
 * client could have replaced wholesale. So every field the confirmation is about
 * to assert gets re-derived from the envelope: one operation, native asset, the
 * expected destination, the expected amount, the expected source.
 */
function assertPayment(
  envelopeXdr: string,
  expected: { source: string; destination: string; amount: string },
  network: StellarNetwork,
): void {
  const tx = TransactionBuilder.fromXDR(envelopeXdr, NETWORK_PASSPHRASE[network]);

  if ("innerTransaction" in tx) {
    throw new Error("Fee-bump transactions are not accepted here.");
  }
  if (tx.operations.length !== 1) {
    throw new Error("Expected exactly one operation in the signed transaction.");
  }
  if (tx.source !== expected.source) {
    throw new Error("The signed transaction is from a different account.");
  }

  const operation = tx.operations[0];
  const wanted = toStroops(expected.amount);

  if (operation.type === "payment") {
    if (!operation.asset.isNative()) {
      throw new Error("Only native XLM payments are sent from here.");
    }
    if (operation.destination !== expected.destination) {
      throw new Error("The signed transaction pays a different account.");
    }
    if (toStroops(operation.amount) !== wanted) {
      throw new Error("The signed transaction is for a different amount.");
    }
    return;
  }

  if (operation.type === "createAccount") {
    if (operation.destination !== expected.destination) {
      throw new Error("The signed transaction funds a different account.");
    }
    if (toStroops(operation.startingBalance) !== wanted) {
      throw new Error("The signed transaction is for a different amount.");
    }
    return;
  }

  throw new Error(`Expected a payment, got ${operation.type}.`);
}

/** Horizon result codes, translated into something worth showing someone. */
function explain(codes: { transaction: string; operations: string[] }): string {
  const operation = codes.operations[0] ?? "";

  if (operation === "op_underfunded" || codes.transaction === "tx_insufficient_balance") {
    return "Not enough XLM. Remember the account has to keep its minimum balance and the fee.";
  }
  if (operation === "op_no_destination") {
    return "That account does not exist on the network.";
  }
  if (operation === "op_low_reserve") {
    return "Too little to create the destination account — it needs at least 1 XLM to exist.";
  }
  if (codes.transaction === "tx_bad_seq") {
    return "This wallet sent another transaction in the meantime. Try again.";
  }
  if (codes.transaction === "tx_too_late") {
    return "The signed transaction expired before it was submitted. Try again.";
  }
  if (codes.transaction === "tx_bad_auth") {
    return "The wallet signed with a different account than the one this was built for.";
  }

  const detail = operation ? `${codes.transaction}/${operation}` : codes.transaction;
  return `The network rejected the transaction (${detail}).`;
}

export async function submitPayment(
  signedXdr: string,
  expected: { source: string; destination: string; amount: string },
  network: StellarNetwork,
): Promise<PaymentResult> {
  assertPayment(signedXdr, expected, network);

  const transaction = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE[network]);

  try {
    const result = await horizon(network).submitTransaction(transaction);
    return {
      txHash: result.hash,
      ledger: result.ledger,
      successful: result.successful,
      signer: expected.source,
    };
  } catch (error) {
    if (error instanceof TransactionFailedError) {
      throw new Error(explain(error.getResultCodes()));
    }
    throw error;
  }
}
