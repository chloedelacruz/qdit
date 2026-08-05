import Link from "next/link";

import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";

/**
 * 404 for anything outside the signed-in shell — a mistyped URL, a stale link.
 *
 * In-app misses are caught closer, by `(app)/not-found.tsx`, which keeps the
 * sidebar. This one has no shell to keep, so it centres itself and points at
 * the dashboard, which will bounce to `/login` if the visitor is not signed in.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-6">
      <EmptyState
        icon={ICON.missing}
        title="Page not found"
        description="That link does not lead anywhere. It may have been moved, or it may never have existed."
        action={
          <Button asChild size="sm">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        }
      />
    </main>
  );
}
