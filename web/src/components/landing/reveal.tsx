"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Scroll reveal for the landing page's bands.
 *
 * Reveals **once**, on the way in, and never again — a section that replays
 * every time you scroll past it reads as a toy, which is the opposite of what
 * the spec asks a marketing surface for this app to read as.
 *
 * The hidden state lives in `.reveal` (globals.css) so it is present in the
 * server-rendered HTML rather than applied after hydration; nothing flashes in
 * and then out. `prefers-reduced-motion` unhides everything unconditionally,
 * and so does the <noscript> rule on the page, so the copy never depends on
 * this component running.
 *
 * ## Why a sweep and not an IntersectionObserver
 *
 * The obvious implementation observes each element and reveals it on
 * intersection. It has a failure mode that is invisible in normal use and
 * total when it hits: a fast scroll, a jump to the footer, or a restored
 * scroll position can carry an element from below the viewport to above it
 * inside a single sample. Intersection never changes from 0, no callback
 * fires, and that band stays at opacity 0 for the rest of the session — laid
 * out, hit-testable and blank.
 *
 * So the condition is not "is it intersecting" but "has its top reached the
 * fold", which is still true after you have scrolled past it. One rAF-throttled
 * sweep serves every instance and unhooks itself once nothing is left pending.
 */

const pending = new Set<HTMLElement>();
let frame = 0;

function sweep() {
  frame = 0;

  // A little short of the true fold, so a band starts moving as it arrives
  // rather than only once it is fully on screen.
  const fold = window.innerHeight * 0.92;

  for (const el of pending) {
    if (el.getBoundingClientRect().top >= fold) continue;
    el.setAttribute("data-shown", "true");
    pending.delete(el);
  }

  if (pending.size === 0) {
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
  }
}

function schedule() {
  if (frame) return;
  frame = requestAnimationFrame(sweep);
}

export function Reveal({
  delay = 0,
  className,
  children,
}: {
  /** Milliseconds. Stagger siblings by 60–90ms; past ~300ms it reads as a wait. */
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    pending.add(el);

    // Identical (type, listener, options) triples are deduplicated by the
    // platform, so every instance can register and only one pair is ever added.
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    schedule();

    return () => {
      pending.delete(el);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn("reveal", className)}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
