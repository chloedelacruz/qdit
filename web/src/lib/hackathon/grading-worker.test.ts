import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClaimedJob } from "@/lib/hackathon/grading-store";
import {
  completedRun,
  describeError,
  LEASE_SECONDS,
  MAX_CONCURRENT_JOBS,
  MIN_START_MS,
  retryAfterSeconds,
  runGradingFor,
  runSweep,
  type WorkerDeps,
  type WorkerLogEvent,
} from "@/lib/hackathon/grading-worker";
import { GraderRefusalError } from "@/lib/hackathon/grader";
import { InvalidAiRunError, parseAiRun } from "@/lib/hackathon/rubric";
import { aiRun, FakeStore, fakeClient, message, qditSnapshot, type FakeClient, type Responder } from "@/test/hackathon-fixtures";

const START = Date.parse("2026-11-21T17:01:00.000Z");

let clock: { now: number };
let store: FakeStore;
let events: WorkerLogEvent[];

function deps(client: FakeClient): WorkerDeps {
  return { store, client, now: () => clock.now, log: (e) => events.push(e), model: "claude-sonnet-5-5" };
}

function sweep(client: FakeClient) {
  return runSweep({ budgetMs: 240_000 }, deps(client));
}

beforeEach(() => {
  clock = { now: START };
  store = new FakeStore(clock);
  events = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

const refusal: Responder = () =>
  message("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } } as never);

describe("runSweep", () => {
  it("grades every due job and stores the code's total, clamped scores and no extra flags", async () => {
    store.addVersion("v1");
    const client = fakeClient(() => message(aiRun({ clarity: 12, structure: -1 }, ["manipulation"])));

    const counts = await sweep(client);

    expect(counts).toMatchObject({ claimed: 2, graded: 2, failed: 0, retrying: 0, third_runs_queued: 0 });
    expect(client.calls).toHaveLength(2);
    expect(store.runs).toHaveLength(2);
    const stored = store.runs[0].run;
    expect(stored.criteria.clarity.score).toBe(10);
    expect(stored.criteria.structure.score).toBe(0);
    // (10 + 0 + 7 + 7 + 7) / 10 × 20
    expect(stored.total).toBe(62);
    expect(stored.flags).toEqual(["manipulation"]);
    expect(stored.truncated).toBe(false);
    expect(stored.model).toBe("claude-sonnet-5-5");
    expect(store.jobs.every((j) => j.status === "done")).toBe(true);
  });

  it("respects the lease cap: never more than 20 claimed or in flight, 200 s leases", async () => {
    for (let i = 0; i < 15; i++) store.addVersion(`v${i}`);
    const client = fakeClient();

    const counts = await sweep(client);

    expect(counts.graded).toBe(30);
    expect(client.maxInFlight).toBeLessThanOrEqual(MAX_CONCURRENT_JOBS);
    expect(client.maxInFlight).toBe(20);
    for (const args of store.claimArgs) {
      expect(args.limit).toBeLessThanOrEqual(20);
      expect(args.leaseSeconds).toBe(LEASE_SECONDS);
    }
    expect(LEASE_SECONDS).toBe(200);
  });

  it("takes only the free slots when other workers already run jobs", async () => {
    for (let i = 0; i < 10; i++) store.addVersion(`busy${i}`);
    for (const j of store.jobs) j.status = "running"; // 20 held elsewhere
    store.addVersion("v1");
    const client = fakeClient();

    const counts = await sweep(client);

    expect(counts.claimed).toBe(0);
    expect(client.calls).toHaveLength(0);
  });

  it("claims nothing once less than MIN_START_MS of the budget is left", async () => {
    store.addVersion("v1");
    const client = fakeClient();
    const counts = await runSweep({ budgetMs: MIN_START_MS - 1 }, deps(client));
    expect(counts.claimed).toBe(0);
    expect(store.claimArgs).toHaveLength(0);
  });

  describe("retries", () => {
    it("backs off 30 s then 60 s, and the third failure fails the job", async () => {
      store.addVersion("v1", {}, [1]);
      const client = fakeClient(() => {
        throw new Anthropic.InternalServerError(500, undefined, "boom", new Headers());
      });

      expect(await sweep(client)).toMatchObject({ retrying: 1, failed: 0 });
      // Not due yet: the backoff holds it.
      clock.now += 29_000;
      expect(await sweep(client)).toMatchObject({ claimed: 0 });
      clock.now += 1_000;
      expect(await sweep(client)).toMatchObject({ retrying: 1, failed: 0 });
      clock.now += 60_000;
      expect(await sweep(client)).toMatchObject({ retrying: 0, failed: 1 });
      clock.now += 3_600_000;
      expect(await sweep(client)).toMatchObject({ claimed: 0 });

      expect(store.failures.map((f) => f.retryAfterSeconds)).toEqual([30, 60, 60]);
      expect(store.failures.map((f) => f.error)).toEqual([
        "model API error 500",
        "model API error 500",
        "model API error 500",
      ]);
      const job = store.job("v1", 1);
      expect(job.status).toBe("failed");
      expect(job.attempts).toBe(3);
      expect(client.calls).toHaveLength(3);
      expect(store.runs).toHaveLength(0);
    });

    it("retries a mindmap that could not be read", async () => {
      store.addVersion("v1", {}, [1]);
      store.imageError = new Error("storage down");
      const client = fakeClient();
      expect(await sweep(client)).toMatchObject({ retrying: 1 });
      expect(client.calls).toHaveLength(0);
      expect(store.failures[0].error).toBe("Error");
    });

    it("fails a refusal", async () => {
      store.addVersion("v1", {}, [1]);
      store.job("v1", 1).attempts = 2;
      const client = fakeClient(refusal);

      expect(await sweep(client)).toMatchObject({ failed: 1, graded: 0 });
      expect(store.job("v1", 1).status).toBe("failed");
      expect(store.failures[0].error).toBe("refusal (cyber)");
      expect(store.runs).toHaveLength(0);
    });

    it("fails malformed JSON and a missing criterion (InvalidAiRunError)", async () => {
      const missing = aiRun();
      delete (missing.criteria as Partial<typeof missing.criteria>).accuracy;
      store.addVersion("bad-json", {}, [1]);
      store.addVersion("missing", {}, [1]);
      store.job("bad-json", 1).attempts = 2;
      store.job("missing", 1).attempts = 2;
      const client = fakeClient((body) => {
        const text = JSON.stringify(body.messages);
        return text.includes("Team bad-json") ? message("{ not json") : message(missing);
      });

      expect(await sweep(client)).toMatchObject({ failed: 2, graded: 0 });
      const errors = store.failures.map((f) => f.error).sort();
      expect(errors).toEqual([
        "invalid model output: criteria.accuracy is missing",
        "invalid model output: output is not valid JSON",
      ]);
      expect(store.runs).toHaveLength(0);
    });

    it("aborts a model call at the end of the job's lease", async () => {
      store.addVersion("v1", {}, [1]);
      const short = store.claimJobs.bind(store);
      vi.spyOn(store, "claimJobs").mockImplementation(async (args) =>
        (await short(args)).map((job: ClaimedJob) => ({ ...job, leaseUntil: new Date(clock.now + 5_000).toISOString() })),
      );
      const client = fakeClient(
        (_body, _call, options) =>
          new Promise((_, reject) => {
            const abort = () => reject(new Anthropic.APIUserAbortError());
            if (options?.signal?.aborted) abort();
            else options?.signal?.addEventListener("abort", abort);
          }),
      );

      expect(await sweep(client)).toMatchObject({ retrying: 1 });
      expect(store.failures[0].error).toBe("model call aborted: out of time");
    });
  });

  describe("superseded jobs", () => {
    it("skips a job superseded after the claim without calling the model", async () => {
      store.addVersion("v1", {}, [1]);
      const claim = store.claimJobs.bind(store);
      vi.spyOn(store, "claimJobs").mockImplementation(async (args) => {
        const jobs = await claim(args);
        for (const j of store.jobs) j.status = "superseded"; // a resubmit landed
        return jobs;
      });
      const client = fakeClient();

      expect(await sweep(client)).toMatchObject({ superseded: 1, graded: 0 });
      expect(client.calls).toHaveLength(0);
      expect(store.runs).toHaveLength(0);
    });

    it("records nothing when the job is superseded during the model call", async () => {
      store.addVersion("v1", {}, [1]);
      const client = fakeClient(() => {
        store.job("v1", 1).status = "superseded";
        return message(aiRun());
      });

      expect(await sweep(client)).toMatchObject({ superseded: 1, graded: 0 });
      expect(store.runs).toHaveLength(0);
    });

    it("does not grade a version that is no longer current", async () => {
      store.addVersion("v1", { current: false }, [1]);
      const client = fakeClient();
      expect(await sweep(client)).toMatchObject({ superseded: 1 });
      expect(client.calls).toHaveLength(0);
    });
  });

  describe("third run", () => {
    it("queues exactly one third run when two runs disagree, then settles", async () => {
      store.addVersion("v1");
      const client = fakeClient((_b, call) =>
        message(call === 1 ? aiRun({ clarity: 2, structure: 2, accuracy: 2, connections: 2, execution: 2 }) : aiRun({ clarity: 9, structure: 9, accuracy: 9, connections: 9, execution: 9 })),
      );

      const counts = await sweep(client);

      expect(counts).toMatchObject({ graded: 3, third_runs_queued: 1 });
      expect(store.thirdRunCalls).toEqual(["v1"]);
      expect(store.runs.map((r) => r.runNo)).toEqual([1, 2, 3]);

      // A later sweep does not queue another.
      await sweep(client);
      expect(store.thirdRunCalls).toEqual(["v1"]);
    });

    it("does not queue a third run when the runs agree", async () => {
      store.addVersion("v1");
      const counts = await sweep(fakeClient());
      expect(counts.third_runs_queued).toBe(0);
      expect(store.thirdRunCalls).toEqual([]);
      expect(store.jobs).toHaveLength(2);
    });

    it("waits until no run of the version is open", async () => {
      store.addVersion("v1");
      store.job("v1", 2).nextAttemptAt = clock.now + 600_000; // run 2 not due yet
      const client = fakeClient(() => message(aiRun({ clarity: 0 })));
      await sweep(client);
      expect(store.thirdRunCalls).toEqual([]);
    });
  });

  describe("eligibility", () => {
    it("does not call the model for an ineligible version, and stores the gate once", async () => {
      store.addVersion("v1", { doqtri: null });
      const client = fakeClient();

      const counts = await sweep(client);

      expect(counts).toMatchObject({ ineligible: 2, graded: 0 });
      expect(client.calls).toHaveLength(0);
      expect(store.eligibilityWrites).toEqual(["v1"]);
      const stored = store.versions.get("v1")!.eligibility!;
      expect(stored.eligible).toBe(false);
      expect(stored.rules.find((r) => r.id === "notes_during_event")?.passed).toBe(false);
      for (const j of store.jobs) {
        expect(j.status).toBe("done");
        expect(j.lastError).toMatch(/^not graded: ineligible \(.*notes_during_event.*\)$/);
      }
      expect(store.runs).toHaveLength(0);
    });

    it("grades an ineligible version an admin overrode to eligible", async () => {
      store.addVersion("v1", { doqtri: null, override: true });
      const counts = await sweep(fakeClient());
      expect(counts.graded).toBe(2);
    });

    it("does not grade an eligible version an admin overrode to ineligible", async () => {
      store.addVersion("v1", { override: false });
      const client = fakeClient();
      expect(await sweep(client)).toMatchObject({ ineligible: 2 });
      expect(client.calls).toHaveLength(0);
      expect(store.jobs[0].lastError).toBe("not graded: ineligible by admin override");
    });

    it("reuses a stored gate result instead of writing it again", async () => {
      store.addVersion("v1", { eligibility: { eligible: true, rules: [] } });
      await sweep(fakeClient());
      expect(store.eligibilityWrites).toEqual([]);
    });
  });

  it("sets truncated_input from the code when the input was cut", async () => {
    store.addVersion("v1", { qdit: qditSnapshot({ truncated: true }) }, [1]);
    await sweep(fakeClient(() => message(aiRun({}, ["placeholder"]))));
    expect(store.runs[0].run.flags).toEqual(["placeholder", "truncated_input"]);
    expect(store.runs[0].run.truncated).toBe(true);
  });

  it("reads each version's images once for all its runs", async () => {
    store.addVersion("v1", { imagePaths: ["a.png", "b.png", "c.webp", "d.png"] });
    const client = fakeClient();
    await sweep(client);
    expect(store.imageReads).toEqual(["a.png", "b.png", "c.webp"]);
  });
});

describe("logging", () => {
  it("never logs scores, evidence, summaries, flags or team text", async () => {
    store.addVersion("v1");
    store.addVersion("v2", { doqtri: null }, [1]);
    store.addVersion("v3", {}, [1]);
    store.job("v3", 1).attempts = 2;
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = fakeClient((body, call) => {
      if (JSON.stringify(body.messages).includes("Team v3")) return refusal(body, call, undefined);
      return message(call === 1 ? aiRun({ clarity: 1 }, ["manipulation"]) : aiRun({ clarity: 9 }, ["manipulation"]));
    });

    // Once with the default logger (console), once capturing events.
    await runSweep({}, { store, client, now: () => clock.now, model: "claude-sonnet-5-5" });
    store.addVersion("v4");
    await sweep(client);

    const printed = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls].map((c) => c.join(" ")).join("\n");
    const captured = JSON.stringify(events);
    for (const text of [printed, captured]) {
      expect(text).not.toContain("EVIDENCE-SECRET");
      expect(text).not.toContain("SUMMARY-SECRET");
      expect(text).not.toContain("manipulation");
      expect(text).not.toContain("Team v");
      expect(text).not.toMatch(/score|total|evidence|summary|criteria|flags/i);
    }
    expect(printed).toContain('"event":"grading_job"');

    const allowed = new Set([
      "event",
      "version_id",
      "run_no",
      "status",
      "ms",
      "claimed",
      "graded",
      "ineligible",
      "superseded",
      "retrying",
      "failed",
      "errors",
      "third_runs_queued",
    ]);
    for (const event of events) for (const key of Object.keys(event)) expect(allowed).toContain(key);
  });
});

describe("runGradingFor", () => {
  it("claims only that version's jobs", async () => {
    store.addVersion("v1");
    store.addVersion("v2");
    const client = fakeClient();

    const counts = await runGradingFor("v1", deps(client));

    expect(counts).toMatchObject({ graded: 2 });
    expect(store.claimArgs.every((a) => a.versionId === "v1")).toBe(true);
    expect(store.jobs.filter((j) => j.versionId === "v2").every((j) => j.status === "pending")).toBe(true);
  });

  it("returns null without configuration", async () => {
    expect(await runGradingFor("v1", null)).toBeNull();
  });
});

describe("helpers", () => {
  it("backoff schedule", () => {
    expect([1, 2, 3].map(retryAfterSeconds)).toEqual([30, 60, 60]);
  });

  it("describes errors without content", () => {
    expect(describeError(new GraderRefusalError(null))).toBe("refusal");
    expect(describeError(new InvalidAiRunError(["summary is not a string"]))).toBe(
      "invalid model output: summary is not a string",
    );
    expect(describeError(new Error("team text here"))).toBe("Error");
    expect(describeError("x")).toBe("unknown error");
  });

  it("completedRun drops model-set code flags", () => {
    const run = parseAiRun(aiRun({}, ["disagreement", "truncated_input", "off_topic"]));
    const stored = completedRun(run, {
      model: "m",
      stopReason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      truncated: false,
    });
    expect(stored.flags).toEqual(["off_topic"]);
  });
});
