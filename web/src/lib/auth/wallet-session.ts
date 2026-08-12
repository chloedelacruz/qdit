import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { placeholderEmail, walletDisplayName } from "@/lib/auth/wallet-identity";
import { getSupabaseUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

/**
 * Turning a proved wallet address into a Supabase session.
 *
 * Runs only after `verifyChallenge()` has established that the caller controls
 * the address. Nothing here re-checks that, and nothing here may be called with
 * an address that came straight off a request body.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE HOLDS THE FIRST SERVICE-ROLE KEY IN THE APP
 * ---------------------------------------------------------------------------
 * `web/.env.example` used to say the secret key was "only needed for admin
 * scripts or webhooks; the app does not use it". This is what changed that, and
 * it needs exactly two capabilities RLS cannot grant:
 *
 *   1. resolving an address to an account across *all* profiles — the caller
 *      has no session yet, so there is no `auth.uid()` for a policy to match;
 *   2. creating an `auth.users` row.
 *
 * Both are reached only from the two wallet route handlers. Nothing in this
 * module takes a user id from its caller: the account is always the one the
 * signature pointed at, which is what keeps a bypassed RLS from mattering.
 */

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Server-only by construction — the key has no `NEXT_PUBLIC_` prefix, so
 * importing this from a Client Component fails at build time rather than
 * shipping a secret to the browser.
 *
 * Both env names are read for the same reason `lib/supabase/env.ts` reads two
 * publishable names: Supabase renamed the legacy `service_role` JWT to a
 * "secret key" (`sb_secret_…`), and projects issue one or the other.
 */
function adminClient(): SupabaseClient<Database> {
  const secret =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. Wallet sign-in needs it to resolve an " +
        "address to an account and to create one. See web/.env.example.",
    );
  }

  return createSupabaseClient<Database>(getSupabaseUrl(), secret, {
    // This client is per-request and must never pick up, or write, the
    // caller's cookies — it is the one thing here that is not the user.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type WalletSignIn = {
  address: string;
  /** True when this call created the account rather than finding it. */
  created: boolean;
};

/**
 * Signs in the account that holds `address`, creating it if there is none.
 *
 * "Link first, create second" is the whole design. An address may already sit
 * on a profile because someone signed up by email and linked their wallet from
 * Settings, and that person must land back in their own workspace — creating a
 * second, empty account for them would look like their projects had vanished.
 *
 * There is deliberately no "no such account" answer. Anyone can ask about any
 * address, because addresses are public; answering with a session either way
 * means the endpoint reveals nothing, which keeps the promise
 * `app/login/actions.ts` already makes about not distinguishing "no such user"
 * from "wrong password".
 */
export async function signInWithWallet(address: string): Promise<WalletSignIn> {
  const admin = adminClient();

  const { data: profile, error: lookupError } = await admin
    .from("profiles")
    .select("id")
    .eq("wallet_address", address)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Could not look up that wallet: ${lookupError.message}`);
  }

  if (profile) {
    const { data, error } = await admin.auth.admin.getUserById(profile.id);

    // A profile whose auth user is gone should be impossible — profiles.id is
    // `references auth.users on delete cascade`. If it happens, failing is
    // right: creating a fresh account here would orphan the first one's data.
    if (error || !data.user?.email) {
      throw new Error(
        `A profile holds that wallet but its account could not be loaded${
          error ? `: ${error.message}` : "."
        }`,
      );
    }

    await mintSession(admin, data.user.email);
    return { address, created: false };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: placeholderEmail(address),
    // Nothing was sent to that address and nothing can be — it is unroutable by
    // design (see PLACEHOLDER_EMAIL_DOMAIN). Leaving it unconfirmed would block
    // sign-in on an inbox that does not exist.
    email_confirm: true,
    user_metadata: {
      // `handle_new_user()` unpacks both of these into the profile row.
      wallet_address: address,
      full_name: walletDisplayName(address),
    },
  });

  if (error || !data.user?.email) {
    throw new Error(
      `Could not create an account for that wallet${error ? `: ${error.message}` : "."}`,
    );
  }

  await mintSession(admin, data.user.email);
  return { address, created: true };
}

/**
 * Issues a session for `email` and writes it to the response cookies.
 *
 * Neither path here can use `signInWithPassword`. A wallet account has no
 * password at all, and an account that arrived by email has one this code must
 * not touch — the reference implementation in `../doqtri` derives a password by
 * HMAC and *resets the user's password to it*, which for qdit would silently
 * destroy the recovery credential that makes wallet sign-in safe to offer.
 *
 * So: mint a one-time token with the admin client and immediately spend it on
 * the session-bound client. `generateLink` sends no mail; it only returns the
 * token that a magic link would have carried.
 *
 * The session is written as cookies rather than returned to the caller. doqtri
 * hands `access_token`/`refresh_token` back to the browser and calls
 * `setSession()`; a token that never reaches JavaScript cannot be read by
 * anything that gets injected into the page, and the browser does not need it.
 */
async function mintSession(admin: SupabaseClient<Database>, email: string): Promise<void> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    throw new Error(
      `Could not issue a session${error ? `: ${error.message}` : "."}`,
    );
  }

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });

  if (verifyError) {
    throw new Error(`Could not start the session: ${verifyError.message}`);
  }
}

export type LinkOutcome =
  | { status: "linked" }
  | { status: "taken" }
  | { status: "failed"; message: string };

/**
 * Binds a proved address to the signed-in account.
 *
 * Runs on the caller's own client, not the admin one: `profiles: update own`
 * already permits exactly this and nothing more, so there is no reason to
 * reach for a key that permits everything.
 *
 * A `23505` is the unique index from `20260812043000_wallet_identity.sql`
 * saying another account already holds this address. Reporting that plainly is
 * safe — the caller just proved they control the wallet, so it tells them
 * something about themselves rather than about a stranger.
 */
export async function linkWalletToProfile(
  userId: string,
  address: string,
): Promise<LinkOutcome> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("profiles")
    .update({ wallet_address: address })
    .eq("id", userId);

  if (!error) return { status: "linked" };
  if (error.code === "23505") return { status: "taken" };

  return { status: "failed", message: error.message };
}
