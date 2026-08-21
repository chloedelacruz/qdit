import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { hasRecoveryCredential } from "@/lib/auth/wallet-identity";
import { getSupabaseUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

/**
 * Turning a proved wallet address into a session — or into a decision that
 * there is nobody to make a session for.
 *
 * Runs only after `verifyChallenge()` has established that the caller controls
 * the address. Nothing here re-checks that, and nothing here may be called with
 * an address that came straight off a request body.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED: A SIGNATURE NO LONGER CREATES AN ACCOUNT
 * ---------------------------------------------------------------------------
 * `signInWithWallet()` used to end with `admin.createUser()` when the lookup
 * found nothing, so connecting an unknown wallet produced an account and a
 * session in one step, with the person having typed nothing. The account it
 * made had a synthetic `…@wallet.qdit.local` address, no password and no name,
 * which meant one lost seed phrase was one unreachable workspace — and the
 * dashboard card that was supposed to fix that afterwards was designed and
 * never built.
 *
 * Now the two halves are separate operations with a form between them.
 * `signInWithWallet()` only ever *finds*; `createWalletAccount()` is the only
 * thing in the app that creates, it takes a username, an email and a password,
 * and it is unreachable without a registration ticket.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE HOLDS THE ONLY SERVICE-ROLE KEY IN THE APP
 * ---------------------------------------------------------------------------
 * `web/.env.example` used to say the secret key was "only needed for admin
 * scripts or webhooks; the app does not use it". This is what changed that, and
 * it needs exactly two capabilities RLS cannot grant:
 *
 *   1. resolving an address to an account across *all* profiles — the caller
 *      has no session yet, so there is no `auth.uid()` for a policy to match;
 *   2. creating an `auth.users` row.
 *
 * Both are reached only from the wallet route handler and the registration
 * action. Nothing in this module takes a user id from its caller: the account is
 * always the one the signature pointed at, which is what keeps a bypassed RLS
 * from mattering.
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

export type WalletSignIn =
  /** An account holds this address and the session cookies are now written. */
  | { status: "signed-in" }
  /**
   * An account holds this address, the session is written, and the account
   * still has a placeholder email — one of the accounts the old auto-create
   * flow made. It has a session because it has proved its wallet and is
   * entitled to one; it is sent to registration to finish, and `(app)/layout`
   * keeps sending it back until it does.
   */
  | { status: "complete-account" }
  /** Nothing holds this address. Nothing was created. */
  | { status: "registration-required" };

/**
 * Finds the account that holds `address` and signs it in. Creates nothing.
 *
 * "Link first" is still the whole design of the lookup. An address may already
 * sit on a profile because someone signed up by email and linked their wallet
 * from Settings, and that person must land back in their own workspace —
 * treating them as a new registration would look like their projects had
 * vanished.
 *
 * There is deliberately no "no such account" *challenge*: `/challenge` answers
 * identically for every address, because addresses are public and it must not
 * become an existence oracle. This function does distinguish, and its answer
 * does reach the caller — but only a caller who has just signed a challenge for
 * that address, i.e. its owner. Telling somebody whether their own wallet has
 * an account reveals nothing about a stranger.
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

  if (!profile) return { status: "registration-required" };

  const { data, error } = await admin.auth.admin.getUserById(profile.id);

  // A profile whose auth user is gone should be impossible — profiles.id is
  // `references auth.users on delete cascade`. If it happens, failing is right:
  // sending them to registration instead would orphan the first account's data
  // behind a second one.
  if (error || !data.user?.email) {
    throw new Error(
      `A profile holds that wallet but its account could not be loaded${
        error ? `: ${error.message}` : "."
      }`,
    );
  }

  await mintSession(admin, data.user.email);

  return hasRecoveryCredential(data.user.email)
    ? { status: "signed-in" }
    : { status: "complete-account" };
}

export type RegistrationOutcome =
  | { status: "created" }
  | { status: "email-taken" }
  | { status: "username-taken" }
  /** Somebody registered this address between the ticket and the form. */
  | { status: "wallet-taken" }
  | { status: "failed"; message: string };

/**
 * Creates the account for a proved address, and signs it in.
 *
 * `address` must come from a registration ticket, never from the form — see
 * `registration-ticket.ts` for what the ticket is and why the address travels
 * inside it rather than beside it.
 *
 * ---------------------------------------------------------------------------
 * WHERE EACH FIELD LANDS, AND WHY THE ADDRESS IS NOT WHERE IT USED TO BE
 * ---------------------------------------------------------------------------
 *   app_metadata.wallet_address   → profiles.wallet_address
 *   user_metadata.username        → profiles.username
 *   user_metadata.full_name       → profiles.display_name
 *
 * `app_metadata`, not `user_metadata`, and this is the fix for a real hole:
 * `user_metadata` is the `data` field of GoTrue's *public* signup endpoint, so
 * while `handle_new_user()` read the address from there, anyone with the
 * publishable key could create an account claiming a wallet they did not
 * control and lock its real owner out of their own identity. Only the service
 * role can write `app_metadata`. See §3 of 20260812235342_profile_username.sql.
 *
 * The profile row is written by the trigger, in the same transaction, which is
 * why all three travel as metadata rather than being written here in a second
 * statement: a second statement can fail on its own and leave an account whose
 * wallet cannot sign it in.
 *
 * ---------------------------------------------------------------------------
 * email_confirm: true — WHAT THIS ACCEPTS
 * ---------------------------------------------------------------------------
 * The address is trusted on the strength of the wallet signature rather than on
 * a round trip to the inbox. That is the same call the previous flow made for
 * placeholder addresses, and it is the path this project is known to work on.
 *
 * What it accepts: somebody can register with an email they do not own. They
 * get an account that is already theirs by wallet, and the address's real owner
 * is denied that address for qdit until it is released. Nobody's data is
 * exposed and no existing account is reachable — the squatter has to hold the
 * wallet, and holding the wallet is the credential either way.
 *
 * What would close it: create unconfirmed, send a verification, and refuse
 * `signInWithPassword` until it lands. That path is not taken here because it
 * turns on whether `generateLink` will issue a token for an unconfirmed user,
 * which has not been verified against a running stack — and a wrong guess makes
 * registration fail for everyone rather than for a squatter.
 */
export async function createWalletAccount({
  address,
  username,
  email,
  password,
}: {
  address: string;
  username: string;
  email: string;
  password: string;
}): Promise<RegistrationOutcome> {
  const admin = adminClient();

  // Asked before creating, because it cannot be asked afterwards. A username
  // collision is raised by `handle_new_user()`'s insert, which fails the whole
  // `createUser` call — and supabase-js reduces that error to the string `{}`,
  // losing the constraint name, the SQLSTATE and the detail. Verified against
  // the hosted project: the raw endpoint returns
  // `duplicate key value violates unique constraint "profiles_username_key"`
  // and the client hands back `error.message === "{}"`.
  if (await usernameTaken(admin, username)) return { status: "username-taken" };

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { wallet_address: address },
    user_metadata: { username, full_name: username },
  });

  if (error || !data.user?.email) {
    const outcome = classifyCreateError(error);

    // The check above is not a lock: two registrations can pass it and one
    // still lose the insert. When the failure is otherwise unexplained, ask the
    // database what it thinks rather than the error message, which is `{}`.
    if (outcome.status === "failed" && (await usernameTaken(admin, username))) {
      return { status: "username-taken" };
    }

    return outcome;
  }

  const bound = await bindWallet(admin, data.user.id, address);
  if (bound) return bound;

  await mintSession(admin, data.user.email);

  return { status: "created" };
}

/**
 * Writes the address onto the profile the trigger just made. Returns a failure
 * outcome, or `null` when it worked.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS WHEN THE TRIGGER ALREADY READS app_metadata
 * ---------------------------------------------------------------------------
 * Because the trigger cannot see it yet. GoTrue's admin create is two steps:
 * it inserts the `auth.users` row with `raw_app_meta_data` holding only
 * `{provider, providers}`, which fires `handle_new_user()`, and only then
 * updates the row to merge in the custom `app_metadata` this call passed.
 *
 * `raw_user_meta_data` is populated at insert, which is why `username` and
 * `display_name` arrive through the trigger and `wallet_address` does not.
 * Verified against the hosted project: a created user comes back with
 * `app_metadata.wallet_address` set and its profile row holding
 * `wallet_address: null`.
 *
 * The trigger keeps reading `app_metadata` anyway. That read is the security
 * boundary — it is what stops a public signup claiming an address through
 * `user_metadata` — and it stays correct whether or not GoTrue ever populates
 * the field in time. This write is the legitimate path filling the gap.
 *
 * ---------------------------------------------------------------------------
 * AND WHY A FAILURE DELETES THE ACCOUNT
 * ---------------------------------------------------------------------------
 * Writing the address in a second, non-atomic statement was rejected: it can
 * fail on its own, leaving an account whose wallet cannot sign it in, which is
 * an account nobody can open. So the second statement is made atomic by hand:
 * if it fails the
 * account is removed, and the person is told to try again rather than left
 * holding something half-made.
 */
async function bindWallet(
  admin: SupabaseClient<Database>,
  userId: string,
  address: string,
): Promise<RegistrationOutcome | null> {
  const { error } = await admin
    .from("profiles")
    .update({ wallet_address: address })
    .eq("id", userId);

  if (!error) return null;

  await admin.auth.admin.deleteUser(userId);

  // The partial unique index: somebody registered this address in the gap
  // between the ticket being issued and the form being submitted.
  if (error.code === "23505") return { status: "wallet-taken" };

  return { status: "failed", message: error.message };
}

/**
 * Gives an account that predates registration the credentials it should have
 * been born with.
 *
 * These are the accounts the retired auto-create flow made: a real wallet, a
 * real profile, real projects — and a `…@wallet.qdit.local` address, no password
 * and a display name that is their own address abbreviated. There is one in the
 * hosted project. It is somebody's account, so it is completed rather than
 * migrated or deleted.
 *
 * `userId` comes from the verified session, never from a form. The caller must
 * already have proved the wallet, which `signInWithWallet` did when it returned
 * `complete-account` and minted the session this runs under.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ADMIN CLIENT SETS THE EMAIL, AND NOT updateUser()
 * ---------------------------------------------------------------------------
 * The user's own `updateUser({ email })` starts a *change* of address, and
 * `supabase/config.toml` sets `double_confirm_changes = true`, which confirms a
 * change at both the old address and the new one. The old address here is
 * `…@wallet.qdit.local`, which is unroutable by construction — nothing can ever
 * be delivered to it, so the confirmation could never complete and the account
 * would sit in a pending state forever.
 *
 * The plan for the never-built recovery card proposed turning that setting off.
 * Setting the address with the admin client instead leaves it on for everyone
 * else, where it is doing a real job: it is what stops a stolen session from
 * quietly moving an account to an attacker's inbox.
 *
 * The profile is written first. It is the write that can fail on a uniqueness
 * conflict, and failing before the credentials change means a retry is a clean
 * retry rather than one that has already half-succeeded.
 */
export async function completeWalletAccount({
  userId,
  username,
  email,
  password,
}: {
  userId: string;
  username: string;
  email: string;
  password: string;
}): Promise<RegistrationOutcome> {
  const supabase = await createClient();

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ username, display_name: username })
    .eq("id", userId);

  if (profileError) {
    if (profileError.code === "23505") return { status: "username-taken" };
    return { status: "failed", message: profileError.message };
  }

  const admin = adminClient();

  const { error } = await admin.auth.admin.updateUserById(userId, {
    email,
    password,
    // Same trade as createWalletAccount: the wallet signature is what this
    // account is trusted on, and the placeholder it is replacing was never
    // deliverable either.
    email_confirm: true,
    user_metadata: { username, full_name: username },
  });

  if (error) return classifyCreateError(error);

  return { status: "created" };
}

/** Whether a profile already holds this username. */
async function usernameTaken(
  admin: SupabaseClient<Database>,
  username: string,
): Promise<boolean> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  return Boolean(data);
}

/**
 * What `createUser` failed on, as far as its error can say.
 *
 * Only the email is reliably identifiable here. A duplicate email is GoTrue's
 * own check, so it comes back as a 422 with a stable `email_exists` code and
 * survives the trip through supabase-js intact.
 *
 * A duplicate username or wallet address is raised by Postgres inside the
 * profile trigger, and supabase-js flattens that to `{}` — no constraint name,
 * no SQLSTATE. The index-name matching below is kept because it costs nothing
 * and would work if the client ever stopped swallowing the detail, but it is
 * not what catches those cases today: `usernameTaken()` at the call site is,
 * and `bindWallet()` sees the address conflict through PostgREST, which does
 * report `23505` properly.
 *
 * Anything unrecognised is `failed`, whose message is logged and never shown —
 * it can name internal ids.
 */
function classifyCreateError(error: unknown): RegistrationOutcome {
  const message = error instanceof Error ? error.message : String(error ?? "unknown");
  const haystack = message.toLowerCase();

  if (haystack.includes("profiles_username_key")) return { status: "username-taken" };
  if (haystack.includes("profiles_wallet_address_key")) return { status: "wallet-taken" };

  if (
    haystack.includes("email_exists") ||
    haystack.includes("already been registered") ||
    haystack.includes("already registered")
  ) {
    return { status: "email-taken" };
  }

  return { status: "failed", message };
}

/**
 * Issues a session for `email` and writes it to the response cookies.
 *
 * Neither path here can use `signInWithPassword`. A registration has a password
 * but has not finished being created at the point the session is needed, and an
 * account that arrived by email has one this code must not touch — the
 * reference implementation in `../doqtri` derives a password by HMAC and
 * *resets the user's password to it*, which for qdit would silently destroy the
 * recovery credential that makes wallet sign-in safe to offer.
 *
 * So: mint a one-time token with the admin client and immediately spend it on
 * the session-bound client. `generateLink` sends no mail; it only returns the
 * token that a magic link would have carried.
 *
 * The session is written as cookies on this response rather than returned to
 * the caller. doqtri hands `access_token`/`refresh_token` back to the browser
 * and calls `setSession()`; skipping that means the token never travels through
 * a response body the client has to receive, hold and pass on.
 *
 * It does **not** put the token beyond JavaScript's reach, and an earlier
 * version of this comment claimed that it did. `@supabase/ssr` writes
 * `sb-<ref>-auth-token` with `Path=/` and `SameSite=lax` and deliberately no
 * `HttpOnly` — the browser client reads the session back out of
 * `document.cookie`, which is how a Client Component has a session at all.
 * Anything running on the page can read it either way.
 *
 * So what this buys is a smaller surface, not secrecy from the page: no token
 * in a response body, and no window where the app holds one in memory before
 * the cookie exists. Protection against injected script is CSP and not shipping
 * the injection, exactly as it is for every other `@supabase/ssr` app.
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
  /** This account already has an address, and an address is written once. */
  | { status: "already-set" }
  | { status: "failed"; message: string };

/**
 * Binds a proved address to the signed-in account — once.
 *
 * Runs on the caller's own client, not the admin one: `profiles: update own`
 * already permits exactly this and nothing more, so there is no reason to reach
 * for a key that permits everything.
 *
 * `.is("wallet_address", null)` is what makes this a one-time operation. The
 * remaining use is an account that predates the wallet flow — signed up by
 * email, no address yet — attaching one for the first time. An account that has
 * an address cannot swap it, here or anywhere: the address is a proved identity
 * rather than a preference, and `profiles_freeze_wallet_address` in
 * 20260812235413_wallet_address_immutable.sql enforces that below the app, where
 * a hand-made PostgREST call cannot get underneath it.
 *
 * So the filter is not the protection — the trigger is. The filter is what
 * turns "the database refused you" into a sentence about what happened.
 *
 * A `23505` is the unique index from `20260812130728_wallet_identity.sql` saying
 * another account already holds this address. Reporting that plainly is safe —
 * the caller just proved they control the wallet, so it tells them something
 * about themselves rather than about a stranger.
 */
export async function linkWalletToProfile(
  userId: string,
  address: string,
): Promise<LinkOutcome> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .update({ wallet_address: address })
    .eq("id", userId)
    .is("wallet_address", null)
    .select("id");

  if (error) {
    if (error.code === "23505") return { status: "taken" };
    return { status: "failed", message: error.message };
  }

  // No error and no row: the `is null` filter matched nothing, so this account
  // already has an address. RLS would also produce this by hiding the row, but
  // the caller is updating their own profile, which `profiles: update own`
  // permits — so the filter is the only thing that can have excluded it.
  if (!data || data.length === 0) return { status: "already-set" };

  return { status: "linked" };
}
