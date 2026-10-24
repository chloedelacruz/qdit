import { describe, expect, it } from "vitest";

import { MAX_ATTEMPTS, nextAttemptAt, RETRY_DELAYS_MS, retryDelayMs } from "./backoff";

const MIN = 60_000;
const HOUR = 60 * MIN;
const middle = () => 0.5;

describe("retry schedule (contract section 9)", () => {
  it("is 1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h after attempts 1 to 7", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => retryDelayMs(n, middle))).toEqual([
      1 * MIN,
      5 * MIN,
      15 * MIN,
      1 * HOUR,
      3 * HOUR,
      6 * HOUR,
      12 * HOUR,
    ]);
  });

  it("allows 8 attempts, about 22 h end to end", () => {
    expect(MAX_ATTEMPTS).toBe(8);
    expect(RETRY_DELAYS_MS).toHaveLength(MAX_ATTEMPTS - 1);
    const total = RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
    expect(total / HOUR).toBeCloseTo(22.35, 2);
  });

  it("is dead after the 8th failure", () => {
    expect(retryDelayMs(8, middle)).toBeNull();
    expect(nextAttemptAt(8, new Date(), middle)).toBeNull();
  });

  it("jitters each delay within +/-10%", () => {
    for (let n = 1; n < MAX_ATTEMPTS; n++) {
      const base = RETRY_DELAYS_MS[n - 1];
      expect(retryDelayMs(n, () => 0)).toBe(Math.round(base * 0.9));
      const high = retryDelayMs(n, () => 0.999999)!;
      expect(high).toBeLessThanOrEqual(Math.round(base * 1.1));
      expect(high).toBeGreaterThan(Math.round(base * 1.0999));
    }
  });

  it("spreads retries: different random draws give different times", () => {
    expect(retryDelayMs(1, () => 0.1)).not.toBe(retryDelayMs(1, () => 0.9));
  });

  it("counts from now", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    expect(nextAttemptAt(1, now, middle)?.toISOString()).toBe("2026-10-24T12:01:00.000Z");
    expect(nextAttemptAt(7, now, middle)?.toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });

  it("refuses an attempt count that is not a positive integer", () => {
    expect(() => retryDelayMs(0)).toThrow();
    expect(() => retryDelayMs(1.5)).toThrow();
  });
});
