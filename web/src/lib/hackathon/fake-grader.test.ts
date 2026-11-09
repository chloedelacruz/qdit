import { describe, expect, it } from "vitest";

import {
  createFakeGraderClient,
  FAKE_GRADER_MODEL,
  fakeDelayRange,
  fakeGraderEnabled,
  fakeScores,
} from "@/lib/hackathon/fake-grader";
import { gradeOnce, graderClientFromEnv } from "@/lib/hackathon/grader";
import type { GradingRequest } from "@/lib/hackathon/prompt";

const request = (text: string) =>
  ({ system: [], messages: [{ role: "user", content: text }] }) as unknown as GradingRequest;

describe("fakeGraderEnabled", () => {
  it("is on only for HACKATHON_GRADER_FAKE=1 outside production", () => {
    expect(fakeGraderEnabled({ HACKATHON_GRADER_FAKE: "1", NODE_ENV: "development" })).toBe(true);
    expect(fakeGraderEnabled({ HACKATHON_GRADER_FAKE: "1", NODE_ENV: "test" })).toBe(true);
    expect(fakeGraderEnabled({ HACKATHON_GRADER_FAKE: "1", NODE_ENV: "production" })).toBe(false);
    expect(fakeGraderEnabled({ HACKATHON_GRADER_FAKE: "true", NODE_ENV: "development" })).toBe(false);
    expect(fakeGraderEnabled({ NODE_ENV: "development" })).toBe(false);
  });
});

describe("graderClientFromEnv", () => {
  it("never fakes in production, and needs the key there", () => {
    expect(graderClientFromEnv({ HACKATHON_GRADER_FAKE: "1", NODE_ENV: "production" })).toBeNull();
    expect(graderClientFromEnv({ NODE_ENV: "production", ANTHROPIC_API_KEY: "sk-ant-test" })).not.toBeNull();
    expect(graderClientFromEnv({ NODE_ENV: "development" })).toBeNull();
  });

  it("gives the fake without a key when the flag is on", () => {
    expect(graderClientFromEnv({ HACKATHON_GRADER_FAKE: "1", NODE_ENV: "development" })).not.toBeNull();
  });
});

describe("fakeDelayRange", () => {
  it("reads min-max or one number, else the default", () => {
    expect(fakeDelayRange("10-20")).toEqual([10, 20]);
    expect(fakeDelayRange("5")).toEqual([5, 5]);
    expect(fakeDelayRange(undefined)).toEqual([1000, 3000]);
    expect(fakeDelayRange("20-10")).toEqual([1000, 3000]);
    expect(fakeDelayRange("abc")).toEqual([1000, 3000]);
  });
});

describe("the fake client", () => {
  it("answers through gradeOnce like a model, with stable in-range scores", async () => {
    const client = createFakeGraderClient({ delayMs: [0, 0] });
    const a = await gradeOnce(client, request("team a"));
    const again = await gradeOnce(client, request("team a"));

    expect(a.model).toBe(FAKE_GRADER_MODEL);
    expect(a.stop_reason).toBe("end_turn");
    expect(a.run.criteria).toEqual(again.run.criteria);
    for (const { score } of Object.values(a.run.criteria)) {
      expect(score).toBeGreaterThanOrEqual(3);
      expect(score).toBeLessThanOrEqual(9);
    }
    expect(a.run.flags).toEqual([]);
  });

  it("spreads different requests", () => {
    const totals = new Set(
      Array.from({ length: 20 }, (_, i) => Object.values(fakeScores(`team ${i}`)).reduce((s, x) => s + x, 0)),
    );
    expect(totals.size).toBeGreaterThan(3);
  });

  it("rejects when the worker aborts the call", async () => {
    const client = createFakeGraderClient({ delayMs: [10_000, 10_000] });
    const controller = new AbortController();
    const call = gradeOnce(client, request("slow"), { signal: controller.signal });
    controller.abort();
    await expect(call).rejects.toThrow();
  });
});
