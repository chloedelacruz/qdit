"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  countdownTarget,
  formatCountdown,
  windowState,
  type HackathonWindow,
} from "@/lib/hackathon/window";

/**
 * Time left in the submission window, on the server's clock.
 *
 * The page renders `serverNowMs`, the server's time at render. The browser
 * keeps the gap between that and its own clock and adds it on every tick, so a
 * laptop that is five minutes fast still shows the real deadline. The first
 * render uses `serverNowMs` exactly, so server and client markup match.
 *
 * When the target passes, the page is refreshed: the badge, the button and
 * the late-pass state all come from the server, not from this component.
 */
export function Countdown({
  event,
  serverNowMs,
  latePassUntil,
}: {
  event: HackathonWindow;
  serverNowMs: number;
  latePassUntil: string | null;
}) {
  const router = useRouter();
  const [nowMs, setNowMs] = useState(serverNowMs);
  const skew = useRef<number | null>(null);

  useEffect(() => {
    skew.current = serverNowMs - Date.now();
    const tick = () => setNowMs(Date.now() + (skew.current ?? 0));
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [serverNowMs]);

  const target = countdownTarget(event, nowMs, latePassUntil);
  const remaining = target ? Date.parse(target.at) - nowMs : 0;

  // The state the server rendered, and the one the clock is in now. When they
  // part, the server's view is stale: refresh once per state.
  const state = windowState(event, nowMs, latePassUntil);
  const rendered = useRef(windowState(event, serverNowMs, latePassUntil));
  useEffect(() => {
    if (state !== rendered.current) {
      rendered.current = state;
      router.refresh();
    }
  }, [state, router]);

  if (!target) return null;

  return (
    <p className="flex items-baseline gap-2 text-sm">
      <span className="text-muted-foreground">{target.label}</span>
      <span role="timer" className="font-mono text-base font-semibold tabular-nums">
        {formatCountdown(remaining)}
      </span>
    </p>
  );
}
