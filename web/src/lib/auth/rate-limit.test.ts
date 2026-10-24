import { afterEach, describe, expect, it, vi } from "vitest";

import { rateLimit, takeFromWindow, takeFromWindows } from "./rate-limit";

const small = { limit: 2, windowMs: 1_000 };
const large = { limit: 5, windowMs: 10_000 };

let n = 0;
const key = (label: string) => `test:${label}:${++n}`;

afterEach(() => {
  vi.useRealTimers();
});

describe("takeFromWindow", () => {
  it("allows up to the limit, then refuses until the window resets", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const k = key("single");

    expect(rateLimit(k, small)).toBe(true);
    expect(rateLimit(k, small)).toBe(true);
    const refused = takeFromWindow(k, small);
    expect(refused).toMatchObject({ allowed: false, firstRefusal: true });
    expect(refused.allowed === false && refused.retryAfterMs).toBeLessThanOrEqual(1_000);

    vi.setSystemTime(Date.now() + 1_000);
    expect(rateLimit(k, small)).toBe(true);
  });
});

describe("takeFromWindows", () => {
  it("charges a refused call to no window", () => {
    const user = key("user");
    const client = key("client");
    const both = [
      { key: user, limit: small },
      { key: client, limit: large },
    ];

    expect(takeFromWindows(both).allowed).toBe(true);
    expect(takeFromWindows(both).allowed).toBe(true);
    // The user window is full; these must not reach the client window.
    for (let i = 0; i < 10; i++) expect(takeFromWindows(both).allowed).toBe(false);

    // Client window has used 2 of 5: three more calls from other users fit.
    for (let i = 0; i < 3; i++) {
      expect(takeFromWindows([{ key: key("other"), limit: small }, { key: client, limit: large }]).allowed).toBe(true);
    }
    expect(takeFromWindows([{ key: key("other"), limit: small }, { key: client, limit: large }]).allowed).toBe(false);
  });

  it("does not charge the user window when the client window refuses", () => {
    const client = key("client");
    for (let i = 0; i < large.limit; i++) takeFromWindow(client, large);

    const user = key("user");
    for (let i = 0; i < 10; i++) {
      expect(takeFromWindows([{ key: user, limit: small }, { key: client, limit: large }]).allowed).toBe(false);
    }
    // The user's own window was never opened.
    expect(takeFromWindow(user, small).allowed).toBe(true);
    expect(takeFromWindow(user, small).allowed).toBe(true);
  });

  it("waits for the latest-resetting refusing window and flags only the first refusal", () => {
    const a = key("a");
    const b = key("b");
    const checks = [
      { key: a, limit: { limit: 1, windowMs: 1_000 } },
      { key: b, limit: { limit: 1, windowMs: 30_000 } },
    ];
    takeFromWindows(checks);

    const first = takeFromWindows(checks);
    const second = takeFromWindows(checks);

    expect(first).toMatchObject({ allowed: false, firstRefusal: true });
    expect(first.allowed === false && first.retryAfterMs).toBeGreaterThan(1_000);
    expect(second).toMatchObject({ allowed: false, firstRefusal: false });
  });
});
