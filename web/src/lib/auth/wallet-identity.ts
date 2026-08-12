/**
 * Pure identity helpers for wallet accounts.
 *
 * Deliberately dependency-free and free of `server-only`, like `lib/stellar.ts`:
 * the placeholder-email question is asked on both sides of the wire — the
 * layout derives `hasRecoveryCredential` from it, and the onboarding card keys
 * off that. Nothing here reads the environment or touches Supabase.
 */

import { truncateHash } from "@/lib/stellar";

/**
 * Domain for the placeholder address on a wallet-created account.
 *
 * Supabase requires an identifier on `auth.users` and a wallet account has no
 * real address at creation, so one is synthesised. It is **transitional**: when
 * the account attaches a recovery email, that address replaces this one.
 *
 * `.local` is reserved (RFC 6762) and cannot resolve, which is the property
 * that matters — a placeholder must never be deliverable, or a typo becomes an
 * email to a stranger.
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "wallet.qdit.local";

/** The placeholder address for a wallet, e.g. `gabc…@wallet.qdit.local`. */
export function placeholderEmail(address: string): string {
  return `${address.trim().toLowerCase()}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

/** True when this address is a placeholder rather than something a user gave. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/**
 * True when the account can be opened *without* the wallet.
 *
 * The one question onboarding asks. An account with only a placeholder address
 * has exactly one key to its own front door, and if that key is lost the
 * projects behind it are unreachable — which is what §5 of WALLET-AUTH-PLAN.md
 * exists to prevent.
 */
export function hasRecoveryCredential(email: string | null | undefined): boolean {
  return Boolean(email) && !isPlaceholderEmail(email);
}

/**
 * What to call someone whose only identity is a wallet.
 *
 * Written into `full_name` at sign-up so `handle_new_user()` has something
 * human for `display_name`. Four and four rather than the six-and-six default:
 * this sits inline next to prose in the user menu and the roster, where a
 * 15-character token reads as a word and a 20-character one reads as a hash.
 */
export function walletDisplayName(address: string): string {
  return truncateHash(address, 4, 4);
}
