import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConnectWalletButton } from "@/components/auth/connect-wallet-button";
import { WalletSetup } from "@/components/auth/wallet-setup";
import { QditLogo } from "@/components/brand/qdit-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { getUser } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // Already signed in — sending them to a login form would be a dead end.
  if (await getUser()) redirect("/dashboard");

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
            <h1 className="text-lg">Sign in to qdit</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your projects, milestones and proof trail.
            </p>
          </div>

          <div className="surface-primary rounded-xl border border-border-strong p-5">
            {/*
              The setup steps come *before* the button, not after it. Someone
              who does not have a wallet yet cannot act on advice printed under
              a control they already clicked and watched do nothing.
            */}
            <WalletSetup className="mb-5" />

            <ConnectWalletButton className="w-full" />
            <p className="mt-3 text-xs text-muted-foreground">
              Connecting signs you in. A wallet that is new here goes to a short
              form first — connecting alone no longer creates an account.
            </p>
          </div>

          {/*
            Email and password are the *recovery* credential, not the entrance:
            an account is created by connecting a wallet, and an address is
            attached afterwards so a lost wallet is not a lost workspace. This
            form is how someone in that position gets back in, which is why it
            is here and why it is second.

            There is no "create an account" alongside it any more. See the note
            on signUp() in ./actions.ts.
          */}
          <div className="mt-6">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <h2 className="mt-6 text-sm font-medium">Lost your wallet?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Sign in with the email and password you added as a recovery method.
            </p>

            <div className="mt-4">
              <LoginForm />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
