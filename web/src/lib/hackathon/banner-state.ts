/**
 * What the site-wide hackathon banner shows (WP-4.7).
 *
 * Pure and clock-injected so the browser can decide from its own clock: the
 * landing page is cached (ISR), and a cached "opens Nov 14" must still turn
 * into "in progress" the moment the window opens, and vanish when it closes.
 */

/** The public facts the banner needs. Nothing graded or staff-only. */
export type HackathonBannerData = {
  slug: string;
  name: string;
  opensAt: string;
  closesAt: string;
};

export type BannerState = "upcoming" | "live";

/** How far ahead of `opensAt` the "opens on…" banner starts showing. */
export const UPCOMING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Event dates read in the event's own timezone, like the hackathon page. */
export const BANNER_TIMEZONE = "Asia/Manila";

/**
 * Rehearsal hackathons (QDIT-51): a slug starting `test-` is never in the
 * banner, and only its staff and teams see it on the Hackathons index. Anyone
 * with the link can still open it, which is how a tester submits.
 */
export const TEST_SLUG_PREFIX = "test-";

export function isTestHackathon(slug: string): boolean {
  return slug.startsWith(TEST_SLUG_PREFIX);
}

/**
 * Unlisted: hidden by an operator or admin (QDIT-56), or a `test-` rehearsal.
 * Kept out of the banner and, for anyone but its staff and teams, the index.
 */
export function isUnlistedHackathon(h: { slug: string; hidden?: boolean | null }): boolean {
  return h.hidden === true || isTestHackathon(h.slug);
}

/**
 * `live` while submissions are open, `upcoming` in the two weeks before, and
 * null otherwise (closed, too far out, or unreadable times). The window end is
 * exclusive, matching the database (`clock_timestamp() < closes_at`).
 */
export function bannerState(h: HackathonBannerData, nowMs: number): BannerState | null {
  const opens = Date.parse(h.opensAt);
  const closes = Date.parse(h.closesAt);
  if (!Number.isFinite(opens) || !Number.isFinite(closes) || !Number.isFinite(nowMs)) return null;
  if (nowMs >= closes) return null;
  if (nowMs >= opens) return "live";
  if (opens - nowMs <= UPCOMING_WINDOW_MS) return "upcoming";
  return null;
}

/** "Nov 14", in the event's timezone. */
export function bannerOpensLabel(opensAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: BANNER_TIMEZONE,
  }).format(new Date(opensAt));
}

/** localStorage key: dismissing the "opens on…" banner doesn't hide the live one. */
export function bannerDismissKey(slug: string, state: BannerState): string {
  return `qdit.hackathon-banner.${slug}.${state}`;
}
