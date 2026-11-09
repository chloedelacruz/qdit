import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { REQUEST_PATH_HEADER, requestPathOf, signInRedirect, withRequestPath } from "./request-path";

/**
 * A signed-out visitor comes back to the page they asked for (QDIT-47): the
 * proxy forwards the path, the (app) layout turns it into /login?next=.
 */
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
}));
vi.mock("@/lib/supabase/env", () => ({
  getSupabaseUrl: () => "http://127.0.0.1:54321",
  getSupabasePublishableKey: () => "sb_publishable_test",
}));

const { updateSession } = await import("@/lib/supabase/proxy");

describe("requestPathOf", () => {
  it("keeps the path and query", () => {
    expect(requestPathOf(new URL("https://qdit.test/hackathons/bootcamp-nov"))).toBe("/hackathons/bootcamp-nov");
    expect(requestPathOf(new URL("https://qdit.test/tasks?status=todo&q=a%20b"))).toBe("/tasks?status=todo&q=a+b");
  });

  it("drops Next's _rsc parameter from client navigations", () => {
    expect(requestPathOf(new URL("https://qdit.test/hackathons/bootcamp-nov?_rsc=1x2y"))).toBe(
      "/hackathons/bootcamp-nov",
    );
    expect(requestPathOf(new URL("https://qdit.test/tasks?_rsc=1&status=done"))).toBe("/tasks?status=done");
  });
});

describe("withRequestPath", () => {
  it("replaces a value the client sent", () => {
    const sent = new Headers({ [REQUEST_PATH_HEADER]: "https://evil.example/", cookie: "a=b" });
    const forwarded = withRequestPath(sent, new URL("https://qdit.test/hackathons/x"));
    expect(forwarded.get(REQUEST_PATH_HEADER)).toBe("/hackathons/x");
    expect(forwarded.get("cookie")).toBe("a=b");
    expect(sent.get(REQUEST_PATH_HEADER)).toBe("https://evil.example/");
  });
});

describe("signInRedirect", () => {
  it("carries the page as next", () => {
    expect(signInRedirect("/hackathons/bootcamp-nov")).toBe("/login?next=%2Fhackathons%2Fbootcamp-nov");
    expect(signInRedirect("/tasks?status=todo")).toBe("/login?next=%2Ftasks%3Fstatus%3Dtodo");
  });

  it.each([
    null,
    "",
    "/dashboard",
    "https://evil.example/hackathons",
    "//evil.example",
    "/\\evil.example",
    "hackathons/x",
  ])("falls back to a bare /login for %j", (path) => {
    expect(signInRedirect(path)).toBe("/login");
  });
});

describe("updateSession forwards the requested path", () => {
  it("sets the header on the request the layout sees, over any the client sent", async () => {
    const request = new NextRequest("https://qdit.test/hackathons/bootcamp-nov?_rsc=abc", {
      headers: { [REQUEST_PATH_HEADER]: "//evil.example" },
    });

    const response = await updateSession(request);

    // How Next passes overridden request headers on to the route.
    expect(response.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe("/hackathons/bootcamp-nov");
    expect(response.headers.get("x-middleware-override-headers")).toContain(REQUEST_PATH_HEADER);
  });
});
