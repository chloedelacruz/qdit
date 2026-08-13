"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";

import { headerKey, rateLimit } from "@/lib/auth/rate-limit";
import { TICKET_COOKIE, readTicket } from "@/lib/auth/registration-ticket";
import { hasRecoveryCredential } from "@/lib/auth/wallet-identity";
import {
  completeWalletAccount,
  createWalletAccount,
  type RegistrationOutcome,
} from "@/lib/auth/wallet-session";
import { walletRegistrationSchema } from "@/lib/schemas";
import { getUser } from "@/lib/supabase/server";

/**
 * Turning a proved wallet into an account somebody can actually get back into.
 *
 * ---------------------------------------------------------------------------
 * THIS ACTION IS A PUBLIC ENDPOINT
 * ---------------------------------------------------------------------------
 * A Server Action compiles to a POST against the page that renders it, so
 * everything the form does can be done without the form. Rendering `/register`
 * only for someone holding a ticket is not a boundary — this function checking
 * for one is. Next's own guidance says it in as many words: treat every action
 * as an untrusted entry point.
 *
 * So the two things that decide what this is allowed to do are both re-derived
 * here, from sources the caller does not control:
 *
 *   create   → the address inside the signed registration ticket cookie
 *   complete → the user id inside the verified session
 *
 * Neither is a form field. The form carries a username, an email and a password
 * and nothing else; a body claiming an address would be a body claiming an
 * identity, which is the confusion the signed challenge exists to end.
 */

export type RegisterState = {
  error?: string;
  fieldErrors?: Partial<Record<"username" | "email" | "password", string>>;
};

/** Creating an account is the expensive path; it gets the tightest limit here. */
const LIMIT = { limit: 5, windowMs: 60_000 };

/**
 * Walks `issues` rather than using `flatten()`: on a generically-typed ZodError
 * the latter widens `fieldErrors` to `{}` in Zod 4, so the keys are not
 * statically known. First message per field wins. Same shape, and the same
 * reason, as `login/actions.ts`.
 */
function fieldErrors(error: ZodError): RegisterState {
  const errors: NonNullable<RegisterState["fieldErrors"]> = {};

  for (const issue of error.issues) {
    const key = issue.path[0];
    if (
      (key === "username" || key === "email" || key === "password") &&
      !errors[key]
    ) {
      errors[key] = issue.message;
    }
  }

  return { fieldErrors: errors };
}

/** The one place an outcome becomes something a person reads. */
function describe(outcome: Exclude<RegistrationOutcome, { status: "created" }>): RegisterState {
  switch (outcome.status) {
    case "email-taken":
      // Every wallet gets its own email — one address, one account, one wallet.
      // Not "sign in and link it instead": linking is a one-time operation and
      // an account that already exists may already have a wallet, so that
      // advice would be wrong for most of the people who see this.
      return {
        fieldErrors: {
          email: "That email is already used by another qdit account.",
        },
      };

    case "username-taken":
      return { fieldErrors: { username: "That username is taken." } };

    case "wallet-taken":
      // The gap between the ticket and the form is fifteen minutes wide, and
      // somebody used it. There is an account now, so connecting again signs
      // them into it.
      return {
        error: "That wallet was just registered. Connect it again to sign in.",
      };

    case "failed":
      // Names internal ids and environment variables. Logged, never returned.
      console.error("wallet registration failed", outcome.message);
      return { error: "Could not create your account. Try again." };
  }
}

export async function completeWalletRegistration(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  if (!rateLimit(headerKey(await headers(), "wallet-register"), LIMIT)) {
    return { error: "Too many attempts. Wait a minute and try again." };
  }

  const parsed = walletRegistrationSchema.safeParse({
    username: String(formData.get("username") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) return fieldErrors(parsed.error);

  const { username, email, password } = parsed.data;

  // Which operation this is. A session means the account exists and is being
  // finished; no session means it does not exist and the ticket is the only
  // thing that says it may.
  const user = await getUser();

  let outcome: RegistrationOutcome;

  if (user) {
    // Already has an email and a password, and arrived here anyway — a stale
    // tab, or a POST aimed at this action directly. Nothing to do, and setting
    // a new address on an established account is emphatically not it.
    if (hasRecoveryCredential(user.email)) {
      return { error: "This account is already set up." };
    }

    outcome = await completeWalletAccount({
      userId: user.id,
      username,
      email,
      password,
    });
  } else {
    const store = await cookies();
    const address = readTicket(store.get(TICKET_COOKIE)?.value);

    if (!address) {
      return {
        error: "That took too long, or the wallet proof expired. Connect again.",
      };
    }

    outcome = await createWalletAccount({ address, username, email, password });
  }

  if (outcome.status !== "created") return describe(outcome);

  // Created and signed in. The ticket has been spent — clearing it means a
  // back button lands on `/register` with nothing to offer, which sends the
  // person to `/login`, rather than on a form that will now always fail.
  (await cookies()).delete(TICKET_COOKIE);

  revalidatePath("/", "layout");
  // Outside every try/catch in this function, deliberately: `redirect` works by
  // throwing, so catching around it swallows the navigation.
  redirect("/dashboard");
}
