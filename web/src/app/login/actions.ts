"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";

import { credentialsSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  /** Set when sign-up succeeded but the address still needs confirming. */
  notice?: string;
  fieldErrors?: Partial<Record<"email" | "password", string>>;
};

function parse(formData: FormData) {
  return credentialsSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
}

/**
 * Walks `issues` rather than using `flatten()`: on a generically-typed
 * ZodError the latter widens `fieldErrors` to `{}` in Zod 4, so the keys are
 * not statically known. First message per field wins.
 */
function fieldErrors(error: ZodError): AuthState {
  const errors: NonNullable<AuthState["fieldErrors"]> = {};

  for (const issue of error.issues) {
    const key = issue.path[0];
    if ((key === "email" || key === "password") && !errors[key]) {
      errors[key] = issue.message;
    }
  }

  return { fieldErrors: errors };
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parse(formData);
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Supabase deliberately returns the same message for "no such user" and
    // "wrong password" — do not try to distinguish them, that is account
    // enumeration.
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Retired, and kept.
 *
 * Nothing imports this. Accounts are created by connecting a wallet — see
 * `lib/auth/wallet-session.ts` — so nothing asks someone to invent a password
 * before they can look at the product. An email and password get *attached* to
 * an account that already exists, which is a different operation with a
 * different shape and a different home.
 *
 * It stays because the decision it encodes may be revisited, and because an
 * unreferenced Server Action is inert: Next only registers actions reachable
 * from the client bundle, so with nothing importing it there is no id and no
 * endpoint to post to. Wire it to a form and it works exactly as it did.
 */
export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parse(formData);
  if (!parsed.success) return fieldErrors(parsed.error);

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000";

  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) return { error: error.message };

  // When email confirmation is enabled Supabase returns a user but no session.
  // Saying so is the difference between "nothing happened" and "check inbox".
  if (data.user && !data.session) {
    return {
      notice: "Check your inbox to confirm your address, then sign in.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();

  // `local`, not the Supabase default of `global`. Global revokes every refresh
  // token the user holds, so signing out in one browser would also sign them
  // out on their phone — surprising for a normal sign-out. Revoking everywhere
  // belongs behind an explicit "sign out of all devices" action.
  await supabase.auth.signOut({ scope: "local" });

  revalidatePath("/", "layout");
  redirect("/login");
}
