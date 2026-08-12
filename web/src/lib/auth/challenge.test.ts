import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChallengeError, buildChallenge, verifyChallenge } from "@/lib/auth/challenge";

/**
 * The one piece of this feature that is worth testing without a browser: a
 * signature either proves control of an account or it does not, and every way
 * it can fail to is checkable here.
 *
 * Keypairs are generated rather than fixed. A hard-coded secret in a test file
 * is a secret in git, and `supabase/seed.sql` already taught this repo that
 * lesson once (see `e2e/auth.setup.ts`).
 */

const SERVER = Keypair.random();
const WALLET = Keypair.random();

/** Signs a challenge the way the wallet kit does — same passphrase, same XDR. */
function sign(xdr: string, keypair: Keypair): string {
  const transaction = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  transaction.sign(keypair);
  return transaction.toXDR();
}

beforeEach(() => {
  process.env.STELLAR_AUTH_SERVER_SECRET = SERVER.secret();
  process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3000";
  process.env.NEXT_PUBLIC_STELLAR_NETWORK = "testnet";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildChallenge", () => {
  it("refuses anything that is not an account address", () => {
    expect(() => buildChallenge("not-an-address")).toThrow(ChallengeError);
    // A contract id is a strkey too, and is not something that can sign in.
    expect(() =>
      buildChallenge("CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG"),
    ).toThrow(ChallengeError);
  });

  it("says so plainly when the server key is missing", () => {
    delete process.env.STELLAR_AUTH_SERVER_SECRET;
    // Not a ChallengeError: nothing the caller did caused this, and a route
    // must not answer 4xx for a deployment that was never configured.
    expect(() => buildChallenge(WALLET.publicKey())).toThrow(
      /STELLAR_AUTH_SERVER_SECRET is not set/,
    );
  });

  it("issues a different challenge each time, so one cannot be stockpiled", () => {
    expect(buildChallenge(WALLET.publicKey())).not.toBe(
      buildChallenge(WALLET.publicKey()),
    );
  });
});

describe("verifyChallenge", () => {
  it("returns the address that signed", () => {
    const signed = sign(buildChallenge(WALLET.publicKey()), WALLET);

    expect(verifyChallenge(signed)).toBe(WALLET.publicKey());
  });

  it("rejects an unsigned challenge", () => {
    // The whole point: holding a challenge for an address proves nothing about
    // controlling it. Anyone can ask for one — public keys are public.
    expect(() => verifyChallenge(buildChallenge(WALLET.publicKey()))).toThrow(
      ChallengeError,
    );
  });

  it("rejects a challenge signed by a different wallet", () => {
    const impostor = Keypair.random();
    const signed = sign(buildChallenge(WALLET.publicKey()), impostor);

    expect(() => verifyChallenge(signed)).toThrow(
      /was not signed by that wallet/,
    );
  });

  it("rejects a challenge this server did not issue", () => {
    // Someone else's deployment, or a challenge minted from a stolen shape.
    process.env.STELLAR_AUTH_SERVER_SECRET = Keypair.random().secret();
    const foreign = sign(buildChallenge(WALLET.publicKey()), WALLET);

    process.env.STELLAR_AUTH_SERVER_SECRET = SERVER.secret();
    expect(() => verifyChallenge(foreign)).toThrow(/no longer valid/);
  });

  it("rejects a challenge issued for another deployment's domain", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://not-qdit.example";
    const elsewhere = sign(buildChallenge(WALLET.publicKey()), WALLET);

    process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3000";
    expect(() => verifyChallenge(elsewhere)).toThrow(/no longer valid/);
  });

  it("rejects a challenge that has expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T00:00:00Z"));

    const signed = sign(buildChallenge(WALLET.publicKey()), WALLET);
    expect(verifyChallenge(signed)).toBe(WALLET.publicKey());

    // 300s window, so five minutes and a second later it is gone.
    vi.setSystemTime(new Date("2026-08-12T00:05:01Z"));
    expect(() => verifyChallenge(signed)).toThrow(/no longer valid/);
  });

  it("rejects a transaction that is not a challenge at all", () => {
    expect(() => verifyChallenge("not-xdr")).toThrow(ChallengeError);
  });
});
