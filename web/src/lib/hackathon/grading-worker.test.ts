import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChainUnavailableError } from "@/lib/hackathon/chain-facts";
import type { ClaimedJob, VersionProgress } from "@/lib/hackathon/grading-store";
import { GradingStoreError, toErrorCode } from "@/lib/hackathon/grading-store";
import {
  CHAIN_RETRY_SECONDS,
  completedRun,
  describeError,
  GradingAbortError,
  ineligibleReason,
  NOT_CURRENT_REASON,
  jittered,
  LEASE_SECONDS,
  MAX_CONCURRENT_JOBS,
  MIN_START_MS,
  planFailure,
  providerRetryAfter,
  retryAfterSeconds,
  runGradingFor,
  runSweep,
  versionGrade,
  type WorkerDeps,
  type WorkerLogEvent,
} from "@/lib/hackathon/grading-worker";
import { GraderError, GraderRefusalError, GraderTruncatedError } from "@/lib/hackathon/grader";
import { InvalidAiRunError, parseAiRun } from "@/lib/hackathon/rubric";
import { ELIGIBILITY_RULE_IDS } from "@/lib/hackathon/types";
import {
  aiRun,
  anchoredChain,
  FakeStore,
  fakeClient,
  message,
  qditSnapshot,
  type FakeClient,
  type Responder,
} from "@/test/hackathon-fixtures";

const START = Date.parse("2026-11-21T17:01:00.000Z");

let clock: { now: number };
let store: FakeStore;
let events: WorkerLogEvent[];
let random: number;

function deps(client: FakeClient): WorkerDeps {
  return {
    store,
    client,
    now: () => clock.now,
    random: () => random,
    log: (e) => events.push(e),
    model: "claude-sonnet-5-5",
    readChain: async ({ doqtri }) => anchoredChain(doqtri),
  };
}

function sweep(client: FakeClient) {
  return runSweep({ budgetMs: 240_000 }, deps(client));
}

beforeEach(() => {
  clock = { now: START };
  store = new FakeStore(clock);
  events = [];
  random = 0.5; // no jitter
});

afterEach(() => {
  vi.restoreAllMocks();
});

const refusal: Responder = () =>
  message("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } } as never);

const low = { clarity: 2, structure: 2, accuracy: 2, connections: 2, execution: 2 };
const high = { clarity: 9, structure: 9, accuracy: 9, connections: 9, execution: 9 };

function apiError(status: number, headers: Record<string, string> = {}, type?: string) {
  return Anthropic.APIError.generate(
    status,
    type ? { type: "error", error: { type, message: "x" } } : undefined,
    "x",
    new Headers(headers),
  );
}

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
    expect(store.jobs.every((j) => j.status === "done")).toBe(true);
  });

  it("respects the lease cap: never more than 20 claimed or in flight, 200 s leases", async () => {
    for (let i = 0; i < 15; i++) store.addVersion(`v${i}`);
    const client = fakeClient();

    const counts = await sweep(client);

    expect(counts.graded).toBe(30);
    expect(client.maxInFlight).toBe(MAX_CONCURRENT_JOBS);
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

    expect(await sweep(client)).toMatchObject({ claimed: 0 });
    expect(client.calls).toHaveLength(0);
  });

  it("claims nothing once less than MIN_START_MS of the budget is left", async () => {
    store.addVersion("v1");
    const counts = await runSweep({ budgetMs: MIN_START_MS - 1 }, deps(fakeClient()));
    expect(counts.claimed).toBe(0);
    expect(store.claimArgs).toHaveLength(0);
  });

  it("passes the claim's attempt to every write, so a re-leased job records nothing", async () => {
    store.addVersion("v1", {}, [1]);
    const client = fakeClient(() => {
      // The lease ran out and another worker claimed the job again.
      store.job("v1", 1).attempts += 1;
      return message(aiRun());
    });
    expect(await sweep(client)).toMatchObject({ superseded: 1, graded: 0 });
    expect(store.runs).toHaveLength(0);
  });

  describe("counted retries", () => {
    it("backs off 30 s then 60 s, and the third failure fails the job", async () => {
      store.addVersion("v1", {}, [1]);
      const client = fakeClient(() => {
        throw apiError(500);
      });

      expect(await sweep(client)).toMatchObject({ retrying: 1, failed: 0 });
      clock.now += 29_000;
      expect(await sweep(client)).toMatchObject({ claimed: 0 });
      clock.now += 1_000;
      expect(await sweep(client)).toMatchObject({ retrying: 1, failed: 0 });
      clock.now += 60_000;
      expect(await sweep(client)).toMatchObject({ retrying: 0, failed: 1 });
      clock.now += 3_600_000;
      expect(await sweep(client)).toMatchObject({ claimed: 0 });

      expect(store.failures.map((f) => [f.retryAfterSeconds, f.countAttempt, f.permanent])).toEqual([
        [30, true, false],
        [60, true, false],
        [60, true, false],
      ]);
      expect(store.failures.every((f) => f.error === "provider:500")).toBe(true);
      expect(store.job("v1", 1)).toMatchObject({ status: "failed", attempts: 3 });
      expect(client.calls).toHaveLength(3);
    });

    it("jitters every delay by ±30%", () => {
      const error = apiError(500);
      expect(planFailure(error, 1, 0, START).retryAfterSeconds).toBe(21);
      expect(planFailure(error, 1, 0.999_999, START).retryAfterSeconds).toBe(39);
      expect(planFailure(error, 2, 0, START).retryAfterSeconds).toBe(42);
      expect(planFailure(error, 2, 0.999_999, START).retryAfterSeconds).toBe(78);
      expect(jittered(0, 0.9)).toBe(0);
    });

    it("counts a lease abort as an attempt", async () => {
      store.addVersion("v1", {}, [1]);
      const claim = store.claimJobs.bind(store);
      vi.spyOn(store, "claimJobs").mockImplementation(async (args) =>
        (await claim(args)).map((job: ClaimedJob) => ({ ...job, leaseUntil: new Date(clock.now + 5_000).toISOString() })),
      );
      const client = fakeClient(hangUntilAborted);

      expect(await sweep(client)).toMatchObject({ retrying: 1 });
      expect(store.failures[0]).toMatchObject({ error: "aborted:lease", countAttempt: true });
    });
  });

  describe("uncounted retries", () => {
    it("gives back the attempt on a 429 and honours retry-after (jitter only adds)", async () => {
      store.addVersion("v1", {}, [1]);
      random = 0;
      const client = fakeClient(() => {
        throw apiError(429, { "retry-after": "45" }, "rate_limit_error");
      });

      expect(await sweep(client)).toMatchObject({ retrying: 1 });
      expect(store.failures[0]).toMatchObject({ countAttempt: false, permanent: false, retryAfterSeconds: 45 });
      expect(store.job("v1", 1)).toMatchObject({ attempts: 1, freeAttempts: 1, status: "pending" });

      random = 0.999_999;
      clock.now += 45_000;
      await sweep(client);
      expect(store.failures[1].retryAfterSeconds).toBe(59); // ceil(45 × 1.3)
    });

    it("gives back the attempt on 529 and overloaded_error, 30 s ±30% without a header", () => {
      for (const error of [apiError(529), apiError(500, {}, "overloaded_error")]) {
        const plan = planFailure(error, 2, 0.5, START);
        expect(plan).toMatchObject({ countAttempt: false, permanent: false, retryAfterSeconds: 30 });
        expect(plan.error).toMatch(/^provider:5(29|00)$/);
      }
    });

    it("never fails a job for overload, however often", async () => {
      store.addVersion("v1", {}, [1]);
      const client = fakeClient(() => {
        throw apiError(529);
      });
      for (let i = 0; i < 6; i++) {
        await sweep(client);
        clock.now += 60_000;
      }
      expect(store.job("v1", 1).status).toBe("pending");
      expect(store.failures.every((f) => !f.countAttempt)).toBe(true);
    });

    it("gives back the attempt when the run budget ends the call", async () => {
      store.addVersion("v1", {}, [1]);
      let calls = 0;
      const client = fakeClient(hangUntilAborted);
      // Budget ends long before the 200 s lease.
      const counts = await runSweep(
        { budgetMs: MIN_START_MS },
        { ...deps(client), now: () => clock.now + (calls++ > 1 ? MIN_START_MS : 0) },
      );
      expect(counts).toMatchObject({ retrying: 1 });
      expect(store.failures[0]).toMatchObject({ error: "aborted:budget", countAttempt: false });
      expect(store.job("v1", 1).freeAttempts).toBe(1);
    });

    it("reads retry-after-ms, seconds and an HTTP date", () => {
      expect(providerRetryAfter(new Headers({ "retry-after-ms": "1500" }), START)).toBe(1.5);
      expect(providerRetryAfter(new Headers({ "retry-after": "12" }), START)).toBe(12);
      expect(providerRetryAfter(new Headers({ "retry-after": new Date(START + 20_000).toUTCString() }), START)).toBe(20);
      expect(providerRetryAfter(new Headers({ "retry-after": "soon" }), START)).toBeNull();
      expect(providerRetryAfter(new Headers(), START)).toBeNull();
      expect(providerRetryAfter(undefined, START)).toBeNull();
    });
  });

  describe("permanent failures", () => {
    it("fails a refusal at once", async () => {
      store.addVersion("v1", {}, [1]);
      expect(await sweep(fakeClient(refusal))).toMatchObject({ failed: 1, retrying: 0 });
      expect(store.failures[0]).toMatchObject({ error: "refusal:cyber", permanent: true });
      expect(store.job("v1", 1)).toMatchObject({ status: "failed", attempts: 1 });
    });

    it("fails a cut-off answer at once", async () => {
      store.addVersion("v1", {}, [1]);
      expect(await sweep(fakeClient(() => message("{", { stop_reason: "max_tokens" })))).toMatchObject({ failed: 1 });
      expect(store.failures[0]).toMatchObject({ error: "truncated:max_tokens", permanent: true });
    });

    it("fails malformed JSON and a missing criterion (InvalidAiRunError) at once", async () => {
      const missing = aiRun();
      delete (missing.criteria as Partial<typeof missing.criteria>).accuracy;
      store.addVersion("bad-json", {}, [1]);
      store.addVersion("missing", {}, [1]);
      const client = fakeClient((body) =>
        JSON.stringify(body.messages).includes("Team bad-json") ? message("{ not json") : message(missing),
      );

      expect(await sweep(client)).toMatchObject({ failed: 2, graded: 0 });
      expect(store.failures.map((f) => f.error)).toEqual(["invalid_output", "invalid_output"]);
      expect(store.failures.every((f) => f.permanent)).toBe(true);
      expect(store.runs).toHaveLength(0);
    });
  });

  describe("images", () => {
    it("drops a missing, too large or unreadable map, flags images_unreadable in code, and still grades", async () => {
      store.addVersion("v1", { imagePaths: ["g.png", "n1.png", "n2.png"] }, [1]);
      store.imageResults.set("g.png", { ok: false, reason: "missing" });
      store.imageResults.set("n1.png", { ok: false, reason: "too_large" });
      store.imageResults.set("n2.png", new Error("storage down"));
      const client = fakeClient();

      expect(await sweep(client)).toMatchObject({ graded: 1, retrying: 0, failed: 0 });
      expect(store.imageReads).toEqual(["g.png", "n1.png", "n2.png"]);
      expect(store.runs[0].run.flags).toEqual(["images_unreadable"]);
      const content = client.calls[0].messages[0].content as Anthropic.ContentBlockParam[];
      expect(content.filter((b) => b.type === "image")).toHaveLength(0);
      expect(JSON.stringify(content)).toContain("Image 1 (global mindmap) could not be read and is not attached.");
    });

    it("keeps the other maps and their labels when one is dropped", async () => {
      store.addVersion("v1", { imagePaths: ["g.png", "n1.png"] }, [1]);
      store.imageResults.set("g.png", { ok: false, reason: "unreadable" });
      const client = fakeClient();
      await sweep(client);
      const content = client.calls[0].messages[0].content as Anthropic.ContentBlockParam[];
      const i = content.findIndex((b) => b.type === "text" && b.text === "Image 2: note map");
      expect(content[i + 1].type).toBe("image");
      expect(content.filter((b) => b.type === "image")).toHaveLength(1);
      expect(store.runs[0].run.flags).toContain("images_unreadable");
    });

    it("reads each version's maps once, one call each, for all its runs", async () => {
      store.addVersion("v1", { imagePaths: ["a.png", "b.png", "c.webp", "d.png"] });
      await sweep(fakeClient());
      expect(store.imageReads).toEqual(["a.png", "b.png", "c.webp"]);
      expect(store.runs.every((r) => !r.run.flags.includes("images_unreadable"))).toBe(true);
    });
  });

  describe("stale answers (superseded, re-leased, or the hackathon released)", () => {
    it("treats stale from complete, skip and fail as a quiet superseded outcome", async () => {
      store.addVersion("done-stale", {}, [1]);
      store.addVersion("skip-stale", { doqtri: null }, [1]);
      store.addVersion("fail-stale", {}, [1]);
      vi.spyOn(store, "completeJob").mockResolvedValue("stale");
      vi.spyOn(store, "skipJob").mockResolvedValue("stale");
      vi.spyOn(store, "failJob").mockResolvedValue("stale");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const client = fakeClient((body, call) =>
        JSON.stringify(body.messages).includes("Team fail-stale") ? refusal(body, call, undefined) : message(aiRun()),
      );

      const counts = await runSweep({}, { store, client, now: () => clock.now, random: () => 0.5 });

      expect(counts).toMatchObject({ superseded: 3, graded: 0, ineligible: 0, failed: 0, errors: 0 });
      expect(warn).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalled();
      expect(store.progressReads).toEqual([]);
    });
  });

  describe("superseded jobs", () => {
    it("skips a version that is no longer current without calling the model", async () => {
      store.addVersion("v1", { current: false }, [1]);
      const client = fakeClient();
      expect(await sweep(client)).toMatchObject({ superseded: 1 });
      expect(client.calls).toHaveLength(0);
      expect(store.job("v1", 1).lastError).toBe("not_current");
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
  });

  describe("settling a version", () => {
    it("queues exactly one third run when two runs disagree, then settles", async () => {
      store.addVersion("v1");
      const client = fakeClient((_b, call) => message(aiRun(call === 1 ? low : high)));

      expect(await sweep(client)).toMatchObject({ graded: 3, third_runs_queued: 1 });
      expect(store.thirdRunCalls).toEqual(["v1"]);
      expect(store.runs.map((r) => r.runNo)).toEqual([1, 2, 3]);

      await sweep(client);
      expect(store.thirdRunCalls).toEqual(["v1"]);
    });

    it("does not queue a third run when the runs agree", async () => {
      store.addVersion("v1");
      expect(await sweep(fakeClient())).toMatchObject({ third_runs_queued: 0 });
      expect(store.thirdRunCalls).toEqual([]);
    });

    it("re-evaluates when a run fails, not only when one is graded", async () => {
      store.addVersion("v1");
      store.job("v1", 2).attempts = 2; // its next failure is its last
      const client = fakeClient((body, call) => (call === 1 ? message(aiRun(low)) : refusal(body, call, undefined)));

      const counts = await sweep(client);

      expect(counts).toMatchObject({ graded: 1, failed: 1, third_runs_queued: 0 });
      expect(store.progressReads.length).toBeGreaterThanOrEqual(2);
      expect(events).toContainEqual(expect.objectContaining({ event: "grading_version", status: "incomplete" }));
    });

    it("re-evaluates after a skipped (ineligible) job", async () => {
      store.addVersion("v1", { doqtri: null });
      await sweep(fakeClient());
      expect(store.progressReads).toContain("v1");
      expect(events).toContainEqual(expect.objectContaining({ event: "grading_version", status: "no_runs" }));
    });

    it("lets the two-run mean stand, final, when the third run fails permanently", async () => {
      store.addVersion("v1");
      const client = fakeClient((body, call) =>
        call === 1 ? message(aiRun(low)) : call === 2 ? message(aiRun(high)) : refusal(body, call, undefined),
      );

      const counts = await sweep(client);

      expect(counts).toMatchObject({ graded: 2, failed: 1, third_runs_queued: 1 });
      expect(store.job("v1", 3).status).toBe("failed");
      expect(store.thirdRunCalls).toEqual(["v1"]);
      expect(events.filter((e) => e.event === "grading_version").at(-1)).toMatchObject({ status: "final" });

      const grade = versionGrade(await store.readVersionProgress("v1"));
      expect(grade.state).toBe("final");
      expect(grade.combined?.status).toBe("final");
      expect(grade.combined?.flags).toContain("disagreement");
      expect(grade.combined?.total).toBe(55); // mean of 20 and 90
    });

    it("waits until no run of the version is open", async () => {
      store.addVersion("v1");
      store.job("v1", 2).nextAttemptAt = clock.now + 600_000; // run 2 not due yet
      await sweep(fakeClient(() => message(aiRun({ clarity: 0 }))));
      expect(store.thirdRunCalls).toEqual([]);
    });
  });

  describe("eligibility", () => {
    it("does not call the model for an ineligible version, and stores the gate once", async () => {
      store.addVersion("v1", { doqtri: null });
      const client = fakeClient();

      expect(await sweep(client)).toMatchObject({ ineligible: 2, graded: 0 });
      expect(client.calls).toHaveLength(0);
      expect(store.eligibilityWrites).toEqual(["v1"]);
      const stored = store.versions.get("v1")!.eligibility!;
      expect(stored.eligible).toBe(false);
      for (const j of store.jobs) {
        expect(j.status).toBe("done");
        expect(j.lastError).toBe("ineligible:notes_during_event");
      }
    });

    it("grades an ineligible version an admin overrode to eligible", async () => {
      store.addVersion("v1", { doqtri: null, override: true });
      expect((await sweep(fakeClient())).graded).toBe(2);
    });

    it("does not grade an eligible version an admin overrode to ineligible", async () => {
      store.addVersion("v1", { override: false });
      const client = fakeClient();
      expect(await sweep(client)).toMatchObject({ ineligible: 2 });
      expect(client.calls).toHaveLength(0);
      expect(store.jobs[0].lastError).toBe("ineligible:override");
    });

    it("reuses the stored gate result from the claim instead of writing it again", async () => {
      store.addVersion("v1", { eligibility: { eligible: true, rules: [] } });
      const readChain = vi.fn(async () => anchoredChain());
      await runSweep({ budgetMs: 240_000 }, { ...deps(fakeClient()), readChain });
      expect(store.eligibilityWrites).toEqual([]);
      expect(readChain).not.toHaveBeenCalled();
    });
  });

  describe("chain eligibility (QDIT-54)", () => {
    function withChain(readChain: WorkerDeps["readChain"], client = fakeClient()) {
      return runSweep({ budgetMs: 240_000 }, { ...deps(client), readChain });
    }

    it("reads the chain once per version, for all its runs", async () => {
      store.addVersion("v1");
      const readChain = vi.fn(async () => anchoredChain());
      expect(await withChain(readChain)).toMatchObject({ graded: 2 });
      expect(readChain).toHaveBeenCalledTimes(1);
    });

    it("makes an entry with no milestone anchored ineligible", async () => {
      store.addVersion("v1");
      const client = fakeClient();
      const counts = await withChain(async () => ({ ...anchoredChain(), anchoredMilestoneIds: [] }), client);
      expect(counts).toMatchObject({ ineligible: 2, graded: 0 });
      expect(client.calls).toHaveLength(0);
      expect(store.jobs[0].lastError).toBe("ineligible:milestones_on_chain");
    });

    it("retries, uncounted and with nothing stored, when the chain cannot be read", async () => {
      store.addVersion("v1");
      const client = fakeClient();
      const counts = await withChain(async () => {
        throw new ChainUnavailableError("rpc");
      }, client);
      expect(counts).toMatchObject({ retrying: 2, ineligible: 0, graded: 0, failed: 0 });
      expect(client.calls).toHaveLength(0);
      expect(store.eligibilityWrites).toEqual([]);
      for (const f of store.failures) {
        expect(f).toMatchObject({
          error: "chain_unavailable:rpc",
          retryAfterSeconds: CHAIN_RETRY_SECONDS,
          permanent: false,
          countAttempt: false,
        });
      }
    });

    it("fails at once when no registry is configured", () => {
      expect(planFailure(new ChainUnavailableError("unconfigured"), 1, 0.5, START)).toEqual({
        error: "chain_unavailable:unconfigured",
        retryAfterSeconds: 0,
        permanent: true,
        countAttempt: false,
      });
    });
  });

  it("sets truncated_input from the code when the input was cut", async () => {
    store.addVersion("v1", { qdit: qditSnapshot({ truncated: true }) }, [1]);
    await sweep(fakeClient(() => message(aiRun({}, ["placeholder"]))));
    expect(store.runs[0].run.flags).toEqual(["placeholder", "truncated_input"]);
    expect(store.runs[0].run.truncated).toBe(true);
  });
});

function hangUntilAborted(...[, , options]: Parameters<Responder>): Promise<Anthropic.Message> {
  return new Promise((_, reject) => {
    const abort = () => reject(new Anthropic.APIUserAbortError());
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort);
  });
}

describe("versionGrade", () => {
  const run = (runNo: number, score: number) => {
    const parsed = parseAiRun(aiRun({ clarity: score, structure: score, accuracy: score, connections: score, execution: score }));
    return { runNo, criteria: parsed.criteria, total: score * 10, flags: parsed.flags };
  };
  const progress = (jobs: [number, string][], runs: ReturnType<typeof run>[]): VersionProgress => ({
    jobs: jobs.map(([runNo, status]) => ({ runNo, status: status as VersionProgress["jobs"][number]["status"] })),
    runs,
  });

  it("is open while any job is pending or running", () => {
    expect(versionGrade(progress([[1, "done"], [2, "running"]], [run(1, 5)])).state).toBe("open");
  });

  it("asks for a third run only when none was tried", () => {
    expect(versionGrade(progress([[1, "done"], [2, "done"]], [run(1, 2), run(2, 9)])).state).toBe("needs_third_run");
    const settled = versionGrade(progress([[1, "done"], [2, "done"], [3, "failed"]], [run(1, 2), run(2, 9)]));
    expect(settled.state).toBe("final");
    expect(settled.combined?.flags).toEqual(["disagreement"]);
  });

  it("is final with the median of three", () => {
    const g = versionGrade(progress([[1, "done"], [2, "done"], [3, "done"]], [run(1, 2), run(2, 9), run(3, 6)]));
    expect(g.state).toBe("final");
    expect(g.combined?.total).toBe(60);
  });

  it("is incomplete with one run and nothing to come, no_runs with none", () => {
    expect(versionGrade(progress([[1, "done"], [2, "failed"]], [run(1, 5)])).state).toBe("incomplete");
    expect(versionGrade(progress([[1, "done"], [2, "done"]], [])).state).toBe("no_runs");
  });
});

describe("logging", () => {
  it("never logs scores, evidence, summaries, flags or team text", async () => {
    store.addVersion("v1");
    store.addVersion("v2", { doqtri: null }, [1]);
    store.addVersion("v3", {}, [1]);
    store.addVersion("v5", { imagePaths: ["bad.png"] }, [1]);
    store.imageResults.set("bad.png", { ok: false, reason: "too_large" });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = fakeClient((body, call) => {
      if (JSON.stringify(body.messages).includes("Team v3")) return refusal(body, call, undefined);
      return message(aiRun(call === 1 ? low : high, ["manipulation"]));
    });

    await runSweep({}, { store, client, now: () => clock.now, model: "claude-sonnet-5-5" });
    store.addVersion("v4");
    await sweep(client);

    const printed = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls].map((c) => c.join(" ")).join("\n");
    const captured = JSON.stringify(events);
    for (const text of [printed, captured]) {
      expect(text).not.toContain("EVIDENCE-SECRET");
      expect(text).not.toContain("SUMMARY-SECRET");
      expect(text).not.toContain("manipulation");
      expect(text).not.toContain("images_unreadable");
      expect(text).not.toContain("disagreement");
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
    expect(await runGradingFor("v1", deps(fakeClient()))).toMatchObject({ graded: 2 });
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

  it("plans permanent failures without counting or delay", () => {
    for (const error of [
      new GraderRefusalError(null),
      new GraderTruncatedError("max_tokens"),
      new InvalidAiRunError(["summary is not a string"]),
    ]) {
      expect(planFailure(error, 1, 0.5, START)).toMatchObject({ permanent: true, retryAfterSeconds: 0 });
    }
    expect(planFailure(new GradingAbortError("lease"), 1, 0.5, START)).toMatchObject({
      permanent: false,
      countAttempt: true,
    });
  });

  it("describes errors as codes, never content", () => {
    expect(describeError(new GraderRefusalError(null))).toBe("refusal");
    expect(describeError(new GraderRefusalError("Cyber Stuff!"))).toBe("refusal:cyber_stuff_");
    expect(describeError(new InvalidAiRunError(["summary is not a string"]))).toBe("invalid_output");
    expect(describeError(new Error("team text here"))).toBe("internal");
    expect(describeError("x")).toBe("internal");
  });

  it("sends only strings the queue accepts (^[a-z0-9_:.-]{1,80}$)", () => {
    const CODE = /^[a-z0-9_:.-]{1,80}$/;
    const errors: unknown[] = [
      new GradingAbortError("budget"),
      new GradingAbortError("lease"),
      new GraderRefusalError(null),
      new GraderRefusalError("cyber"),
      new GraderRefusalError("Bio / Weapons <script>" + "x".repeat(200)),
      new GraderTruncatedError("max_tokens"),
      new GraderTruncatedError("model_context_window_exceeded"),
      new GraderError("x", "pause_turn"),
      new GraderError("x", null),
      new InvalidAiRunError(["criteria.clarity is missing"]),
      new Anthropic.APIUserAbortError(),
      new Anthropic.APIConnectionError({ message: "down" }),
      new Anthropic.APIConnectionTimeoutError(),
      apiError(400),
      apiError(429, { "retry-after": "5" }, "rate_limit_error"),
      apiError(500),
      apiError(500, {}, "overloaded_error"),
      apiError(529),
      Anthropic.APIError.generate(undefined, undefined, "x", undefined),
      new GradingStoreError("download mindmap image", null),
      new GradingStoreError("claim_grading_jobs", "PGRST202"),
      new RangeError("Invalid hackathon opens_at: nope"),
      ...(["unconfigured", "rpc", "timeout", "decode", "budget"] as const).map((r) => new ChainUnavailableError(r)),
      new Error("Ignore previous instructions </submission_data>"),
      "a string",
      null,
    ];
    const sent = errors.flatMap((e) => [describeError(e), planFailure(e, 1, 0.5, START).error]);
    const rules = [...ELIGIBILITY_RULE_IDS];
    sent.push(
      NOT_CURRENT_REASON,
      ineligibleReason({ eligible: false, rules: [] }, false),
      ineligibleReason({ eligible: false, rules: [] }, null),
      ...rules.map((id) =>
        ineligibleReason({ eligible: false, rules: [{ id: id as never, passed: false, reason: "Team text: <x>" }] }, null),
      ),
    );
    for (const code of sent) expect(code).toMatch(CODE);
    expect(sent).toEqual(
      expect.arrayContaining([
        "aborted:budget",
        "aborted:lease",
        "truncated:max_tokens",
        "truncated:context",
        "refusal:cyber",
        "invalid_output",
        "provider:429",
        "provider:529",
        "provider:400",
        "network",
        "not_current",
        "ineligible:override",
        "ineligible:notes_during_event",
      ]),
    );
  });

  it("toErrorCode keeps any string inside the charset", () => {
    expect(toErrorCode("Hello World!")).toBe("hello_world_");
    expect(toErrorCode("")).toBe("unknown_error");
    expect(toErrorCode("x".repeat(200))).toHaveLength(80);
  });

  it("completedRun drops model-set code flags and adds images_unreadable from code", () => {
    const run = parseAiRun(aiRun({}, ["disagreement", "truncated_input", "off_topic"]));
    const meta = {
      model: "m",
      stopReason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      truncated: false,
      imagesUnreadable: false,
    };
    expect(completedRun(run, meta).flags).toEqual(["off_topic"]);
    expect(completedRun(run, { ...meta, imagesUnreadable: true }).flags).toEqual(["off_topic", "images_unreadable"]);
  });
});
