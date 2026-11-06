"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import {
  doneNavigation,
  isNavigating,
  isTrackedNavigation,
  startNavigation,
  subscribeNavigation,
} from "@/lib/navigation-progress";

/**
 * The top progress bar (QDIT-35): proof that a click registered.
 *
 * Starts on the click itself — a document listener, so every in-app link
 * counts without each one opting in — and ends when the URL the router renders
 * changes. It does not try to measure progress, which the router does not
 * report; it says "working", which is the part that was missing.
 *
 * Shown after a short delay, so a prefetched, instant navigation does not
 * flash it. The delay is a timer-free CSS transition delay, and under Reduce
 * Motion the bar is a static full-width line instead of a sliding one — the
 * cue survives, only the movement goes.
 */
export function NavigationProgress() {
  const pending = useSyncExternalStore(subscribeNavigation, isNavigating, () => false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  // The new route rendered: the URL the router reports has changed.
  useEffect(() => {
    doneNavigation();
  }, [pathname, search]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (isTrackedNavigation(event, anchor, window.location)) startNavigation();
    }
    // Back and forward restore a page the router already has, or fetch it;
    // either way the URL change above clears the bar. Popstate alone with no
    // change (a hash) should not leave it on.
    function onPopState() {
      doneNavigation();
    }

    // Capture phase, ahead of React's handlers. `next/link` calls
    // `preventDefault()` on every client navigation it takes over, so by the
    // bubble phase each of them looks cancelled and the bar never starts. The
    // cost is that a Link whose own onClick cancels the click would show the
    // bar until the timeout. Nothing in the app does that today.
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  // Busy cursor app-wide while it is on: the pointer is where the eye is.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-navigating", pending);
  }, [pending]);

  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      aria-hidden={!pending}
      data-state={pending ? "loading" : "idle"}
      className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
    >
      <span className="nav-progress-bar block h-full bg-primary" />
    </div>
  );
}
