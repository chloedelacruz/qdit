import type { NextRequest } from "next/server";

import { ChallengeError, buildChallenge } from "@/lib/auth/challenge";
import { clientKey, rateLimit } from "@/lib/auth/rate-limit";

/**
 * Step one of wallet sign-in: hand out something only the wallet can answer.
 *
 * This endpoint is deliberately uninteresting to attack. It answers for *any*
 * valid address, because a Stellar address is public — it is on the ledger —
 * and a challenge proves nothing on its own. There is no "no such account"
 * response here and there must never be one: that answer would turn a public
 * identifier into an account-existence oracle, which is the thing
 * `app/login/actions.ts` already refuses to be for email addresses.
 *
 * The signed result goes to `../verify`.
 */

/**
 * `@stellar/stellar-sdk` and its crypto are Node, not Edge. This is the default
 * for Route Handlers; it is stated because moving it would break at runtime
 * rather than at build time.
 */
export const runtime = "nodejs";

/** Enough to fumble a wallet chooser a few times; not enough to grind. */
const LIMIT = { limit: 20, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  if (!rateLimit(clientKey(request, "wallet-challenge"), LIMIT)) {
    return Response.json(
      { error: "Too many sign-in attempts. Wait a minute and try again." },
      { status: 429 },
    );
  }

  let address: unknown;
  try {
    ({ address } = (await request.json()) as { address?: unknown });
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof address !== "string") {
    return Response.json({ error: "Expected an address." }, { status: 400 });
  }

  try {
    return Response.json({ xdr: buildChallenge(address) });
  } catch (error) {
    // ChallengeError is the caller's fault — a malformed address. Anything else
    // is this deployment's fault, and its message names environment variables,
    // so it goes to the log and the caller gets nothing to work with.
    if (error instanceof ChallengeError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    console.error("wallet challenge failed", error);
    return Response.json(
      { error: "Wallet sign-in is not configured." },
      { status: 500 },
    );
  }
}
