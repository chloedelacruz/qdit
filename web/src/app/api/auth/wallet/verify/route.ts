import type { NextRequest } from "next/server";

import { ChallengeError, verifyChallenge } from "@/lib/auth/challenge";
import { clientKey, rateLimit } from "@/lib/auth/rate-limit";
import { linkWalletToProfile, signInWithWallet } from "@/lib/auth/wallet-session";
import { getUser } from "@/lib/supabase/server";

/**
 * Step two of wallet sign-in: spend the signature.
 *
 * One proof, three outcomes, decided by who is asking:
 *
 *   no session, address known    → sign in
 *   no session, address unknown  → create the account, then sign in
 *   session                      → link the address to that account
 *
 * The third is why the profile editor has no text box for a wallet address.
 * Typing an address claims one; signing a challenge proves one, and this is the
 * only door through which `profiles.wallet_address` is written.
 *
 * The address is never read from the request body — `verifyChallenge` returns
 * the account named inside the transaction the signature covers. A body field
 * could disagree with what was signed, and then this handler would have to pick
 * a side.
 */

/** As `../challenge`: the SDK and its crypto are Node, not Edge. */
export const runtime = "nodejs";

/** Tighter than the challenge endpoint: this one can create an account. */
const LIMIT = { limit: 10, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  if (!rateLimit(clientKey(request, "wallet-verify"), LIMIT)) {
    return Response.json(
      { error: "Too many sign-in attempts. Wait a minute and try again." },
      { status: 429 },
    );
  }

  let signedXdr: unknown;
  try {
    ({ signedXdr } = (await request.json()) as { signedXdr?: unknown });
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof signedXdr !== "string") {
    return Response.json({ error: "Expected a signed challenge." }, { status: 400 });
  }

  let address: string;
  try {
    address = verifyChallenge(signedXdr);
  } catch (error) {
    if (error instanceof ChallengeError) {
      // 401, not 400: the request was well-formed, it just did not prove
      // anything.
      return Response.json({ error: error.message }, { status: 401 });
    }

    console.error("wallet verify failed", error);
    return Response.json(
      { error: "Wallet sign-in is not configured." },
      { status: 500 },
    );
  }

  const user = await getUser();

  if (user) {
    const outcome = await linkWalletToProfile(user.id, address);

    if (outcome.status === "taken") {
      return Response.json(
        { error: "That wallet is already linked to another qdit account." },
        { status: 409 },
      );
    }

    if (outcome.status === "failed") {
      console.error("wallet link failed", outcome.message);
      return Response.json(
        { error: "Could not link that wallet. Try again." },
        { status: 500 },
      );
    }

    return Response.json({ address, linked: true });
  }

  try {
    const { created } = await signInWithWallet(address);
    return Response.json({ address, created });
  } catch (error) {
    // Everything reaching here is infrastructure: a missing secret key, an Auth
    // server that would not issue a token, a profile whose account is gone. The
    // messages name environment variables and internal ids, so they are logged
    // rather than returned.
    console.error("wallet sign-in failed", error);
    return Response.json(
      { error: "Could not complete sign-in. Try again." },
      { status: 500 },
    );
  }
}
