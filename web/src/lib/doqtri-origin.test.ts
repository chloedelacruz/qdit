import { describe, expect, it } from "vitest";

import { DEFAULT_DOQTRI_ORIGIN, doqtriOrigin, isDoqtriDocUrl } from "./doqtri-origin";

describe("doqtriOrigin", () => {
  it("defaults to https://www.doqtri.xyz when unset or empty", () => {
    expect(doqtriOrigin(undefined)).toBe(DEFAULT_DOQTRI_ORIGIN);
    expect(doqtriOrigin("")).toBe("https://www.doqtri.xyz");
    expect(doqtriOrigin("   ")).toBe("https://www.doqtri.xyz");
  });

  it("reads an https origin, forgiving a trailing slash and upper case", () => {
    expect(doqtriOrigin("https://staging.doqtri.xyz")).toBe("https://staging.doqtri.xyz");
    expect(doqtriOrigin("https://staging.doqtri.xyz/")).toBe("https://staging.doqtri.xyz");
    expect(doqtriOrigin("https://Plans.Example.com:8443")).toBe("https://plans.example.com:8443");
  });

  it.each([
    "http://www.doqtri.xyz",
    "https://www.doqtri.xyz/d",
    "https://www.doqtri.xyz?x=1",
    "https://user@www.doqtri.xyz",
    "www.doqtri.xyz",
    "not a url",
  ])("throws on %j, which is not an https origin", (value) => {
    expect(() => doqtriOrigin(value)).toThrow(/DOQTRI_ORIGIN/);
  });
});

describe("isDoqtriDocUrl", () => {
  const origin = "https://www.doqtri.xyz";

  it.each([
    "https://www.doqtri.xyz",
    "https://www.doqtri.xyz/",
    "https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
    "https://www.doqtri.xyz/d/1?v=2#h3",
    "https://www.doqtri.xyz?doc=1",
    "https://www.doqtri.xyz#top",
  ])("accepts %j", (url) => {
    expect(isDoqtriDocUrl(url, origin)).toBe(true);
  });

  it.each([
    // Same leading characters, another site.
    "https://www.doqtri.xyz.evil.example/d/1",
    "https://www.doqtri.xyz@evil.example/d/1",
    "https://www.doqtri.xyzz/d/1",
    "https://www.doqtri.xyz:8443/d/1",
    // doqtri, but not as doqtri writes its URLs.
    "https://www.doqtri.xyz:443/d/1",
    "HTTPS://WWW.DOQTRI.XYZ/d/1",
    "https://doqtri.xyz/d/1",
    "http://www.doqtri.xyz/d/1",
    // Characters a doqtri URL never holds.
    "https://www.doqtri.xyz/d/1 2",
    "https://www.doqtri.xyz/d/1\n",
    "https://www.doqtri.xyz\\@evil.example/",
    "https://www.doqtri.xyz/\\evil.example",
    // Not on the origin at all.
    "https://evil.example/https://www.doqtri.xyz/d/1",
    "https://dоqtri.xyz/d/1",
    "javascript:alert(1)",
    "",
  ])("refuses %j", (url) => {
    expect(isDoqtriDocUrl(url, origin)).toBe(false);
  });

  it("follows the origin it is given", () => {
    expect(isDoqtriDocUrl("https://staging.doqtri.xyz/d/1", "https://staging.doqtri.xyz")).toBe(true);
    expect(isDoqtriDocUrl("https://www.doqtri.xyz/d/1", "https://staging.doqtri.xyz")).toBe(false);
  });
});
