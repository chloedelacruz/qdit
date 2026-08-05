import Link from "next/link";

import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";

/**
 * In-app 404, rendered inside the shell so the sidebar stays put.
 *
 * This has real traffic rather than hypothetical traffic: `notFound()` is
 * called by the project layout and all five pages under it whenever a slug does
 * not resolve.
 *
 * Which is why the copy names both possibilities. Reads go through RLS, so a
 * project you are not a member of returns no rows — indistinguishable, from
 * here, from one that was never created. Saying only "does not exist" would be
 * a confident lie to anyone who simply has not been added to the project yet,
 * and that is now a fixable problem: an admin can add them from the project's
 * Members page.
 */
export default function AppNotFound() {
  return (
    <EmptyState
      icon={ICON.missing}
      title="Not found"
      description="This page does not exist — or it belongs to a project you are not a member of. If you are expecting access, ask a project admin to add you."
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button asChild size="sm">
            <Link href="/projects">Browse projects</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      }
    />
  );
}
