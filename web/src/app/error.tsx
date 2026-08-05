"use client";

import { ErrorState } from "@/components/error-state";

/**
 * The root boundary: the landing page, the login route, and — the case that
 * actually matters — anything thrown by `(app)/layout.tsx` while it renders.
 *
 * That layout awaits `getUser()` and `listProjectOptions()` before the shell
 * exists. `error.tsx` does not wrap the layout in its own segment, so a throw
 * there passes straight over `(app)/error.tsx` and arrives here. There is no
 * sidebar to preserve at this point, so this renders standalone.
 */
export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-6">
      <ErrorState
        error={error}
        retry={unstable_retry}
        title="Something went wrong"
        description="The page could not be loaded. Signing in again clears this up more often than not."
        className="w-full"
      />
    </main>
  );
}
