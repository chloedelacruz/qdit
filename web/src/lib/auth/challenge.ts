import "server-only";

import { Keypair, Networks, type Transaction, WebAuth } from "@stellar/stellar-sdk";

import { isWalletAddress, type StellarNetwork } from "@/lib/stellar";

/**
 * Proving that a browser controls a Stellar account.
 *
 * This is SEP-10's challenge transaction, which the SDK implements for us. The
 * shape is:
 *
 *   1. the server builds a transaction it signs itself, with sequence number 0
 *      so it can never be submitted, carrying the client's account as the
 *      operation source and a short expiry;
 *   2. the wallet signs it — the same `signTransaction()` call the anchoring
 *      flow already makes, so every wallet the kit supports can do this;
 *   3. the server checks its own signature, the client's signature, and the
 *      time bounds.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO NONCE TABLE
 * ---------------------------------------------------------------------------
 * The obvious design is a `login_nonces` table: issue a random string, store
 * it, delete it on use. The challenge transaction makes that unnecessary,
 * because it is **self-verifying** — it carries the server's own signature and
 * its own expiry, so a forged or stale one fails on inspection rather than on
 * lookup. Nothing to store, nothing to expire, nothing to clean up, and no
 * shared state between instances.
 *
 * What that buys is worth naming precisely: a challenge can be replayed inside
 * its window. The only thing a replay achieves is a session for the wallet that
 * signed it — which that wallet could obtain anyway by asking for a fresh
 * challenge. The window is short because there is no reason for it to be long,
 * not because something breaks at the end of it.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT signMessage()
 * ---------------------------------------------------------------------------
 * The kit exposes `signMessage`, which looks like a better fit and is not.
 * Wallets disagree about what the returned `signedMessage` contains — some
 * return a raw signature, some a wrapped blob — so verification would have to
 * branch per wallet and would break silently on a new one. Every wallet
 * implements `signTransaction` identically, because the network defines what a
 * signature over a transaction means.
 */

/** Long enough to pick a wallet and approve a prompt; short enough to be dull. */
const CHALLENGE_TIMEOUT_SECONDS = 300;

/** Thrown for anything a caller could have caused. Routes map this to 4xx. */
export class ChallengeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ChallengeError";
  }
}

/**
 * The keypair the server signs challenges with.
 *
 * Never funded and never submitted — it exists only so a challenge can be
 * proved to have come from us. It must stay stable across deploys: rotating it
 * invalidates every challenge already in flight, which users experience as a
 * sign-in that fails once and then works.
 */
function serverKeypair(): Keypair {
  const secret = process.env.STELLAR_AUTH_SERVER_SECRET?.trim();

  if (!secret) {
    throw new Error(
      "STELLAR_AUTH_SERVER_SECRET is not set. Generate one with " +
        "`Keypair.random().secret()` and add it to web/.env.local — see " +
        "web/.env.example.",
    );
  }

  try {
    return Keypair.fromSecret(secret);
  } catch (error) {
    throw new Error(
      "STELLAR_AUTH_SERVER_SECRET is not a Stellar secret key (S…).",
      { cause: error },
    );
  }
}

/**
 * The passphrase both sides sign under.
 *
 * The challenge is never submitted, so the network is not a routing decision —
 * but a signature is made over a hash that includes the passphrase, so client
 * and server must agree or every verification fails. `lib/wallet.ts` signs with
 * the app's configured network, so this reads the same variable.
 */
function networkPassphrase(): string {
  const network: StellarNetwork =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

  return network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
}

/**
 * The domain recorded in the challenge, bound to this deployment.
 *
 * SEP-10 puts the home domain inside the transaction and checks it on the way
 * back, which is what stops a challenge issued by one deployment from being
 * replayed against another. Host only — no scheme, no path.
 */
function authDomain(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://127.0.0.1:3000";

  try {
    return new URL(site).host;
  } catch (error) {
    throw new Error(`NEXT_PUBLIC_SITE_URL is not a valid URL: ${site}`, {
      cause: error,
    });
  }
}

/** Builds a challenge for `address`. Returns base64 XDR for the wallet to sign. */
export function buildChallenge(address: string): string {
  const trimmed = address.trim();

  if (!isWalletAddress(trimmed)) {
    throw new ChallengeError("That is not a Stellar account address.");
  }

  const domain = authDomain();

  return WebAuth.buildChallengeTx(
    serverKeypair(),
    trimmed,
    domain,
    CHALLENGE_TIMEOUT_SECONDS,
    networkPassphrase(),
    domain,
  );
}

/**
 * Verifies a signed challenge and returns the address it proves control of.
 *
 * The address is read out of the transaction rather than taken from the request
 * body, and that is deliberate: the signature covers the transaction, so the
 * account named inside it is the only one the signature says anything about. A
 * caller who also sent an address could disagree with what they signed, and the
 * server would then have to decide which to believe.
 *
 * Throws `ChallengeError` for anything a client could have caused — expired,
 * malformed, unsigned, signed by the wrong key, or issued by someone else.
 */
export function verifyChallenge(signedXdr: string): string {
  const server = serverKeypair();
  const domain = authDomain();
  const passphrase = networkPassphrase();

  let clientAccountID: string;
  let tx: Transaction;

  // Checks the server's signature, the source account, the sequence number and
  // the home domain. Everything except the client's signature and, see below,
  // the expiry we actually want.
  try {
    ({ clientAccountID, tx } = WebAuth.readChallengeTx(
      signedXdr,
      server.publicKey(),
      passphrase,
      domain,
      domain,
    ));
  } catch (error) {
    throw new ChallengeError(
      "That sign-in request is no longer valid. Try connecting again.",
      { cause: error },
    );
  }

  /**
   * Enforce our own expiry.
   *
   * `readChallengeTx` does check the time bounds, but it allows a hard-coded
   * five-minute grace period on top of them
   * (`webauth/challenge_transaction.js`: `validateTimebounds(transaction, 60 * 5)`),
   * and takes no option to narrow it. So a challenge built with a 300-second
   * timeout is accepted for 600 seconds, which is not what
   * CHALLENGE_TIMEOUT_SECONDS says and not what the next reader would assume.
   *
   * Three lines to make the constant mean what it says. The grace exists for
   * clock skew between independent SEP-10 servers and clients; here both sides
   * of the window are this deployment, so there is nothing to be lenient about.
   */
  const maxTime = Number.parseInt(tx.timeBounds?.maxTime ?? "", 10);
  if (!Number.isFinite(maxTime) || Date.now() / 1000 > maxTime) {
    throw new ChallengeError(
      "That sign-in request is no longer valid. Try connecting again.",
    );
  }

  // And now the client's. Split from the read above so the two failures can be
  // told apart in a log: the first means "not our challenge", the second means
  // "our challenge, wrong signer".
  try {
    WebAuth.verifyChallengeTxSigners(
      signedXdr,
      server.publicKey(),
      passphrase,
      [clientAccountID],
      domain,
      domain,
    );
  } catch (error) {
    throw new ChallengeError("That challenge was not signed by that wallet.", {
      cause: error,
    });
  }

  return clientAccountID;
}
