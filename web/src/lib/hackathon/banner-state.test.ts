import { describe, expect, it } from "vitest";

import {
  UPCOMING_WINDOW_MS,
  bannerDismissKey,
  bannerOpensLabel,
  bannerState,
  type HackathonBannerData,
} from "./banner-state";

const H: HackathonBannerData = {
  slug: "san-beda-hackathon",
  name: "San Beda University Hackathon",
  opensAt: "2026-11-14T00:00:00+08:00",
  closesAt: "2026-11-15T00:00:00+08:00",
};
const OPENS = Date.parse(H.opensAt);
const CLOSES = Date.parse(H.closesAt);

describe("bannerState", () => {
  it.each([
    ["more than two weeks before", OPENS - UPCOMING_WINDOW_MS - 1, null],
    ["exactly two weeks before", OPENS - UPCOMING_WINDOW_MS, "upcoming"],
    ["a minute before opening", OPENS - 60_000, "upcoming"],
    ["at the opening instant", OPENS, "live"],
    ["mid-event", OPENS + 3_600_000, "live"],
    ["one ms before close", CLOSES - 1, "live"],
    ["at the closing instant (exclusive end)", CLOSES, null],
    ["after close", CLOSES + 1, null],
  ] as const)("%s", (_label, now, expected) => {
    expect(bannerState(H, now)).toBe(expected);
  });

  it("hides on unreadable times", () => {
    expect(bannerState({ ...H, opensAt: "nope" }, OPENS)).toBeNull();
    expect(bannerState({ ...H, closesAt: "" }, OPENS)).toBeNull();
    expect(bannerState(H, Number.NaN)).toBeNull();
  });
});

describe("labels and keys", () => {
  it("reads the opening date in Manila time", () => {
    // 2026-11-13T16:00Z is already 14 Nov in Manila.
    expect(bannerOpensLabel(H.opensAt)).toBe("Nov 14");
  });

  it("keeps a dismissed 'upcoming' separate from 'live'", () => {
    expect(bannerDismissKey(H.slug, "upcoming")).not.toBe(bannerDismissKey(H.slug, "live"));
  });
});
