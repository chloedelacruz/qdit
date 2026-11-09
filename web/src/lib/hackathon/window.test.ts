import { describe, expect, it } from "vitest";

import {
  canSubmitIn,
  countdownTarget,
  formatCountdown,
  formatManila,
  stateBadge,
  windowState,
} from "./window";

const EVENT = {
  opensAt: "2026-11-20T06:00:00.000Z",
  closesAt: "2026-11-20T06:05:00.000Z",
  releasedAt: null,
};
const at = (iso: string) => Date.parse(iso);

describe("windowState", () => {
  it("is not open before opens_at", () => {
    expect(windowState(EVENT, at("2026-11-20T05:59:59.999Z"))).toBe("not_open");
  });

  it("is open from opens_at to closes_at inclusive", () => {
    expect(windowState(EVENT, at(EVENT.opensAt))).toBe("open");
    expect(windowState(EVENT, at(EVENT.closesAt))).toBe("open");
  });

  it("is closed after closes_at", () => {
    expect(windowState(EVENT, at("2026-11-20T06:05:00.001Z"))).toBe("closed");
  });

  it("is late while a late pass is in force, and closed after it", () => {
    const until = "2026-11-20T06:10:00.000Z";
    expect(windowState(EVENT, at("2026-11-20T06:07:00.000Z"), until)).toBe("late");
    expect(windowState(EVENT, at("2026-11-20T06:10:00.001Z"), until)).toBe("closed");
  });

  it("never opens early on a late pass", () => {
    expect(windowState(EVENT, at("2026-11-20T05:00:00.000Z"), "2026-11-20T07:00:00.000Z")).toBe("not_open");
  });

  it("is closed for everyone once released", () => {
    const released = { ...EVENT, releasedAt: "2026-11-20T06:30:00.000Z" };
    expect(windowState(released, at("2026-11-20T06:31:00.000Z"), "2026-11-20T07:00:00.000Z")).toBe("closed");
  });

  it("lets a project submit only when open or late", () => {
    expect(["not_open", "open", "late", "closed"].map((s) => canSubmitIn(s as never))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

describe("stateBadge", () => {
  it("names each state", () => {
    expect(stateBadge("not_open").label).toBe("Not open yet");
    expect(stateBadge("open").label).toBe("Open");
    expect(stateBadge("closed").label).toBe("Closed");
    expect(stateBadge("late", "2026-11-20T06:10:00.000Z").label).toBe("Closed – late pass until 2:10 PM");
  });
});

describe("countdownTarget", () => {
  it("counts to the opening, then to the close, then to the pass", () => {
    const until = "2026-11-20T06:10:00.000Z";
    expect(countdownTarget(EVENT, at("2026-11-20T05:00:00.000Z"))?.label).toBe("Opens in");
    expect(countdownTarget(EVENT, at("2026-11-20T06:01:00.000Z"))).toEqual({
      at: EVENT.closesAt,
      label: "Closes in",
    });
    expect(countdownTarget(EVENT, at("2026-11-20T06:07:00.000Z"), until)).toEqual({
      at: until,
      label: "Late pass ends in",
    });
    expect(countdownTarget(EVENT, at("2026-11-20T06:11:00.000Z"), until)).toBeNull();
  });
});

describe("formatCountdown", () => {
  it.each([
    [0, "00:00"],
    [-5_000, "00:00"],
    [4 * 60_000 + 59_000, "04:59"],
    [999, "00:01"],
    [3 * 3_600_000 + 4 * 60_000 + 5_000, "03:04:05"],
    [86_400_000 + 2 * 3_600_000 + 3 * 60_000 + 4_000, "1d 02:03:04"],
  ])("%i ms reads %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

describe("formatManila", () => {
  it("shows the time in Asia/Manila (UTC+8) and says so", () => {
    expect(formatManila("2026-11-20T06:00:00.000Z")).toBe("Nov 20, 2026, 2:00 PM Manila time");
  });
});
