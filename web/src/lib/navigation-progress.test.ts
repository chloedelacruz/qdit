import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NAVIGATION_TIMEOUT_MS,
  doneNavigation,
  isNavigating,
  isTrackedNavigation,
  startNavigation,
  startNavigationTo,
  subscribeNavigation,
} from "@/lib/navigation-progress";

/**
 * The "a click registered" bit (QDIT-35).
 *
 * The store must start on a click, clear when the route renders, and never be
 * left on — a progress bar stuck after a navigation that silently did nothing
 * is its own kind of "the app looks broken". `isTrackedNavigation` decides
 * which clicks count, and the cases it refuses are the ones that would never
 * clear: new tabs, downloads, other origins and the page already showing.
 */

const here = { origin: "https://qdit.app", pathname: "/dashboard", search: "" };
const click = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};
const anchor = (href: string, extra: { target?: string; download?: boolean } = {}) => ({
  href: new URL(href, here.origin).href,
  target: extra.target ?? "",
  hasAttribute: (name: string) => name === "download" && Boolean(extra.download),
});

beforeEach(() => {
  vi.useFakeTimers();
  doneNavigation();
});

afterEach(() => {
  doneNavigation();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("navigation store", () => {
  it("starts, notifies once, and clears", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNavigation(listener);

    startNavigation();
    startNavigation();
    expect(isNavigating()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    doneNavigation();
    expect(isNavigating()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    startNavigation();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("gives up after the timeout so nothing looks busy forever", () => {
    startNavigation();
    vi.advanceTimersByTime(NAVIGATION_TIMEOUT_MS - 1);
    expect(isNavigating()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isNavigating()).toBe(false);
  });

  it("restarts the timeout on a second click", () => {
    startNavigation();
    vi.advanceTimersByTime(NAVIGATION_TIMEOUT_MS - 100);
    startNavigation();
    vi.advanceTimersByTime(200);
    expect(isNavigating()).toBe(true);
  });

  it("starts for a code navigation only when the URL changes", () => {
    vi.stubGlobal("window", {
      location: { ...here, href: `${here.origin}${here.pathname}` },
    });

    startNavigationTo("/dashboard");
    expect(isNavigating()).toBe(false);

    startNavigationTo("/settings");
    expect(isNavigating()).toBe(true);
  });
});

describe("isTrackedNavigation", () => {
  it("tracks a plain left click to another page in the app", () => {
    expect(isTrackedNavigation(click, anchor("/settings"), here)).toBe(true);
    expect(isTrackedNavigation(click, anchor("/dashboard?status=open"), here)).toBe(true);
  });

  it("ignores clicks that open elsewhere or were handled", () => {
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(isTrackedNavigation({ ...click, [modifier]: true }, anchor("/settings"), here)).toBe(false);
    }
    expect(isTrackedNavigation({ ...click, button: 1 }, anchor("/settings"), here)).toBe(false);
    expect(isTrackedNavigation({ ...click, defaultPrevented: true }, anchor("/settings"), here)).toBe(false);
    expect(isTrackedNavigation(click, anchor("/settings", { target: "_blank" }), here)).toBe(false);
  });

  it("ignores downloads, route handlers and other origins", () => {
    expect(isTrackedNavigation(click, anchor("/api/export/anchors?project=x"), here)).toBe(false);
    expect(isTrackedNavigation(click, anchor("/p/x/y", { download: true }), here)).toBe(false);
    expect(isTrackedNavigation(click, anchor("https://stellar.expert/tx/abc"), here)).toBe(false);
  });

  it("ignores the page already showing, and hash-only changes", () => {
    expect(isTrackedNavigation(click, anchor("/dashboard"), here)).toBe(false);
    expect(isTrackedNavigation(click, anchor("/dashboard#panel"), here)).toBe(false);
  });

  it("counts a hash link to another page", () => {
    expect(isTrackedNavigation(click, anchor("/projects/x#chain"), here)).toBe(true);
  });
});
