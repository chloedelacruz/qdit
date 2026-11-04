import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Horizon half (`./horizon`, tested on its own) and the session are stood
 * in for; the schema is real. Under test: the gate, re-validation of input the
 * form may never have rendered, and how outcomes are reported.
 */
const buildPayment = vi.fn();
const submitPayment = vi.fn();
vi.mock("@/lib/payment/horizon", () => ({
  buildPayment: (...args: unknown[]) => buildPayment(...args),
  submitPayment: (...args: unknown[]) => submitPayment(...args),
}));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getUser: () => getUser() }));

const { preparePayment, sendPayment } = await import("./actions");

const SIGNER = Keypair.random().publicKey();
const DEST = Keypair.random().publicKey();
const INPUT = { destination: DEST, amount: "2.5", memo: "" };

beforeEach(() => {
  getUser.mockResolvedValue({ id: "user-1", email: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("preparePayment", () => {
  it("refuses when the session expired, before building anything", async () => {
    getUser.mockResolvedValueOnce(null);
    await expect(preparePayment(SIGNER, INPUT)).resolves.toEqual({
      ok: false,
      error: "Your session expired. Sign in again.",
    });
    expect(buildPayment).not.toHaveBeenCalled();
  });

  it("refuses a signer that is not an account address", async () => {
    const result = await preparePayment("CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG", INPUT);
    expect(result).toEqual({ ok: false, error: "That is not a Stellar account address." });
  });

  it("re-validates the form and returns one error per field", async () => {
    const result = await preparePayment(SIGNER, {
      destination: "nope",
      amount: "0",
      memo: "x".repeat(29),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["amount", "destination", "memo"]);
    expect(buildPayment).not.toHaveBeenCalled();
  });

  it("measures the memo in bytes, as the network does", async () => {
    // 10 emoji × 4 bytes = 40 bytes, though only 10 characters.
    const result = await preparePayment(SIGNER, { ...INPUT, memo: "🙂".repeat(10) });
    expect(result.ok).toBe(false);
  });

  it("builds from the parsed values: trimmed, blank memo as null, configured network", async () => {
    buildPayment.mockResolvedValueOnce({ xdr: "AAA", kind: "payment", destination: DEST, amount: "2.5", network: "testnet" });

    const result = await preparePayment(SIGNER, { destination: ` ${DEST} `, amount: " 2.5 ", memo: "   " });

    expect(result).toEqual({
      ok: true,
      data: { xdr: "AAA", kind: "payment", destination: DEST, amount: "2.5", network: "testnet" },
    });
    expect(buildPayment).toHaveBeenCalledWith({
      source: SIGNER,
      destination: DEST,
      amount: "2.5",
      memo: null,
      network: "testnet",
    });
  });

  it("passes a real memo through", async () => {
    buildPayment.mockResolvedValueOnce({});
    await preparePayment(SIGNER, { ...INPUT, memo: " rent " });
    expect(buildPayment.mock.calls[0][0].memo).toBe("rent");
  });

  it("a build error is reported as its message", async () => {
    buildPayment.mockRejectedValueOnce(new Error("This account does not exist on the network yet, so it cannot pay a fee."));
    await expect(preparePayment(SIGNER, INPUT)).resolves.toEqual({
      ok: false,
      error: "This account does not exist on the network yet, so it cannot pay a fee.",
    });
  });

  it("a network failure is reported as one plain sentence", async () => {
    for (const message of ["fetch failed", "getaddrinfo ENOTFOUND horizon", "connect ECONNREFUSED", "Request timeout"]) {
      buildPayment.mockRejectedValueOnce(new Error(message));
      await expect(preparePayment(SIGNER, INPUT)).resolves.toEqual({
        ok: false,
        error: "Could not reach the network. Try again in a moment.",
      });
    }
  });
});

describe("sendPayment", () => {
  const expected = { source: SIGNER, destination: DEST, amount: "2.5" };

  it("refuses when the session expired, before submitting", async () => {
    getUser.mockResolvedValueOnce(null);
    expect((await sendPayment("XDR", expected)).ok).toBe(false);
    expect(submitPayment).not.toHaveBeenCalled();
  });

  it("returns the receipt of a successful payment", async () => {
    const receipt = { txHash: "h", ledger: 5, successful: true, signer: SIGNER };
    submitPayment.mockResolvedValueOnce(receipt);

    await expect(sendPayment("XDR", expected)).resolves.toEqual({ ok: true, data: receipt });
    expect(submitPayment).toHaveBeenCalledWith("XDR", expected, "testnet");
  });

  it("a transaction included but failed on chain is never reported as success", async () => {
    submitPayment.mockResolvedValueOnce({ txHash: "h", ledger: 5, successful: false, signer: SIGNER });
    await expect(sendPayment("XDR", expected)).resolves.toEqual({ ok: false, error: "Transaction h failed on chain." });
  });

  it("a refused envelope or a network error is reported, not thrown", async () => {
    submitPayment.mockRejectedValueOnce(new Error("The signed transaction pays a different account."));
    await expect(sendPayment("XDR", expected)).resolves.toEqual({
      ok: false,
      error: "The signed transaction pays a different account.",
    });

    submitPayment.mockRejectedValueOnce("fetch failed");
    await expect(sendPayment("XDR", expected)).resolves.toEqual({
      ok: false,
      error: "Could not reach the network. Try again in a moment.",
    });
  });
});
