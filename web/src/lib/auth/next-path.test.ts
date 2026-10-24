import { describe, expect, it } from "vitest";

import { DEFAULT_NEXT_PATH, loginPath, registerPath, safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("keeps same-origin paths with their query and hash", () => {
    expect(safeNextPath("/projects")).toBe("/projects");
    expect(safeNextPath("/oauth/consent?authorization_id=abc123")).toBe(
      "/oauth/consent?authorization_id=abc123",
    );
    expect(safeNextPath("/projects/x/milestones#m1")).toBe("/projects/x/milestones#m1");
  });

  it("returns the resolved path, not the input", () => {
    expect(safeNextPath("/a/../settings")).toBe("/settings");
    expect(safeNextPath("/a/./b")).toBe("/a/b");
  });

  it("falls back for anything that is not a string", () => {
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(null)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(["/a", "/b"])).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(42)).toBe(DEFAULT_NEXT_PATH);
  });

  it("falls back for empty, relative and absolute values", () => {
    expect(safeNextPath("")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("dashboard")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("../etc")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("https://evil.example/")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("javascript:alert(1)")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("data:text/html,hi")).toBe(DEFAULT_NEXT_PATH);
  });

  it("refuses every way of naming another host from a leading slash", () => {
    for (const value of [
      "//evil.example",
      "//evil.example/oauth/consent",
      "/\\evil.example",
      "/\\/evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r\n/evil.example",
      "/\u0000/evil.example",
      "///evil.example",
    ]) {
      expect(safeNextPath(value), JSON.stringify(value)).toBe(DEFAULT_NEXT_PATH);
    }
  });

  it("keeps encoded slashes encoded rather than decoding them into a host", () => {
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
  });

  it("refuses oversized values", () => {
    expect(safeNextPath(`/${"a".repeat(5000)}`)).toBe(DEFAULT_NEXT_PATH);
  });

  it("uses the caller's fallback", () => {
    expect(safeNextPath("//evil.example", "/projects")).toBe("/projects");
  });
});

describe("loginPath", () => {
  it("carries a safe next", () => {
    expect(loginPath("/oauth/consent?authorization_id=abc")).toBe(
      "/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc",
    );
  });

  it("drops next when it would only say the default, or is unsafe", () => {
    expect(loginPath("/dashboard")).toBe("/login");
    expect(loginPath("//evil.example")).toBe("/login");
  });
});

describe("registerPath", () => {
  it("carries a safe next and drops an unsafe one", () => {
    expect(registerPath("/oauth/consent?authorization_id=abc")).toBe(
      "/register?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc",
    );
    expect(registerPath("/\\evil.example")).toBe("/register");
  });
});
