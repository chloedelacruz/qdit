import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { QditLogo } from "@/components/brand/qdit-mark";
import { HashLink } from "@/components/hash-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { TICKET_COOKIE, readTicket } from "@/lib/auth/registration-ticket";
import { hasRecoveryCredential } from "@/lib/auth/wallet-identity";
import type { StellarNetwork } from "@/lib/stellar";
import { createClient, getUser } from "@/lib/supabase/server";
import { RegisterForm } from "./register-form";

/**
 * The screen between proving a wallet and having an account.
 *
 * Two ways to arrive, and the page works out which without being told:
 *
 *   create    no session, a valid registration ticket → the address is in the
 *             ticket, and submitting the form is what creates the account
 *   complete  a session whose email is still a placeholder → the account exists
 *             and is one the retired auto-create flow made; the form gives it
 *             the credentials it should have started with
 *
 * Anything else is sent away: a signed-in account that is already set up has
 * nothing to do here, and a visitor with neither ticket nor session has no
 * proved wallet, so there is nothing to register.
 *
 * The mode is derived from the session and the cookie rather than passed in a
 * query parameter, because a query parameter is a claim and both of these are
 * facts. `./actions.ts` re-derives it a second time for the same reason.
 */

const NETWORK: StellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const metadata: Metadata = { title: "Finish setting up" };

type Mode = "create" | "complete";

async function resolve(): Promise<{ mode: Mode; address: string | null }> {
  const user = await getUser();

  if (user) {
    // Already has a way back in. Nothing to finish.
    if (hasRecoveryCredential(user.email)) redirect("/dashboard");

    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("wallet_address")
      .eq("id", user.id)
      .maybeSingle();

    /*
      The address may be null, and this page must render anyway.

      A placeholder-email account with no wallet address should not exist — the
      only thing that ever made a placeholder was the wallet flow, which always
      wrote an address. But "should not exist" is not "cannot", and the obvious
      handling — bounce to /dashboard — is a loop: `(app)/layout.tsx` sends
      every placeholder-email account straight back here. Two redirects pointing
      at each other, and the browser gives up.

      So the accept condition of this page has to be exactly the reject
      condition of that layout: a placeholder email, and nothing else. The
      wallet block below is what becomes conditional instead, which is also the
      honest rendering — there is no address to promise permanence for.
    */
    return { mode: "complete", address: data?.wallet_address ?? null };
  }

  const store = await cookies();
  const address = readTicket(store.get(TICKET_COOKIE)?.value);

  // No proof, no registration. Expired, tampered with, or simply a stranger
  // typing the URL — all the same answer, and `/login` is where the wallet
  // button lives.
  if (!address) redirect("/login");

  return { mode: "create", address };
}

export default async function RegisterPage() {
  const { mode, address } = await resolve();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-6 py-5">
        <Link href="/" className="transition-qdit shrink-0 hover:opacity-80">
          <QditLogo />
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-12 sm:items-center sm:py-20">
        <div className="w-full max-w-sm">
          <div className="mb-6">
            <h1 className="text-lg">
              {mode === "create" ? "Finish setting up" : "Add a way back in"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "create"
                ? "Your wallet is verified. Choose how you sign in without it."
                : "This account can only be opened with your wallet. Not for much longer."}
            </p>
          </div>

          <div className="surface-primary space-y-5 rounded-xl border border-border-strong p-5">
            {address ? (
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Wallet</span>
                {/*
                  Rendered, never an input. Typing an address claims one and
                  connecting proves one, so there is no text box for this
                  anywhere in the app — and after this screen there is no way to
                  change it at all, which the sentence below says out loud
                  because someone registering the wrong wallet needs to find out
                  now.
                */}
                <div className="flex flex-wrap items-center gap-2">
                  <HashLink value={address} kind="account" network={NETWORK} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Permanently linked to this account. It cannot be changed later.
                </p>
              </div>
            ) : null}

            <RegisterForm mode={mode} />
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Your email and password are how you get back in if you lose your
            wallet. qdit cannot recover an account without them.
          </p>
        </div>
      </main>
    </div>
  );
}
