"use client";

import { useEffect, useRef, useState } from "react";

import { ICON } from "@/lib/icons";
import type { SiteStats } from "@/lib/site-stats";
import { NETWORK_LABELS } from "@/lib/stellar";

/** How often an open, visible landing page refreshes its numbers. */
const POLL_MS = 30_000;
/** How long a number takes to count up to a new value. */
const COUNT_MS = 1100;

const fmt = new Intl.NumberFormat("en-US");
/** Fees are fractions of an XLM; four significant digits keep them readable. */
const fmtXlm = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });
const whole = (n: number) => fmt.format(Math.round(n));

/** Where the average fee was measured, in words. */
function feeNote(fee: NonNullable<SiteStats["fee"]>): string {
  const network = NETWORK_LABELS[fee.network].toLowerCase();
  return fee.sample === 1
    ? `Measured from the latest qdit anchor on ${network}`
    : `Measured from the last ${fee.sample} qdit anchors on ${network}`;
}

/**
 * Counts from the last shown value to `value` with an ease-out, so a fresh
 * load or a poll that brings new sign-ups visibly ticks up. Screen readers get
 * the final number only; reduced-motion users get it straight away.
 */
function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / COUNT_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = origin + (value - origin) * eased;
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

/**
 * Live sign-ups, projects, tasks and what an anchor really costs. Polls
 * /api/stats while the tab is visible and refreshes as soon as it comes back.
 * Renders nothing until the first read lands, so a failed read never shows
 * zeros as if they were real.
 */
export function LiveStats() {
  const [stats, setStats] = useState<SiteStats | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/stats");
        if (res.ok && alive) setStats((await res.json()) as SiteStats);
      } catch {
        // Keep the last numbers on a network blip; the next poll retries.
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  if (!stats) return null;

  const items: {
    icon: (typeof ICON)[keyof typeof ICON];
    label: string;
    value: number;
    format: (n: number) => string;
    unit?: string;
    note?: string;
  }[] = [
    { icon: ICON.members, label: "Sign-ups", value: stats.users, format: whole },
    { icon: ICON.project, label: "Projects created", value: stats.projects, format: whole },
    { icon: ICON.task, label: "Tasks created", value: stats.tasks, format: whole },
    ...(stats.fee
      ? [
          {
            icon: ICON.anchor,
            label: "Avg. fee per transaction",
            value: stats.fee.avgXlm,
            format: (n: number) => fmtXlm.format(n),
            unit: "XLM",
            note: feeNote(stats.fee),
          },
        ]
      : []),
  ];

  return (
    <section aria-labelledby="live-stats-title" className="mx-auto w-full max-w-6xl px-6 pb-14">
      <p
        id="live-stats-title"
        className="flex items-center gap-2 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase"
      >
        <span className="size-1.5 rounded-full bg-success" aria-hidden />
        Live on qdit
      </p>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ icon: Icon, label, value, format, unit, note }) => {
          return (
            <div key={label} className="surface flex flex-col rounded-xl border border-border p-5">
              {/* Icon inline with its label at 14px, never in a tinted tile
                  above it (spec §Iconography). */}
              <dt className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Icon className="size-3.5" aria-hidden />
                {label}
              </dt>
              <dd className="mt-3">
                <span className="text-[2rem] leading-none font-semibold tracking-tight tabular-nums">
                  <CountUp value={value} format={format} />
                  {unit ? (
                    <span className="ml-1.5 text-base font-medium text-muted-foreground">{unit}</span>
                  ) : null}
                </span>
                {note ? <span className="mt-2 block text-xs text-muted-foreground">{note}</span> : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
