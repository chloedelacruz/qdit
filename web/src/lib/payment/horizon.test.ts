import {
  Account,
  Asset,
  Keypair,
  Memo,
  Networks,
  NotFoundError,
  Operation,
  Transaction,
  TransactionBuilder,
  TransactionFailedError,
} from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HORIZON_URL } from "@/lib/stellar";

/**
 * Horizon is the one seam: `Horizon.Server` is replaced, everything else in
 * the SDK (building, XDR, the operation decoding `assertPayment` relies on)
 * is real. Each test says which accounts exist and what a submit answers.
 */
const loadAccount = vi.fn();
const fetchBaseFee = vi.fn();
const submitTransaction = vi.fn();
const serverUrls: string[] = [];

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  class Server {
    constructor(url: string) {
      serverUrls.push(url);
    }
    loadAccount = (address: string) => loadAccount(address);
    fetchBaseFee = () => fetchBaseFee();
    submitTransaction = (tx: unknown) => submitTransaction(tx);
  }
  return { ...real, Horizon: { ...real.Horizon, Server } };
});

const { buildPayment, submitPayment } = await import("./horizon");

const SOURCE = Keypair.random();
const DEST = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();

function existing(...addresses: string[]) {
  loadAccount.mockImplementation(async (address: string) => {
    if (addresses.includes(address)) return new Account(address, "100");
    throw new NotFoundError("not found", { status: 404 });
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    source: SOURCE.publicKey(),
    destination: DEST,
    amount: "12.5",
    memo: null,
    network: "testnet" as const,
    ...overrides,
  };
}

/** The built envelope, as a plain transaction (a fee bump would fail the test). */
function decode(xdr: string): Transaction {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  if (!(tx instanceof Transaction)) throw new Error("expected a plain transaction, got a fee bump");
  return tx;
}

/** A signed envelope with arbitrary operations, as a tampering client could send. */
function signedWith(ops: ReturnType<typeof Operation.payment>[], source = SOURCE) {
  const builder = new TransactionBuilder(new Account(source.publicKey(), "100"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  });
  for (const op of ops) builder.addOperation(op);
  const tx = builder.setTimeout(180).build();
  tx.sign(source);
  return tx.toXDR();
}

const pay = (destination: string, amount: string, asset = Asset.native()) =>
  Operation.payment({ destination, asset, amount });

beforeEach(() => {
  fetchBaseFee.mockResolvedValue(250);
  serverUrls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildPayment", () => {
  it("builds one native payment to an existing account, unsigned, with a timebound", async () => {
    existing(SOURCE.publicKey(), DEST);

    const built = await buildPayment(request());
    expect(built).toMatchObject({ kind: "payment", destination: DEST, amount: "12.5", network: "testnet" });
    expect(serverUrls[0]).toBe(HORIZON_URL.testnet);

    const tx = decode(built.xdr);
    expect(tx.source).toBe(SOURCE.publicKey());
    expect(tx.signatures).toHaveLength(0);
    expect(tx.fee).toBe("250");
    expect(tx.timeBounds?.maxTime).not.toBe("0");
    expect(tx.operations).toHaveLength(1);
    const [op] = tx.operations;
    expect(op.type).toBe("payment");
    if (op.type !== "payment") return;
    expect(op.destination).toBe(DEST);
    expect(op.amount).toBe("12.5000000");
    expect(op.asset.isNative()).toBe(true);
  });

  it("an unfunded destination becomes createAccount", async () => {
    existing(SOURCE.publicKey());

    const built = await buildPayment(request({ amount: "5" }));
    expect(built.kind).toBe("createAccount");
    const tx = decode(built.xdr);
    expect(tx.operations[0]).toMatchObject({ type: "createAccount", destination: DEST, startingBalance: "5.0000000" });
  });

  it("refuses to create an account with less than the 1 XLM minimum", async () => {
    existing(SOURCE.publicKey());
    await expect(buildPayment(request({ amount: "0.9999999" }))).rejects.toThrow(/at least 1(\.0+)? XLM/);
  });

  it("refuses a payment to the wallet's own address before touching Horizon", async () => {
    await expect(buildPayment(request({ destination: SOURCE.publicKey() }))).rejects.toThrow("own address");
    expect(loadAccount).not.toHaveBeenCalled();
  });

  it("refuses an unfunded source: it cannot pay a fee", async () => {
    existing(DEST);
    await expect(buildPayment(request())).rejects.toThrow("does not exist on the network yet");
  });

  it("a Horizon failure other than 404 is thrown, not read as 'unfunded'", async () => {
    loadAccount.mockRejectedValue(new Error("fetch failed"));
    await expect(buildPayment(request())).rejects.toThrow("fetch failed");
  });

  it("falls back to the base fee when Horizon will not say", async () => {
    existing(SOURCE.publicKey(), DEST);
    fetchBaseFee.mockRejectedValueOnce(new Error("timeout"));

    const tx = decode((await buildPayment(request())).xdr);
    expect(tx.fee).toBe("100");
  });

  it("adds a text memo when given one", async () => {
    existing(SOURCE.publicKey(), DEST);
    const tx = decode((await buildPayment(request({ memo: "invoice 7" }))).xdr);
    expect(tx.memo.type).toBe(Memo.text("invoice 7").type);
    expect(String(tx.memo.value)).toBe("invoice 7");
  });

  it("builds against the mainnet Horizon and passphrase for mainnet", async () => {
    existing(SOURCE.publicKey(), DEST);
    const built = await buildPayment(request({ network: "mainnet" }));
    expect(serverUrls[0]).toBe(HORIZON_URL.mainnet);
    expect(() => TransactionBuilder.fromXDR(built.xdr, Networks.PUBLIC)).not.toThrow();
  });
});

describe("submitPayment — the signed envelope must be the one prepared", () => {
  const expected = { source: SOURCE.publicKey(), destination: DEST, amount: "12.5" };

  it("submits a matching payment and reports the hash and ledger", async () => {
    submitTransaction.mockResolvedValueOnce({ hash: "h1", ledger: 99, successful: true });

    const result = await submitPayment(signedWith([pay(DEST, "12.5")]), expected, "testnet");
    expect(result).toEqual({ txHash: "h1", ledger: 99, successful: true, signer: SOURCE.publicKey() });
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a different destination", () => signedWith([pay(OTHER, "12.5")]), "pays a different account"],
    ["a different amount", () => signedWith([pay(DEST, "125")]), "different amount"],
    ["a second operation", () => signedWith([pay(DEST, "12.5"), pay(OTHER, "1")]), "exactly one operation"],
    ["a different source", () => signedWith([pay(DEST, "12.5")], Keypair.random()), "different account"],
    [
      "a non-native asset",
      () => signedWith([pay(DEST, "12.5", new Asset("USDC", Keypair.random().publicKey()))]),
      "Only native XLM",
    ],
  ])("refuses %s without submitting", async (_label, build, message) => {
    await expect(submitPayment(build(), expected, "testnet")).rejects.toThrow(message);
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("refuses a createAccount for a different account or amount", async () => {
    const create = (destination: string, startingBalance: string) =>
      signedWith([Operation.createAccount({ destination, startingBalance }) as ReturnType<typeof Operation.payment>]);

    await expect(submitPayment(create(OTHER, "12.5"), expected, "testnet")).rejects.toThrow("funds a different account");
    await expect(submitPayment(create(DEST, "13"), expected, "testnet")).rejects.toThrow("different amount");
    submitTransaction.mockResolvedValueOnce({ hash: "h2", ledger: 1, successful: true });
    await expect(submitPayment(create(DEST, "12.5"), expected, "testnet")).resolves.toMatchObject({ txHash: "h2" });
  });

  it("refuses an operation that is not a payment at all", async () => {
    const xdr = signedWith([
      Operation.setOptions({ homeDomain: "evil.example" }) as ReturnType<typeof Operation.payment>,
    ]);
    await expect(submitPayment(xdr, expected, "testnet")).rejects.toThrow("Expected a payment, got setOptions");
  });

  it("submits to the Horizon of the network it was asked for", async () => {
    submitTransaction.mockResolvedValueOnce({ hash: "h3", ledger: 1, successful: true });
    await submitPayment(signedWith([pay(DEST, "12.5")]), expected, "mainnet");
    expect(serverUrls).toEqual([HORIZON_URL.mainnet]);
  });

  function failed(transaction: string, operations: string[] = []) {
    return Object.assign(Object.create(TransactionFailedError.prototype), {
      message: "Transaction failed",
      getResultCodes: () => ({ transaction, operations }),
    });
  }

  it.each([
    ["tx_failed", ["op_underfunded"], "Not enough XLM"],
    ["tx_insufficient_balance", [], "Not enough XLM"],
    ["tx_failed", ["op_no_destination"], "does not exist on the network"],
    ["tx_failed", ["op_low_reserve"], "at least 1 XLM"],
    ["tx_bad_seq", [], "another transaction in the meantime"],
    ["tx_too_late", [], "expired"],
    ["tx_bad_auth", [], "different account"],
    ["tx_failed", ["op_line_full"], "(tx_failed/op_line_full)"],
    ["tx_internal_error", [], "(tx_internal_error)"],
  ])("translates %s %j into a sentence", async (transaction, operations, message) => {
    submitTransaction.mockRejectedValueOnce(failed(transaction, operations));
    await expect(submitPayment(signedWith([pay(DEST, "12.5")]), expected, "testnet")).rejects.toThrow(message);
  });

  it("passes other submit errors through", async () => {
    submitTransaction.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(submitPayment(signedWith([pay(DEST, "12.5")]), expected, "testnet")).rejects.toThrow("fetch failed");
  });
});
