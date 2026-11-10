import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The promo strip (WP-4.7), rendered to markup: live copy and link while the
 * window is open, "opens on…" before, nothing after close or on the
 * hackathon's own pages.
 */
let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { HackathonBanner } = await import("./hackathon-banner");

const H = {
  slug: "san-beda-hackathon",
  name: "San Beda University Hackathon",
  opensAt: "2026-11-14T00:00:00+08:00",
  closesAt: "2026-11-15T00:00:00+08:00",
};
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const html = (hackathon: typeof H | null) => renderToStaticMarkup(createElement(HackathonBanner, { hackathon }));

afterEach(() => {
  vi.useRealTimers();
  pathname = "/dashboard";
});

describe("HackathonBanner", () => {
  it("shows the live call to action during the window", () => {
    vi.useFakeTimers();
    at("2026-11-14T10:00:00+08:00");
    const out = html(H);
    expect(out).toContain("San Beda University Hackathon");
    expect(out).toContain("in progress!");
    expect(out).toContain("Submit your projects here");
    expect(out).toContain('href="/hackathons/san-beda-hackathon"');
    expect(out).toContain('aria-label="Dismiss hackathon announcement"');
  });

  it("shows the opening date before the window", () => {
    vi.useFakeTimers();
    at("2026-11-10T10:00:00+08:00");
    const out = html(H);
    expect(out).toContain("opens Nov 14");
    expect(out).toContain("Get your team ready");
    expect(out).not.toContain("in progress");
  });

  it("renders nothing after close, with no hackathon, or on the hackathon's pages", () => {
    vi.useFakeTimers();
    at("2026-11-15T00:00:00+08:00");
    expect(html(H)).toBe("");
    expect(html(null)).toBe("");
    at("2026-11-14T10:00:00+08:00");
    pathname = "/hackathons/san-beda-hackathon/admin";
    expect(html(H)).toBe("");
  });

  it("escapes the hackathon name", () => {
    vi.useFakeTimers();
    at("2026-11-14T10:00:00+08:00");
    expect(html({ ...H, name: "<img src=x onerror=alert(1)>" })).not.toContain("<img");
  });
});
