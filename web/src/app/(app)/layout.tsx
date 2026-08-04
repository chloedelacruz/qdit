import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { listProjectOptions } from "@/lib/queries";
import { getUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  /**
   * Both requests are issued together rather than one after the other. They do
   * not depend on each other — RLS scopes the project list to whoever the
   * request is authenticated as, so it returns nothing for a signed-out caller
   * and the redirect below still fires. Awaiting them in sequence added a whole
   * round trip to every navigation in the app.
   */
  const [user, projects] = await Promise.all([getUser(), listProjectOptions()]);

  // The gate for every authenticated route. RLS is the real enforcement — this
  // just avoids rendering an app shell full of empty lists to a signed-out
  // visitor, which reads as "broken" rather than "sign in".
  if (!user) redirect("/login");

  return (
    <AppShell projects={projects} email={user.email ?? ""}>
      {children}
    </AppShell>
  );
}
