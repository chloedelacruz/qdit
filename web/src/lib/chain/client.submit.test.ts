import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The retry path — the part `client.test.ts` deliberately leaves alone because
 * "the rest either talks to an RPC server or decodes real XDR".
 *
 * This file supplies both: `@stellar/stellar-sdk` is mocked so a scripted
 * `rpc.Server` stands in for the network, and `TransactionBuilder.fromXDR`
 * returns a fixed fake envelope that `assertInvocation` accepts. That lets the
 * three behaviours the plan cares about be pinned deterministically rather than
 * hoped for against live testnet (FEEDBACK-PLAN §P0):
 *
 *   - transient outcomes are retried, final ones are not;
 *   - a `DUPLICATE` is polled, not thrown — it means a prior send already
 *     landed, and the old code turned that success into a reported failure;
 *   - a submitted-but-unconfirmed transaction comes back `pending` with its
 *     hash, never lost.
 *
 * Time is faked. The backoffs and polls are real `setTimeout`s, so the whole
 * call is driven to completion with `vi.runAllTimersAsync()` instead of waiting
 * out the 90-second budget in wall-clock time.
 */

const CONTRACT_ID = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";
const SIGNER = "GA6HCMBLTZS5VYYBCATRBRZ3BZJMAFUDKYYF6AH6MVCMGWMRDNSWJPIH";
const TX_HASH = "ab".repeat(32); // 64 lowercase hex chars

// Everything the mock factory reads has to be hoisted with it — a plain
// module-level const is not initialised by the time the factory runs.
const ctl = vi.hoisted(() => ({
  contractId: "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG",
  signer: "GA6HCMBLTZS5VYYBCATRBRZ3BZJMAFUDKYYF6AH6MVCMGWMRDNSWJPIH",
  txHash: "ab".repeat(32),
  /** The contract function `assertInvocation` will report the envelope calls. */
  method: "submit_milestone_proof",
  /** Scripted responses; the last entry repeats if there are more calls. */
  send: [] as unknown[],
  get: [] as unknown[],
  sendCalls: 0,
  getCalls: 0,
}));

vi.mock("@stellar/stellar-sdk", () => {
  const GetTransactionStatus = { SUCCESS: "SUCCESS", FAILED: "FAILED", NOT_FOUND: "NOT_FOUND" };
  const INVOKE = Symbol("invokeContract");

  const dequeue = (queue: unknown[], index: number): unknown =>
    queue[Math.min(index, queue.length - 1)];

  class Server {
    constructor(_url: string) {}
    async sendTransaction(_tx: unknown) {
      const value = dequeue(ctl.send, ctl.sendCalls);
      ctl.sendCalls += 1;
      if (value instanceof Error) throw value;
      return value;
    }
    async getTransaction(_hash: string) {
      const value = dequeue(ctl.get, ctl.getCalls);
      ctl.getCalls += 1;
      if (value instanceof Error) throw value;
      return value;
    }
  }

  // A fake envelope shaped just enough to pass assertInvocation and to be
  // hashable. No `innerTransaction` key, exactly one invoke-contract op naming
  // the configured contract and method.
  const envelope = () => ({
    source: ctl.signer,
    feeSource: ctl.signer,
    operations: [
      {
        type: "invokeHostFunction",
        func: {
          switch: () => INVOKE,
          invokeContract: () => ({
            contractAddress: () => "scAddress",
            functionName: () => ({ toString: () => ctl.method }),
          }),
        },
      },
    ],
    hash: () => Buffer.from(ctl.txHash, "hex"),
  });

  return {
    Networks: {
      TESTNET: "Test SDF Network ; September 2015",
      PUBLIC: "Public Global Stellar Network ; September 2015",
    },
    Address: { fromScAddress: () => ({ toString: () => ctl.contractId }) },
    TransactionBuilder: { fromXDR: () => envelope() },
    xdr: { HostFunctionType: { hostFunctionTypeInvokeContract: () => INVOKE } },
    rpc: {
      Server,
      Api: { GetTransactionStatus, isSimulationError: () => false },
    },
  };
});

const { submitSigned, reconcileHash } = await import("@/lib/chain/client");

const CONFIG = { contractId: CONTRACT_ID, network: "testnet" as const };
const METHOD = "submit_milestone_proof" as const;

/** Ready-made scripted responses. */
const SEND = {
  pending: { status: "PENDING", hash: TX_HASH },
  duplicate: { status: "DUPLICATE", hash: TX_HASH },
  tryAgain: { status: "TRY_AGAIN_LATER" },
  error: { status: "ERROR" },
};
const GET = {
  success: { status: "SUCCESS", ledger: 4242, envelopeXdr: { toXDR: () => "envelope-b64" } },
  failed: { status: "FAILED" },
  notFound: { status: "NOT_FOUND" },
};

/**
 * Drive a call that sleeps to completion.
 *
 * `runAllTimersAsync` runs every scheduled backoff and poll (advancing the
 * faked clock, and with it `Date.now`, which is what the deadline logic reads)
 * and flushes the microtasks the mocked RPC resolves on. The pre-attached catch
 * keeps a rejecting call from tripping an unhandled-rejection warning while the
 * timers run; the original promise is returned untouched for the assertion.
 */
async function drive<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  ctl.send = [];
  ctl.get = [];
  ctl.sendCalls = 0;
  ctl.getCalls = 0;
  ctl.method = "submit_milestone_proof";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("submitSigned — confirmation", () => {
  it("confirms on the first attempt and reports the hash, ledger and signer", async () => {
    ctl.send = [SEND.pending];
    ctl.get = [GET.success];

    const result = await drive(submitSigned("xdr", CONFIG, METHOD));

    expect(result).toEqual({
      status: "confirmed",
      txHash: TX_HASH,
      ledger: 4242,
      signer: SIGNER,
      attempts: 1,
    });
    expect(ctl.sendCalls).toBe(1);
  });

  it("polls a DUPLICATE instead of throwing, because it means a prior send landed", async () => {
    // The regression this guards: the old code threw on DUPLICATE and turned a
    // landed transaction into a reported failure.
    ctl.send = [SEND.duplicate];
    ctl.get = [GET.success];

    const result = await drive(submitSigned("xdr", CONFIG, METHOD));

    expect(result.status).toBe("confirmed");
    expect(result.txHash).toBe(TX_HASH);
    expect(ctl.sendCalls).toBe(1);
  });
});

describe("submitSigned — retrying transient failures", () => {
  it("retries a TRY_AGAIN_LATER and confirms on the next attempt", async () => {
    ctl.send = [SEND.tryAgain, SEND.pending];
    ctl.get = [GET.success];

    const result = await drive(submitSigned("xdr", CONFIG, METHOD));

    expect(result.status).toBe("confirmed");
    expect(result.attempts).toBe(2);
    expect(ctl.sendCalls).toBe(2);
  });

  it("retries a send that throws (an unreachable or 5xx RPC) and then confirms", async () => {
    ctl.send = [new Error("socket hang up"), SEND.pending];
    ctl.get = [GET.success];

    const result = await drive(submitSigned("xdr", CONFIG, METHOD));

    expect(result.status).toBe("confirmed");
    expect(result.attempts).toBe(2);
  });

  it("keeps polling through NOT_FOUND until the ledger confirms", async () => {
    ctl.send = [SEND.pending];
    ctl.get = [GET.notFound, GET.notFound, GET.success];

    const result = await drive(submitSigned("xdr", CONFIG, METHOD));

    expect(result.status).toBe("confirmed");
    expect(ctl.getCalls).toBe(3);
    // One send: NOT_FOUND is "still being included", not a reason to resubmit.
    expect(ctl.sendCalls).toBe(1);
  });
});

describe("submitSigned — final failures are not retried", () => {
  it("throws on a FAILED ledger result without retrying", async () => {
    ctl.send = [SEND.pending];
    ctl.get = [GET.failed];

    await expect(drive(submitSigned("xdr", CONFIG, METHOD))).rejects.toThrow(
      "failed on chain",
    );
    expect(ctl.sendCalls).toBe(1);
  });

  it("throws on an ERROR send status without retrying — a refused envelope", async () => {
    ctl.send = [SEND.error];

    await expect(drive(submitSigned("xdr", CONFIG, METHOD))).rejects.toThrow(
      "rejected the transaction (ERROR)",
    );
    expect(ctl.sendCalls).toBe(1);
  });
});

describe("submitSigned — pending, with the hash kept", () => {
  it("returns pending when submitted but never confirmed within the budget", async () => {
    ctl.send = [SEND.pending];
    ctl.get = [GET.notFound]; // never lands

    const result = await drive(submitSigned("xdr", CONFIG, METHOD));

    expect(result).toEqual({
      status: "pending",
      txHash: TX_HASH,
      ledger: null,
      signer: SIGNER,
      attempts: 2, // two 60s poll windows exhaust the 90s budget
    });
    // It polled hard before giving up, and it did submit.
    expect(ctl.getCalls).toBeGreaterThan(1);
    expect(ctl.sendCalls).toBe(2);
  });

  it("throws when not a single send reaches the network — nothing to keep", async () => {
    ctl.send = [new Error("network down")]; // every attempt throws

    await expect(drive(submitSigned("xdr", CONFIG, METHOD))).rejects.toThrow(
      "could not be submitted after 4 attempts",
    );
    expect(ctl.sendCalls).toBe(4);
  });
});

describe("submitSigned — the envelope must be the one we prepared", () => {
  it("rejects a signed transaction that calls a different function", async () => {
    // assertInvocation runs before any send: the mock envelope names
    // `submit_milestone_proof`, so asking to submit an `approve_milestone`
    // must be refused, and nothing is sent.
    ctl.send = [SEND.pending];
    ctl.get = [GET.success];

    await expect(
      drive(submitSigned("xdr", CONFIG, "approve_milestone")),
    ).rejects.toThrow("calls submit_milestone_proof, not approve_milestone");
    expect(ctl.sendCalls).toBe(0);
  });
});

describe("reconcileHash", () => {
  it("reports confirmed with the ledger and the signer off the envelope", async () => {
    ctl.get = [GET.success];

    const result = await drive(reconcileHash(TX_HASH, CONFIG));

    expect(result).toEqual({ status: "confirmed", ledger: 4242, signer: SIGNER });
  });

  it("reports failed for a FAILED transaction", async () => {
    ctl.get = [GET.failed];
    await expect(drive(reconcileHash(TX_HASH, CONFIG))).resolves.toEqual({
      status: "failed",
    });
  });

  it("reports pending for a not-yet-visible transaction", async () => {
    ctl.get = [GET.notFound];
    await expect(drive(reconcileHash(TX_HASH, CONFIG))).resolves.toEqual({
      status: "pending",
    });
  });

  it("reports pending — never failed — when the RPC read throws", async () => {
    // An unreachable RPC must read as "still waiting", so nothing is discarded.
    ctl.get = [new Error("timeout")];
    await expect(drive(reconcileHash(TX_HASH, CONFIG))).resolves.toEqual({
      status: "pending",
    });
  });
});
