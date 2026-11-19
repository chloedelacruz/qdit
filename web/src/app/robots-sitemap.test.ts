import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import robots from "./robots";
import sitemap from "./sitemap";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://qdit.app"));
afterEach(() => vi.unstubAllEnvs());

describe("robots.txt", () => {
  it("points crawlers at the sitemap and keeps them out of the API and the signed-in app", () => {
    const { rules, sitemap: map } = robots();
    expect(map).toBe("https://qdit.app/sitemap.xml");
    const disallow = ([] as string[]).concat((Array.isArray(rules) ? rules[0] : rules).disallow ?? []);
    for (const path of ["/api/", "/dashboard", "/proofs", "/settings"]) expect(disallow).toContain(path);
    // The public pages stay crawlable.
    for (const path of ["/verify", "/user-guide", "/docs", "/p/"]) expect(disallow).not.toContain(path);
  });
});

describe("sitemap.xml", () => {
  it("lists only public pages, as absolute URLs", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://qdit.app/");
    expect(urls).toContain("https://qdit.app/verify");
    expect(urls.some((url) => url.includes("/dashboard") || url.includes("/proofs"))).toBe(false);
  });
});
