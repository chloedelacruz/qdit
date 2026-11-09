import type Anthropic from "@anthropic-ai/sdk";

import type { GraderClient } from "@/lib/hackathon/grader";
import type {
  ClaimedJob,
  CompletedRun,
  GradingJobStatus,
  GradingStore,
  JobContext,
} from "@/lib/hackathon/grading-store";
import type { GradingImage } from "@/lib/hackathon/prompt";
import type {
  AiRunOutput,
  DoqtriSnapshotNote,
  DoqtriSnapshotV1,
  EligibilityResult,
  HackathonWindow,
  QditSnapshotTask,
  QditSnapshotV1,
} from "@/lib/hackathon/types";

/**
 * Fixtures for the hackathon grader tests (WP-4.7): an eligible entry, an
 * in-memory GradingStore that behaves like the SQL queue, and a fake
 * Anthropic client.
 */

export const WINDOW: HackathonWindow = {
  opens_at: "2026-11-20T09:00:00.000Z",
  closes_at: "2026-11-21T17:00:00.000Z",
  team_min: 3,
  team_max: 4,
};
export const DURING = "2026-11-20T12:00:00.000Z";
const BEFORE = "2026-11-19T12:00:00.000Z";
export const TEAM = ["u1", "u2", "u3"];

export function task(i: number, overrides: Partial<QditSnapshotTask> = {}): QditSnapshotTask {
  return {
    id: `t${i}`,
    milestone_id: null,
    title: `Task ${i}`,
    description: `Do part ${i} of the solution.`,
    status: "in_progress",
    assignee_id: TEAM[i % TEAM.length],
    priority: "medium",
    due_date: "2026-11-21",
    created_at: DURING,
    updated_at: DURING,
    ...overrides,
  };
}

export function qditSnapshot(overrides: Partial<QditSnapshotV1> = {}): QditSnapshotV1 {
  return {
    schema_version: 1,
    captured_at: "2026-11-21T16:00:00.000Z",
    truncated: false,
    project: {
      id: "p1",
      slug: "team-one",
      name: "Team One",
      description: "Flood alerts for barangays.",
      status: "active",
      repo_url: null,
      demo_url: null,
      docs_url: null,
      created_at: BEFORE,
      chain_contract_id: null,
      public_proofs: false,
    },
    members: ["u1", "u2", "u3", "u4"].map((user_id) => ({
      user_id,
      role: "member" as const,
      joined_at: BEFORE,
      username: user_id,
      display_name: null,
      wallet_address: null,
    })),
    milestones: [],
    tasks: Array.from({ length: 6 }, (_, i) => task(i)),
    milestone_reviews: [],
    milestone_anchors: [],
    stellar_proofs: [],
    deployments: [],
    doc_links: [],
    milestone_links: [],
    ...overrides,
  };
}

export function note(id: string, overrides: Partial<DoqtriSnapshotNote> = {}): DoqtriSnapshotNote {
  return {
    doc_id: id,
    title: `Note ${id}`,
    markdown: `# ${id}\n\n- Problem\n- Solutions`,
    mindmap: null,
    created_at: DURING,
    updated_at: DURING,
    version: null,
    source: "editor",
    ...overrides,
  };
}

export function doqtriSnapshot(notes: DoqtriSnapshotNote[] = ["n1", "n2", "n3", "n4", "n5"].map((id) => note(id))): DoqtriSnapshotV1 {
  const ids = notes.map((n) => n.doc_id);
  return {
    hackathon_slug: "hack",
    snapshot_id: "s1",
    workspace_id: "w1",
    generated_at: DURING,
    notes,
    global_mindmap: {
      nodes: [
        ...ids.map((id) => ({ id: `doc:${id}`, label: `Note ${id}`, kind: "document", depth: 0, doc_ids: [id] })),
        { id: "concept:hub", label: "Solutions", kind: "concept", depth: 1, doc_ids: [...ids] },
      ],
      links: ids.map((id) => ({ source: `doc:${id}`, target: "concept:hub" })),
    },
  };
}

export const IMAGE: GradingImage = { mediaType: "image/png", base64: "iVBORw0KGgo=" };

export const ELIGIBLE: EligibilityResult = { eligible: true, rules: [] };

/** One AI run with recognisable text, so the log test can look for it. */
export function aiRun(scores: Partial<Record<keyof AiRunOutput["criteria"], number>> = {}, flags: string[] = []) {
  const criterion = (key: string, fallback: number) => ({
    score: scores[key as keyof AiRunOutput["criteria"]] ?? fallback,
    evidence: `EVIDENCE-SECRET-${key}`,
  });
  return {
    criteria: {
      clarity: criterion("clarity", 7),
      structure: criterion("structure", 7),
      accuracy: criterion("accuracy", 7),
      connections: criterion("connections", 7),
      execution: criterion("execution", 7),
    },
    summary: "SUMMARY-SECRET",
    flags,
  };
}

/* -------------------------------------------------------------------------- */
/* Fake Anthropic client                                                      */
/* -------------------------------------------------------------------------- */

export function message(
  body: unknown,
  overrides: Partial<Anthropic.Message> = {},
): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 12_000,
      output_tokens: 2_500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 2_600,
    },
    ...overrides,
  } as Anthropic.Message;
}

export type Responder = (
  body: Anthropic.MessageCreateParamsNonStreaming,
  call: number,
  options: { signal?: AbortSignal } | undefined,
) => Promise<Anthropic.Message> | Anthropic.Message;

export interface FakeClient extends GraderClient {
  calls: Anthropic.MessageCreateParamsNonStreaming[];
  options: ({ signal?: AbortSignal; timeout?: number; maxRetries?: number } | undefined)[];
  inFlight: number;
  maxInFlight: number;
}

export function fakeClient(respond: Responder = () => message(aiRun())): FakeClient {
  const client: FakeClient = {
    calls: [],
    options: [],
    inFlight: 0,
    maxInFlight: 0,
    messages: {
      async create(body, options) {
        const call = client.calls.push(body);
        client.options.push(options);
        client.inFlight += 1;
        client.maxInFlight = Math.max(client.maxInFlight, client.inFlight);
        try {
          // Let every job of a claim round start before any settles.
          await new Promise((r) => setTimeout(r, 1));
          return await respond(body, call, options);
        } finally {
          client.inFlight -= 1;
        }
      },
    },
  };
  return client;
}

/* -------------------------------------------------------------------------- */
/* In-memory store: the SQL queue's rules, as far as the worker can see them  */
/* -------------------------------------------------------------------------- */

export interface FakeJob {
  id: string;
  versionId: string;
  runNo: number;
  status: GradingJobStatus;
  attempts: number;
  nextAttemptAt: number;
  leaseUntil: number | null;
  lastError: string | null;
}

export interface FakeVersion {
  id: string;
  submissionId: string;
  teamName: string;
  memberIds: string[];
  imagePaths: string[];
  qdit: QditSnapshotV1;
  doqtri: DoqtriSnapshotV1 | null;
  eligibility: EligibilityResult | null;
  override: boolean | null;
  current: boolean;
}

export class FakeStore implements GradingStore {
  jobs: FakeJob[] = [];
  versions = new Map<string, FakeVersion>();
  runs: { versionId: string; runNo: number; run: CompletedRun }[] = [];
  claimArgs: { limit: number; leaseSeconds: number; versionId?: string }[] = [];
  failures: { jobId: string; error: string; retryAfterSeconds: number }[] = [];
  eligibilityWrites: string[] = [];
  thirdRunCalls: string[] = [];
  imageReads: string[] = [];
  /** Set to make readImage fail. */
  imageError: Error | null = null;
  private seq = 0;

  constructor(readonly clock: { now: number }) {}

  addVersion(id: string, overrides: Partial<FakeVersion> = {}, runs = [1, 2]): FakeVersion {
    const version: FakeVersion = {
      id,
      submissionId: `sub-${id}`,
      teamName: `Team ${id}`,
      memberIds: [...TEAM],
      imagePaths: [`h/p/${id}-global.png`],
      qdit: qditSnapshot(),
      doqtri: doqtriSnapshot(),
      eligibility: null,
      override: null,
      current: true,
      ...overrides,
    };
    this.versions.set(id, version);
    for (const runNo of runs) this.addJob(id, runNo);
    return version;
  }

  addJob(versionId: string, runNo: number): FakeJob {
    const job: FakeJob = {
      id: `job-${++this.seq}`,
      versionId,
      runNo,
      status: "pending",
      attempts: 0,
      nextAttemptAt: this.clock.now,
      leaseUntil: null,
      lastError: null,
    };
    this.jobs.push(job);
    return job;
  }

  job(versionId: string, runNo: number): FakeJob {
    const found = this.jobs.find((j) => j.versionId === versionId && j.runNo === runNo);
    if (!found) throw new Error(`no job ${versionId}/${runNo}`);
    return found;
  }

  async claimJobs(args: { limit: number; leaseSeconds: number; versionId?: string }): Promise<ClaimedJob[]> {
    this.claimArgs.push(args);
    const now = this.clock.now;
    const running = this.jobs.filter((j) => j.status === "running").length;
    const limit = Math.min(Math.max(1, args.limit), 20, 20 - running);
    if (limit <= 0) return [];
    const due = this.jobs
      .filter(
        (j) =>
          j.status === "pending" &&
          j.nextAttemptAt <= now &&
          j.attempts < 3 &&
          (args.versionId == null || j.versionId === args.versionId),
      )
      .slice(0, limit);
    return due.map((j) => {
      j.status = "running";
      j.attempts += 1;
      j.leaseUntil = now + args.leaseSeconds * 1000;
      const v = this.versions.get(j.versionId)!;
      return {
        jobId: j.id,
        versionId: j.versionId,
        runNo: j.runNo,
        attempts: j.attempts,
        leaseUntil: new Date(j.leaseUntil).toISOString(),
        submissionId: v.submissionId,
        hackathonId: "h",
        projectId: "p1",
        teamName: v.teamName,
        memberIds: v.memberIds,
        imagePaths: v.imagePaths,
        submittedAt: DURING,
        qditSnapshot: v.qdit,
        doqtriSnapshot: v.doqtri,
        window: WINDOW,
      };
    });
  }

  async readJobContext(job: Pick<ClaimedJob, "jobId" | "versionId" | "submissionId">): Promise<JobContext> {
    const row = this.jobs.find((j) => j.id === job.jobId);
    const v = this.versions.get(job.versionId)!;
    return {
      jobStatus: row?.status ?? null,
      isCurrentVersion: v.current,
      eligibilityOverride: v.override,
      eligibility: v.eligibility,
    };
  }

  async setVersionEligibility(versionId: string, eligibility: EligibilityResult): Promise<void> {
    this.eligibilityWrites.push(versionId);
    this.versions.get(versionId)!.eligibility = eligibility;
  }

  async readImage(path: string): Promise<GradingImage> {
    this.imageReads.push(path);
    if (this.imageError) throw this.imageError;
    return IMAGE;
  }

  private running(jobId: string): FakeJob | null {
    const j = this.jobs.find((x) => x.id === jobId);
    return j && j.status === "running" ? j : null;
  }

  async completeJob(jobId: string, run: CompletedRun): Promise<"done" | "stale"> {
    const j = this.running(jobId);
    if (!j) return "stale";
    this.runs.push({ versionId: j.versionId, runNo: j.runNo, run });
    j.status = "done";
    j.leaseUntil = null;
    return "done";
  }

  async skipJob(jobId: string, reason: string): Promise<"done" | "stale"> {
    const j = this.running(jobId);
    if (!j) return "stale";
    j.status = "done";
    j.leaseUntil = null;
    j.lastError = reason;
    return "done";
  }

  async failJob(jobId: string, error: string, retryAfterSeconds: number): Promise<"pending" | "failed" | "stale"> {
    this.failures.push({ jobId, error, retryAfterSeconds });
    const j = this.running(jobId);
    if (!j) return "stale";
    j.status = j.attempts < 3 ? "pending" : "failed";
    j.leaseUntil = null;
    j.nextAttemptAt = this.clock.now + retryAfterSeconds * 1000;
    j.lastError = error;
    return j.status;
  }

  async readVersionProgress(versionId: string) {
    const jobs = this.jobs.filter((j) => j.versionId === versionId && j.status !== "superseded");
    const done = new Set(jobs.filter((j) => j.status === "done").map((j) => j.runNo));
    return {
      jobs: jobs.map((j) => ({ runNo: j.runNo, status: j.status })),
      runs: this.runs
        .filter((r) => r.versionId === versionId && done.has(r.runNo))
        .sort((a, b) => a.runNo - b.runNo)
        .map((r) => ({ criteria: r.run.criteria, summary: r.run.summary, flags: r.run.flags })),
    };
  }

  async enqueueThirdRun(versionId: string): Promise<string | null> {
    this.thirdRunCalls.push(versionId);
    const v = this.versions.get(versionId)!;
    const active = this.jobs.filter((j) => j.versionId === versionId && j.status !== "superseded");
    if (!v.current || active.length >= 3) return null;
    const next = Math.max(0, ...this.jobs.filter((j) => j.versionId === versionId).map((j) => j.runNo)) + 1;
    return this.addJob(versionId, next).id;
  }
}
