import { describe, expect, it } from "vitest";

import { docUrlHost } from "./plan-docs";

describe("docUrlHost", () => {
  it("names the host a doc link opens", () => {
    expect(docUrlHost("https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f")).toBe(
      "www.doqtri.xyz",
    );
  });

  it("keeps a port, and drops credentials, path, query and fragment", () => {
    expect(docUrlHost("https://user:pw@plans.example.com:8443/d/1?v=2#h3")).toBe(
      "plans.example.com:8443",
    );
  });

  it("shows a look-alike internationalised host in punycode", () => {
    // U+043E is the Cyrillic small o.
    expect(docUrlHost("https://d\u043eqtri.xyz/d/1")).toBe("xn--dqtri-jye.xyz");
  });

  it("returns an empty string for something that is not a URL", () => {
    expect(docUrlHost("not a url")).toBe("");
  });
});
