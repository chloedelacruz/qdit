"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  bannerDismissKey,
  bannerOpensLabel,
  bannerState,
  type BannerState,
  type HackathonBannerData,
} from "@/lib/hackathon/banner-state";
import { ICON } from "@/lib/icons";

/** Fired in this tab on dismiss; `storage` covers the other tabs. */
const DISMISS_EVENT = "qdit:hackathon-banner-dismissed";

function subscribeDismissals(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(DISMISS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DISMISS_EVENT, onChange);
  };
}

function readDismissed(key: string | null): boolean {
  if (!key) return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    // Storage blocked (private mode): the banner just stays.
    return false;
  }
}

/**
 * Site-wide promo strip for a hackathon that is open or about to open (WP-4.7).
 *
 * The accent here is a state signal (spec §Accent Application): a tinted fill
 * and a 2px brand rail say "something is live", the way an active nav item
 * does. The link is foreground at rest and brand on hover. It scrolls away
 * with the page rather than sitting in the sticky header, and a visitor can
 * dismiss it; dismissing "opens on…" does not hide "in progress".
 */
export function HackathonBanner({ hackathon }: { hackathon: HackathonBannerData | null }) {
  const pathname = usePathname();
  const [now, setNow] = useState(() => Date.now());

  // Re-check every 30 s so the strip flips to "in progress" and disappears at
  // close without a reload.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const state: BannerState | null = hackathon ? bannerState(hackathon, now) : null;
  const key = hackathon && state ? bannerDismissKey(hackathon.slug, state) : null;
  // Server snapshot: not dismissed, so the server always renders the strip.
  const dismissed = useSyncExternalStore(
    subscribeDismissals,
    () => readDismissed(key),
    () => false,
  );

  // Set from the click itself, so a dismiss works even when storage is blocked.
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);

  if (!hackathon || !state || dismissed || (key !== null && hiddenKey === key)) return null;
  // Already on the hackathon's own pages: the banner would point at itself.
  if (pathname?.startsWith(`/hackathons/${hackathon.slug}`)) return null;

  // Live: straight into the submit dialog (it only opens for someone who can submit).
  const href = `/hackathons/${hackathon.slug}${state === "live" ? "?submit=1" : ""}`;

  function dismiss() {
    if (!key) return;
    setHiddenKey(key);
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Storage blocked: hidden for this page view only.
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }

  return (
    <div
      role="region"
      aria-label="Hackathon announcement"
      className="bg-primary/8 relative border-b before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary"
    >
      <div className="flex min-h-10 items-center gap-3 py-2 pr-2 pl-4 text-sm lg:pl-6">
        <span className="relative flex size-2 shrink-0" aria-hidden="true">
          {state === "live" ? (
            <span className="absolute inline-flex size-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
          ) : null}
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        <p className="min-w-0 flex-1 text-foreground">
          {state === "live" ? (
            <>
              <span className="font-semibold">{hackathon.name}</span> in progress!{" "}
            </>
          ) : (
            <>
              <span className="font-semibold">{hackathon.name}</span> opens {bannerOpensLabel(hackathon.opensAt)}.{" "}
            </>
          )}
          <Link
            href={href}
            className="transition-qdit focus-ring inline-flex items-center gap-0.5 rounded-sm font-medium underline underline-offset-4 hover:text-primary"
          >
            {state === "live" ? "Submit your projects here" : "Get your team ready"}
            <ICON.chevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss hackathon announcement"
          className="transition-qdit focus-ring grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent/45 hover:text-foreground"
        >
          <ICON.close className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
