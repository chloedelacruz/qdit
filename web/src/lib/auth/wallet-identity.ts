/**
 * Recognising the accounts that were made before registration existed.
 *
 * Deliberately dependency-free and free of `server-only`, like `lib/stellar.ts`:
 * the placeholder-email question is asked on both sides of the wire — the app
 * layout redirects on it, `/register` picks its mode from it, and the
 * registration action re-checks it. Nothing here reads the environment or
 * touches Supabase.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE IS ABOUT THE PAST
 * ---------------------------------------------------------------------------
 * Nothing creates a placeholder address any more. Connecting an unknown wallet
 * produces a registration ticket, and the account is created by a form that
 * requires a real email — so every account made from now on passes
 * `hasRecoveryCredential()` on the day it is born.
 *
 * What remains is the accounts made while connecting a wallet created one
 * silently. There is one in the hosted project. These functions are how it is
 * recognised and routed to `/register` to be completed, and they can be deleted
 * on the day the last such account is gone.
 *
 * `placeholderEmail()` and `walletDisplayName()` were the *writing* half of
 * this and are gone with the flow that called them: nothing may mint a
 * placeholder address, and a display name is now a username somebody chose
 * rather than their own address abbreviated for them.
 */

/**
 * Domain for the placeholder address on an account created by the retired
 * wallet auto-create flow.
 *
 * Supabase requires an identifier on `auth.users` and that flow had no real
 * address to give, so one was synthesised. `.local` is reserved (RFC 6762) and
 * cannot resolve, which is the property that matters — a placeholder must never
 * be deliverable, or a typo becomes an email to a stranger.
 *
 * It is also why such an account cannot simply be sent a confirmation link to
 * fix itself: there is no inbox at the other end, and never was.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "wallet.qdit.local";

/** True when this address is a placeholder rather than something a user gave. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/**
 * True when the account can be opened *without* the wallet.
 *
 * An account with only a placeholder address has exactly one key to its own
 * front door, and if that key is lost the projects behind it are unreachable.
 * Registration is what stops new accounts being in that position;
 * `(app)/layout.tsx` is what stops the remaining ones staying in it.
 */
export function hasRecoveryCredential(email: string | null | undefined): boolean {
  return Boolean(email) && !isPlaceholderEmail(email);
}
