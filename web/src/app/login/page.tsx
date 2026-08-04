import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

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
            <LoginForm />
          </div>
        </div>
      </main>
    </div>
  );
}
