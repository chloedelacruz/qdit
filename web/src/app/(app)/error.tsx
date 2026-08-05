"use client";

import { ErrorState } from "@/components/error-state";

/**
 * Every signed-in route.
 *
 * `error.tsx` wraps its segment's pages and nested layouts but *not* the layout
 * beside it, so this renders inside the app shell — the sidebar, the project
 * switcher and the user menu all survive, and only the page body is replaced.
 * That is the whole reason it sits here rather than at the root: a failed read
 * on one page should not look like the app falling over.
 *
 * `(app)/layout.tsx` itself is the exception. It calls `getUser()` and
 * `listProjectOptions()` during render, and a throw there is above this
 * boundary — that one lands in `src/app/error.tsx`.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <ErrorState error={error} retry={unstable_retry} />;
}
