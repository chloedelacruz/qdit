import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { signedInvocation } from "@/lib/chain/client";

/**
 * `signedInvocation` against real envelopes built with the real SDK, not the
 * mock `client.submit.test.ts` uses. What matters here is the decoding: the
 * arguments come back as the plain values the caller compares against, a
 * string as a string and an address as its strkey.
 */

const CONTRACT = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";
const CONFIG = { contractId: CONTRACT, network: "testnet" as const };
const PROJECT = "11111111-1111-4111-8111-111111111111";

function envelope(source: string, fn: string, args: Parameters<typeof nativeToScVal>[0][]) {
  return new TransactionBuilder(new Account(source, "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: CONTRACT,
        function: fn,
        args: args.map((arg) =>
          typeof arg === "string" && arg.startsWith("G")
            ? new Address(arg).toScVal()
            : nativeToScVal(arg, { type: "string" }),
        ),
      }),
    )
    .setTimeout(300)
    .build()
    .toXDR();
}

describe("signedInvocation", () => {
  it("reads back the signer and the create_project_ref arguments", () => {
    const owner = Keypair.random().publicKey();
    const xdr = envelope(owner, "create_project_ref", [PROJECT, owner]);

    expect(signedInvocation(xdr, CONFIG, "create_project_ref")).toEqual({
      source: owner,
      args: [PROJECT, owner],
    });
  });

  it("still refuses an envelope that calls another function", () => {
    const owner = Keypair.random().publicKey();
    const xdr = envelope(owner, "approve_milestone", [PROJECT, owner]);

    expect(() => signedInvocation(xdr, CONFIG, "create_project_ref")).toThrow(
      /calls approve_milestone, not create_project_ref/,
    );
  });
});
