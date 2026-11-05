import { PageSkeleton } from "@/components/page-skeleton";

/**
 * The fallback for every page in the app that has no closer one (QDIT-35) —
 * Settings and Wallet had none at all.
 *
 * A `loading.tsx` is what lets Next prefetch a dynamic route's shell and swap
 * to it the instant a link is clicked; without one, the click waits for the
 * whole server render and shows nothing, which reads as "it didn't register".
 * Nearer `loading.tsx` files still win for the routes that have them.
 */
export default function Loading() {
  return <PageSkeleton className="mx-auto max-w-4xl" />;
}
