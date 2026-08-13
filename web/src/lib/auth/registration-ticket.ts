import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The thing you hold between proving a wallet and having an account.
 *
 * Connecting a wallet used to do both at once: `signInWithWallet()` verified a
 * signature and, finding no account, created one. Registration splits that in
 * half, and the halves are separated by however long it takes somebody to
 * choose a username and type a password. Something has to carry "this browser
 * proved control of G… at time T" across that gap.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A SESSION
 * ---------------------------------------------------------------------------
 * The obvious carrier is a session, and a session is exactly what must not
 * exist yet — there is no account for it to be a session *of*. Anything that
 * looked like one would have to be revoked on every path out of registration,
 * including the ones nobody thought about.
 *
 * A ticket grants one operation: create the account that holds this address.
 * It is not accepted anywhere else, it cannot be refreshed, and it expires on
 * its own.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT THE SIGNED CHALLENGE ITSELF
 * ---------------------------------------------------------------------------
 * The signed challenge XDR is already a self-verifying proof of exactly this
 * fact, and re-running `verifyChallenge()` at submit time would need no new
 * code at all. It was rejected for one reason: the challenge lives 300 seconds
 * (CHALLENGE_TIMEOUT_SECONDS), which is the right budget for a wallet popup and
 * a cruel one for a registration form. A form that expires while it is being
 * read is a bad screen.
 *
 * So the ticket is a second, longer-lived credential minted from the first, and
 * §TTL below is the only reason it exists rather than the XDR.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS
 * ---------------------------------------------------------------------------
 *   <base64url(address)>.<expiry seconds>.<base64url(HMAC-SHA256)>
 *
 * Stateless, like the challenge and for the same reasons: nothing to store,
 * nothing to expire, nothing to clean up, no shared state between instances.
 * A ticket can be replayed within its window, and the only thing a replay
 * achieves is creating the account the holder was entitled to create — which
 * fails the second time on the unique index.
 */

/**
 * Fifteen minutes. Long enough to think of a username, choose a password and
 * fetch it out of a password manager; short enough that a ticket left in a
 * closed laptop is not a way in tomorrow.
 */
export const TICKET_TTL_SECONDS = 15 * 60;

/**
 * `HttpOnly`, unlike the session cookie.
 *
 * `@supabase/ssr` deliberately writes `sb-<ref>-auth-token` without `HttpOnly`,
 * because the browser client reads the session back out of `document.cookie` —
 * that is how a Client Component has a session at all (see the note in
 * `wallet-session.ts`). Nothing on the page ever needs to read this one, so
 * nothing on the page is allowed to.
 */
export const TICKET_COOKIE = "qdit-wallet-ticket";

export const TICKET_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: TICKET_TTL_SECONDS,
} as const;

/**
 * The HMAC key, derived from the challenge signing key rather than added as a
 * ninth environment variable.
 *
 * `STELLAR_AUTH_SERVER_SECRET` is already required, already server-only, and
 * already documented as needing to stay stable across deploys — rotating it
 * invalidates challenges in flight, and now tickets in flight, which are the
 * same class of failure and the same short window.
 *
 * Derived, not used directly: this key signs a different kind of statement than
 * the Stellar keypair does, and one secret used verbatim for two purposes is
 * how a signature over one thing becomes a valid signature over another. The
 * label is the domain separation.
 */
function ticketKey(): Buffer {
  const secret = process.env.STELLAR_AUTH_SERVER_SECRET?.trim();

  if (!secret) {
    throw new Error(
      "STELLAR_AUTH_SERVER_SECRET is not set. Registration tickets are signed " +
        "with a key derived from it — see web/.env.example.",
    );
  }

  return createHmac("sha256", secret).update("qdit-registration-ticket-v1").digest();
}

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", ticketKey()).update(payload).digest("base64url");
}

/** Mints a ticket for an address that has *already* been proved. */
export function issueTicket(address: string, now: number = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + TICKET_TTL_SECONDS;
  const payload = `${b64url(address)}.${expiresAt}`;

  return `${payload}.${sign(payload)}`;
}

/**
 * The address a ticket proves, or `null`.
 *
 * Null for every failure — expired, truncated, re-signed with another key, or
 * simply absent. The caller has one reaction to all of them (send them back to
 * connect their wallet again), so telling them apart would only be for a log,
 * and the log would be recording that somebody edited a cookie.
 */
export function readTicket(
  token: string | undefined | null,
  now: number = Date.now(),
): string | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [addressPart, expiryPart, signature] = parts;
  const payload = `${addressPart}.${expiryPart}`;

  // Constant-time, and length-checked first: timingSafeEqual throws rather than
  // returning false when the buffers differ in length, and a forged token is
  // free to be any length at all.
  const expected = Buffer.from(sign(payload), "utf8");
  const actual = Buffer.from(signature, "utf8");

  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  // Only now is the payload worth reading: until the signature checked out,
  // every byte of it was attacker-controlled.
  const expiresAt = Number.parseInt(expiryPart, 10);
  if (!Number.isFinite(expiresAt) || now / 1000 > expiresAt) return null;

  const address = Buffer.from(addressPart, "base64url").toString("utf8");

  return address || null;
}
