"use server";

import { redirect } from "next/navigation";

import { loginPath } from "@/lib/auth/next-path";
import {
  consentPath,
  decideConsent,
  parseAuthorizationId,
  parseDecision,
} from "@/lib/auth/oauth-consent";
import { createClient, getUser } from "@/lib/supabase/server";

export type ConsentState = { error?: string };

/**
 * Approve or deny an OAuth authorization request, then send the browser back
 * to the app that asked.
 *
 * Everything posted is re-checked. The form holds the authorization id and the
 * button holds the decision, and both are the client's: the id is parsed to
 * the same shape the page accepted, and a decision that is neither "approve"
 * nor "deny" is refused rather than read as one of them.
 *
 * The user is whoever this request's session says. Supabase Auth ties the
 * authorization to the user who fetched its details, and refuses a decision
 * posted with anyone else's session, so a forged form from another account
 * gets an error, not a grant.
 */
export async function decideAuthorization(
  _prev: ConsentState,
  formData: FormData,
): Promise<ConsentState> {
  const authorizationId = parseAuthorizationId(formData.get("authorization_id"));
  const decision = parseDecision(formData.get("decision"));

  if (!authorizationId || !decision) {
    return { error: "That request was not understood. Go back to the app and connect again." };
  }

  // Signed out between loading the page and pressing the button — another tab,
  // an expired session. Back through login, and back here after.
  if (!(await getUser())) redirect(loginPath(consentPath(authorizationId)));

  const supabase = await createClient();
  const outcome = await decideConsent(supabase.auth.oauth, authorizationId, decision);

  if (outcome.kind === "error") return { error: outcome.message };

  // Outside any try/catch: `redirect` works by throwing.
  redirect(outcome.url);
}
