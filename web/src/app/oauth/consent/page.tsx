import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { QditLogo } from "@/components/brand/qdit-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { loginPath } from "@/lib/auth/next-path";
import {
  APP_ACCESS,
  consentPath,
  loadConsent,
  parseAuthorizationId,
} from "@/lib/auth/oauth-consent";
import { createClient, getUser } from "@/lib/supabase/server";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Connect an app" };

/**
 * The OAuth consent screen (masterplan D-02).
 *
 * Supabase Auth sends the browser here — `authorization_url_path` in
 * supabase/config.toml — when another app, doqtri, asks to act for a qdit
 * user. The flow:
 *
 *   1. No session: off to /login, carrying this URL as `next`, and back here
 *      once signed in by any route (wallet, email, or registering first).
 *   2. Ask Auth what the request is. If the user already approved this client
 *      for these scopes, Auth says so with a redirect and there is nothing to
 *      ask — go straight back.
 *   3. Otherwise show who is asking, where the browser goes afterwards, the
 *      scopes, and what an app can and cannot do here — then Allow / Deny.
 *
 * Outside the (app) route group on purpose: this is a decision screen for
 * someone mid-way through another app, and the sidebar would be a set of exits
 * that strand the request.
 */
/*
 * No icons in the two lists. A column of ticks beside "will be able to" is a
 * checklist, which the design language rules out, and ICON.ready means a setup
 * step the browser detected — not a permission. Weight and colour carry the
 * difference between the lists instead.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authorizationId = parseAuthorizationId((await searchParams).authorization_id);

  if (!authorizationId) {
    return (
      <ConsentShell>
        <Problem message="This link is missing its request. Go back to the app and connect again." />
      </ConsentShell>
    );
  }

  if (!(await getUser())) redirect(loginPath(consentPath(authorizationId)));

  const supabase = await createClient();
  const view = await loadConsent(supabase.auth.oauth, authorizationId);

  // Already approved before: Auth issued a code without asking again.
  if (view.kind === "redirect") redirect(view.url);

  if (view.kind === "error") {
    return (
      <ConsentShell>
        <Problem message={view.message} />
      </ConsentShell>
    );
  }

  const { request } = view;

  return (
    <ConsentShell>
      <div className="mb-6">
        <h1 className="text-lg">Connect {request.client.name} to qdit</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {request.client.host ? (
            <>
              <span className="font-mono text-xs">{request.client.host}</span> wants to
              act for you in qdit.
            </>
          ) : (
            "This app wants to act for you in qdit."
          )}
        </p>
      </div>

      <div className="surface-primary space-y-5 rounded-xl border border-border-strong p-5">
        {request.userEmail ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-sm font-medium">Signed in as</span>
            <span className="text-sm text-muted-foreground">{request.userEmail}</span>
          </div>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">It will be able to</h2>
          <ul className="space-y-1.5">
            {APP_ACCESS.can.map((line) => (
              <li key={line} className="text-sm">
                {line}
              </li>
            ))}
            {request.scopes.map((line) => (
              <li key={line.scope} className="text-sm">
                {line.label}
                {line.label !== line.scope ? (
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                    {line.scope}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">It will not be able to</h2>
          <ul className="space-y-1.5">
            {APP_ACCESS.cannot.map((line) => (
              <li key={line} className="text-sm text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            It works with your role in each project, never more. You can disconnect it any time
            in Settings.
          </p>
        </section>

        {request.redirectHost ? (
          <p className="text-xs text-muted-foreground">
            After you choose, you go back to{" "}
            <span className="font-mono">{request.redirectHost}</span>.
          </p>
        ) : null}

        <ConsentForm authorizationId={request.authorizationId} clientName={request.client.name} />
      </div>
    </ConsentShell>
  );
}

function ConsentShell({ children }: { children: React.ReactNode }) {
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
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-lg">Connect an app</h1>
      </div>
      <div className="surface-primary rounded-xl border border-border-strong p-5">
        <p role="alert" className="text-sm text-muted-foreground">
          {message}
        </p>
      </div>
    </>
  );
}
