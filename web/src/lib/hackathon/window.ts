import type { Tone } from "@/lib/constants";

/**
 * The submission window as a participant sees it (WP-4.7, QDIT-47).
 *
 * Mirrors `hackathon_window_state()` in 20261110100000_hackathons.sql, which
 * is the rule that actually decides: nothing is open after release, nothing
 * before `opens_at`, `closes_at` is inclusive, and a late pass in force keeps a
 * closed hackathon open for its one project. `late` is the last case seen from
 * this page: closed for everyone, still open for a project the caller is on.
 *
 * Pure so the page, the countdown and the tests compute the same answer.
 */

export type WindowState = "not_open" | "open" | "late" | "closed";

export type HackathonWindow = {
  opensAt: string;
  closesAt: string;
  /** Set once the organisers close the event for good; after that nothing is open. */
  releasedAt: string | null;
};

/** Every time on this page is shown in the event's own zone. */
export const EVENT_TIME_ZONE = "Asia/Manila";

export function windowState(
  event: HackathonWindow,
  nowMs: number,
  latePassUntil: string | null = null,
): WindowState {
  if (event.releasedAt !== null) return "closed";
  if (nowMs < Date.parse(event.opensAt)) return "not_open";
  if (nowMs <= Date.parse(event.closesAt)) return "open";
  if (latePassUntil !== null && nowMs <= Date.parse(latePassUntil)) return "late";
  return "closed";
}

/** Whether a project in this state may submit right now. */
export function canSubmitIn(state: WindowState): boolean {
  return state === "open" || state === "late";
}

const MANILA = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const MANILA_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** "Nov 9, 2026, 2:00 PM Manila time". */
export function formatManila(iso: string): string {
  return `${MANILA.format(new Date(iso))} Manila time`;
}

/** "2:05 PM", for a time on a day already named. */
export function formatManilaTime(iso: string): string {
  return MANILA_TIME.format(new Date(iso));
}

/** The badge beside the hackathon's name. */
export function stateBadge(
  state: WindowState,
  latePassUntil: string | null = null,
): { label: string; tone: Tone } {
  switch (state) {
    case "not_open":
      return { label: "Not open yet", tone: "neutral" };
    case "open":
      return { label: "Open", tone: "success" };
    case "late":
      return {
        label: latePassUntil
          ? `Closed – late pass until ${formatManilaTime(latePassUntil)}`
          : "Closed – late pass",
        tone: "warning",
      };
    case "closed":
      return { label: "Closed", tone: "neutral" };
  }
}

/**
 * The instant the countdown runs to, and what it is counting to. Null when
 * there is nothing left to count.
 */
export function countdownTarget(
  event: HackathonWindow,
  nowMs: number,
  latePassUntil: string | null = null,
): { at: string; label: string } | null {
  switch (windowState(event, nowMs, latePassUntil)) {
    case "not_open":
      return { at: event.opensAt, label: "Opens in" };
    case "open":
      return { at: event.closesAt, label: "Closes in" };
    case "late":
      return latePassUntil ? { at: latePassUntil, label: "Late pass ends in" } : null;
    case "closed":
      return null;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "1d 02:03:04", "02:03:04" or "03:04". Never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}
