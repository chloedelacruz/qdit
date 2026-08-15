import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { hasRecoveryCredential } from "@/lib/auth/wallet-identity";
import {
  countUnreadNotifications,
  listNotifications,
  listProjectOptions,
} from "@/lib/queries";
import { getUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  /**
   * All four requests are issued together rather than one after the other. They do
   * not depend on each other — RLS scopes the project list to whoever the
   * request is authenticated as, so it returns nothing for a signed-out caller
   * and the redirect below still fires. Awaiting them in sequence added a whole
   * round trip to every navigation in the app.
   */
  const [user, projects, notifications, unread] = await Promise.all([
    getUser(),
    listProjectOptions(),
    listNotifications(),
    countUnreadNotifications(),
  ]);

  // The gate for every authenticated route. RLS is the real enforcement — this
  // just avoids rendering an app shell full of empty lists to a signed-out
  // visitor, which reads as "broken" rather than "sign in".
  if (!user) redirect("/login");

  /**
   * Every account has an email and a password. This is where that stops being
   * an intention and becomes true of accounts that already exist.
   *
   * Only the accounts the retired auto-create flow made can fail this — they
   * hold a `…@wallet.qdit.local` address, which is unroutable by construction
   * and therefore no way back in at all. Registration is where they get one,
   * and there is nowhere else to go until they do.
   *
   * `/register` is outside this route group, so this cannot loop. It is not an
   * authorization check either: these accounts have a real session and RLS
   * treats them exactly as it always did. It is a redirect, and someone who
   * hits the API directly is signed in and entitled to be.
   */
  if (!hasRecoveryCredential(user.email)) redirect("/register");

  return (
    <AppShell
      projects={projects}
      email={user.email ?? ""}
      notifications={notifications}
      unread={unread}
    >
      {children}
    </AppShell>
  );
}
