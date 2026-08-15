import { describe, expect, it, vi } from "vitest";

/**
 * `buildUnsigned` is the only thing in `client.ts` that can be tested without a
 * network: the rest either talks to an RPC server or decodes real XDR.
 *
 * What is worth pinning down is its failure path. The bindings' `simulate()`
 * does not throw when the contract rejects a call — it simply skips assembling
 * and leaves the raw transaction in place — so a prepare step that only calls
 * `toXDR()` returns an unusable transaction instead of an error. The user then
 * gets a signing prompt for something the network is certain to refuse, and the
 * contract's actual objection ("this milestone is already approved") is lost.
 *
 * The bindings are mocked because the shape of an `AssembledTransaction` is all
 * that matters here; a real one would need a deployed contract behind it.
 */

const stub = vi.hoisted(() => ({ assembled: {} as unknown }));

vi.mock("@/lib/chain/bindings", () => ({
  Client: class {
    approve_milestone = async () => stub.assembled;
    reject_milestone = async () => stub.assembled;
    submit_milestone_proof = async () => stub.assembled;
    create_project_ref = async () => stub.assembled;
  },
}));

const { buildUnsigned } = await import("@/lib/chain/client");

const CONFIG = {
  contractId: "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG",
  network: "testnet" as const,
};
const SIGNER = "GA6HCMBLTZS5VYYBCATRBRZ3BZJMAFUDKYYF6AH6MVCMGWMRDNSWJPIH";

function prepare(method: "approve_milestone" | "submit_milestone_proof") {
  return buildUnsigned({ config: CONFIG, signer: SIGNER, method, args: {} });
}

describe("buildUnsigned", () => {
  it("returns the assembled XDR and its fee when the simulation succeeds", async () => {
    // No `error` key — `rpc.Api.isSimulationError` keys off exactly that.
    stub.assembled = {
      simulation: { minResourceFee: "100" },
      result: { isErr: () => false },
      built: { fee: "100123" },
      toXDR: () => "AAAAAgAAAA-assembled",
    };

    await expect(prepare("approve_milestone")).resolves.toEqual({
      xdr: "AAAAAgAAAA-assembled",
      feeStroops: "100123",
    });
  });

  it("reports a null fee rather than failing when the assembly carries none", async () => {
    // The fee is a courtesy shown before the wallet opens. Losing it must never
    // cost somebody the anchor — the dialog says "unavailable" and carries on.
    stub.assembled = {
      simulation: { minResourceFee: "100" },
      result: { isErr: () => false },
      toXDR: () => "AAAAAgAAAA-assembled",
    };

    await expect(prepare("approve_milestone")).resolves.toEqual({
      xdr: "AAAAAgAAAA-assembled",
      feeStroops: null,
    });
  });

  it("throws the contract's own error name when the simulation fails", async () => {
    const toXDR = vi.fn(() => "AAAAAgAAAA-unassembled");
    stub.assembled = {
      simulation: { error: "HostError: Error(Contract, #5)" },
      // What the generated bindings decode `#5` into, via their `Errors` map.
      result: { isErr: () => true, unwrapErr: () => ({ message: "InvalidStatus" }) },
      toXDR,
    };

    // `describe()` in actions.ts matches on this name to explain that an
    // approved milestone is final.
    await expect(prepare("approve_milestone")).rejects.toThrow("InvalidStatus");
    // The un-assembled transaction must never reach a wallet.
    expect(toXDR).not.toHaveBeenCalled();
  });

  it("falls back to the raw simulation text when there is no contract error", async () => {
    stub.assembled = {
      simulation: { error: "host invocation failed: insufficient balance" },
      // A non-contract failure — `result` rethrows rather than decoding.
      get result(): never {
        throw new Error('Transaction simulation failed: "host invocation failed"');
      },
      toXDR: () => "AAAAAgAAAA-unassembled",
    };

    await expect(prepare("submit_milestone_proof")).rejects.toThrow(
      "host invocation failed: insufficient balance",
    );
  });
});
