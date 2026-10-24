import { describe, expect, it } from "vitest";
import { buildCustomRoute } from "next/dist/lib/build-custom-route";

import nextConfig from "../../next.config";

/**
 * D-33: every qdit response refuses to be framed. The rule lives in
 * next.config.ts; this pins both what it sends and where it applies.
 *
 * "Where" is checked by compiling each source the way `next build` does for
 * routes-manifest.json (buildCustomRoute is what writes the `regex` there),
 * so a source that silently misses `/` or a nested path fails here instead of
 * in a browser.
 */

const PATHS = [
  "/",
  "/login",
  "/register",
  "/oauth/consent",
  "/oauth/consent/anything",
  "/settings",
  "/projects/some-slug/milestones/abc",
  "/p/some-slug/abc",
  "/api/v1/projects",
  "/api/v1/milestones/0e9d4c3b-2a1f-4e5d-8c7b-6a5f4e3d2c1b",
  "/auth/callback",
  "/_next/static/chunks/main.js",
];

async function headersFor(path: string): Promise<Map<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const sent = new Map<string, string>();
  for (const rule of rules) {
    const { regex } = buildCustomRoute("header", rule);
    if (!new RegExp(regex).test(path)) continue;
    for (const { key, value } of rule.headers) sent.set(key.toLowerCase(), value);
  }
  return sent;
}

describe("next.config headers (D-33)", () => {
  it.each(PATHS)("%s cannot be framed", async (path) => {
    const sent = await headersFor(path);
    expect(sent.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(sent.get("x-frame-options")).toBe("DENY");
  });

  it("is one app-wide rule, not a list of routes", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules.map((r) => r.source)).toEqual(["/:path*"]);
  });
});
