import type { NextRequest } from "next/server";

import { ChallengeError, verifyChallenge } from "@/lib/auth/challenge";
import { clientKey, rateLimit } from "@/lib/auth/rate-limit";
import { linkWalletToProfile, signInWithWallet } from "@/lib/auth/wallet-session";
import { getUser } from "@/lib/supabase/server";

/**
 * Step two of wallet sign-in: spend the signature.
 *
 * One proof, two things it can buy, and **the caller has to say which**:
 *
 *   intent: "sign-in"  → become the account that holds this address,
 *                        creating it if no account does
 *   intent: "link"     → bind this address to the account already signed in
 *
 * ---------------------------------------------------------------------------
 * WHY INTENT IS EXPLICIT RATHER THAN INFERRED FROM THE SESSION
 * ---------------------------------------------------------------------------
 * The obvious design — link when there is a session, sign in when there is not
 * — reads well and has a trap in it. The landing page offers "Connect wallet"
 * to everyone, including someone whose session is still alive in another tab.
 * Under the inferred rule, that person connecting a *different* wallet would
 * silently rebind their account to it: same click, same button, and their old
 * wallet stops opening their workspace. Nobody asked for that and nothing on
 * screen said it would happen.
 *
 * So the two intents are separate operations that happen to share a proof.
 * "sign-in" never writes `profiles.wallet_address`; "link" never mints a
 * session, and refuses outright when there is nobody to link to.
 *
 * Linking is still the only door through which `profiles.wallet_address` is
 * written — which is why the profile editor has no text box for one. Typing an
 * address claims it; signing a challenge proves it.
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
  let intent: unknown;
  try {
    ({ signedXdr, intent } = (await request.json()) as {
      signedXdr?: unknown;
      intent?: unknown;
    });
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof signedXdr !== "string") {
    return Response.json({ error: "Expected a signed challenge." }, { status: 400 });
  }

  // No default. A missing intent is a caller that has not decided whether it
  // wants a session or a binding, and guessing on its behalf is the whole thing
  // this parameter exists to prevent.
  if (intent !== "sign-in" && intent !== "link") {
    return Response.json(
      { error: 'Expected intent to be "sign-in" or "link".' },
      { status: 400 },
    );
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

  if (intent === "link") {
    const user = await getUser();

    // Nothing to link to. Not an invitation to sign in instead: the caller
    // asked for a binding, and quietly giving it a session would be answering a
    // question it did not ask.
    if (!user) {
      return Response.json(
        { error: "Sign in before linking a wallet." },
        { status: 401 },
      );
    }

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

  // intent === "sign-in". Any session already in the cookies is replaced rather
  // than consulted: the caller asked to become this wallet's account, and the
  // freshly minted session simply overwrites what was there.
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
