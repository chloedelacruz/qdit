import {
  ELIGIBILITY_RULE_IDS,
  HACKATHON_TIMEZONE,
  type AiFlag,
  type EligibilityResult,
  type EligibilityRuleId,
  type EligibilityRuleResult,
} from "@/lib/hackathon/types";

/**
 * Pure helpers for the hackathon staff consoles (WP-4.7, QDIT-48; D-115,
 * D-116, D-119): admin, judge and the frozen submission view.
 *
 * No server-only import and no I/O, so a Client Component can use the same
 * formatting the server renders with. Nothing here ever sees a score: the
 * score-derived view is built in `staff-queries.ts`, and only after release.
 */

/** What the judge console says before release. */
export const JUDGE_COPY = {
  beforeRelease: "Finals open after release.",
  beforeReleaseDetail:
    "An admin releases grades after the hackathon closes. The finalists then appear here in pitch order.",
} as const;

/* -------------------------------------------------------------------------- */
/* Grading status (jobs from hackathon_grading_status, never scores)          */
/* -------------------------------------------------------------------------- */

export type JobStatus = "pending" | "running" | "done" | "failed";

export interface StatusJob {
  run_no: number;
  status: JobStatus | "superseded";
  last_error: string | null;
}

export type GradingState = "not_queued" | "pending" | "running" | "failed" | "done";

export interface JobSummary {
  state: GradingState;
  /** Runs per state, superseded ones left out. */
  counts: Record<JobStatus, number>;
  /** Distinct `last_error` codes of the failed runs, in run order. */
  failedCodes: string[];
}

const EMPTY_COUNTS: Record<JobStatus, number> = { pending: 0, running: 0, done: 0, failed: 0 };

/**
 * One entry's grading in a word. Running beats pending beats failed beats
 * done: the admin's question is "is anything still moving, and did anything
 * break".
 */
export function summariseJobs(jobs: readonly StatusJob[] | null | undefined): JobSummary {
  const counts = { ...EMPTY_COUNTS };
  const failedCodes: string[] = [];
  for (const job of jobs ?? []) {
    if (job.status === "superseded") continue;
    counts[job.status] += 1;
    if (job.status === "failed") {
      const code = job.last_error?.trim();
      if (code && !failedCodes.includes(code)) failedCodes.push(code);
    }
  }
  const state: GradingState =
    counts.running > 0
      ? "running"
      : counts.pending > 0
        ? "pending"
        : counts.failed > 0
          ? "failed"
          : counts.done > 0
            ? "done"
            : "not_queued";
  return { state, counts, failedCodes };
}

export const GRADING_STATE_LABEL: Record<GradingState, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "destructive" }> = {
  not_queued: { label: "Not queued", tone: "neutral" },
  pending: { label: "Pending", tone: "neutral" },
  running: { label: "Running", tone: "accent" },
  failed: { label: "Failed", tone: "destructive" },
  done: { label: "Done", tone: "success" },
};

/** Runs across every entry, for the Release panel. */
export function gradingCounts(rows: readonly { jobs: readonly StatusJob[] | null }[]): Record<JobStatus, number> {
  const total = { ...EMPTY_COUNTS };
  for (const row of rows) {
    const { counts } = summariseJobs(row.jobs);
    for (const key of Object.keys(total) as JobStatus[]) total[key] += counts[key];
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/* Eligibility (stored jsonb, read only through hackathon_grading_status)     */
/* -------------------------------------------------------------------------- */

export const RULE_LABEL: Record<EligibilityRuleId, string> = {
  team_size: "Team size",
  members_joined: "Members joined",
  cards: "Cards",
  board_current: "Board current",
  notes_during_event: "Event notes",
  notes_connected: "Notes connected",
  global_mindmap_image: "Global map image",
};

const RULE_IDS: ReadonlySet<string> = new Set(ELIGIBILITY_RULE_IDS);

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * The stored gate result, or null while the grader has not written one (or
 * when it is not the shape eligibility.ts writes). Unknown rule ids are
 * dropped rather than shown with no label.
 */
export function parseEligibility(value: unknown): EligibilityResult | null {
  if (!isRecord(value) || typeof value.eligible !== "boolean" || !Array.isArray(value.rules)) {
    return null;
  }
  const rules: EligibilityRuleResult[] = [];
  for (const raw of value.rules) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !RULE_IDS.has(raw.id)) continue;
    rules.push({
      id: raw.id as EligibilityRuleId,
      passed: raw.passed === true,
      reason: typeof raw.reason === "string" ? raw.reason : "",
    });
  }
  return { eligible: value.eligible, rules };
}

/** What counts, as SQL hackathon_entry_eligible(): the override wins, no result is not eligible. */
export function effectiveEligible(override: boolean | null, eligibility: EligibilityResult | null): boolean {
  return override ?? eligibility?.eligible ?? false;
}

/* -------------------------------------------------------------------------- */
/* AI flags (after release only)                                              */
/* -------------------------------------------------------------------------- */

export const FLAG_LABEL: Record<AiFlag, string> = {
  manipulation: "Manipulation attempt",
  placeholder: "Placeholder content",
  off_topic: "Off topic",
  images_unreadable: "Images unreadable",
  images_contradict_notes: "Images contradict notes",
  truncated_input: "Input truncated",
  disagreement: "Runs disagreed",
};

/* -------------------------------------------------------------------------- */
/* Time, in the event's own zone                                              */
/* -------------------------------------------------------------------------- */

/**
 * Asia/Manila has been UTC+8 with no daylight saving since 1978, so a
 * wall-clock time there maps to one instant by a fixed offset. Stated, not
 * computed, so the late-pass form means the same on a server in any zone.
 */
export const MANILA_OFFSET = "+08:00";
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * A `datetime-local` value read as Manila wall-clock time, as an ISO instant;
 * null when it is not one.
 */
export function manilaLocalToIso(local: string): string | null {
  const m = LOCAL_INPUT.exec(local.trim());
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${MANILA_OFFSET}`);
  if (!Number.isFinite(ms)) return null;
  // Date.parse rolls 2026-02-31 over to March; refuse it instead.
  const back = new Date(ms + MANILA_OFFSET_MS).toISOString();
  if (back.slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  return new Date(ms).toISOString();
}

/** An instant as a Manila `datetime-local` value (`YYYY-MM-DDTHH:mm`). */
export function isoToManilaLocal(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 16);
}

const MANILA_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: HACKATHON_TIMEZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "10 Nov 2026, 14:30 Manila". The event's zone, so every admin reads the same time. */
export function formatManila(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return `${MANILA_FORMAT.format(ms)} Manila`;
}

/** "2h 05m", "4m 10s", "3d 2h". Never negative. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/* -------------------------------------------------------------------------- */
/* Team content: always plain text                                            */
/* -------------------------------------------------------------------------- */

/** Every C0/C1 control character except tab and line feed, and the bidi overrides. */
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/**
 * Team-written content made safe to print as text: coerced to a string,
 * CRLF to LF, control and bidi-override characters removed (a reversed run
 * could make a note read differently from what it says), and clipped with a
 * visible marker. It is never parsed as markdown or HTML: callers render the
 * result as a React text child, which escapes it.
 */
export function toPlainText(value: unknown, max = 200_000): string {
  if (value == null) return "";
  const text = (typeof value === "string" ? value : String(value))
    .replace(/\r\n?/g, "\n")
    .replace(UNSAFE_CHARS, "");
  return text.length > max ? `${text.slice(0, max)}\n[clipped for display]` : text;
}

/* -------------------------------------------------------------------------- */
/* Frozen snapshots, read defensively                                         */
/* -------------------------------------------------------------------------- */

function arrayOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : value == null ? null : String(value);
}

export interface SnapshotMemberView {
  user_id: string;
  username: string | null;
  display_name: string | null;
  role: string | null;
}

export interface SnapshotTaskView {
  id: string;
  title: string;
  status: string;
  assignee_id: string | null;
  priority: string | null;
  due_date: string | null;
  milestone_id: string | null;
}

export interface SnapshotMilestoneView {
  id: string;
  title: string;
  status: string | null;
  due_date: string | null;
}

export interface SnapshotProofView {
  id: string;
  network: string | null;
  tx_hash: string | null;
  contract_id: string | null;
  proof_url: string | null;
  notes: string | null;
}

export interface QditSnapshotView {
  captured_at: string | null;
  truncated: boolean;
  project: { name: string; slug: string; description: string | null };
  members: SnapshotMemberView[];
  milestones: SnapshotMilestoneView[];
  tasks: SnapshotTaskView[];
  proofs: SnapshotProofView[];
  anchors: number;
}

/** The frozen qdit snapshot (QditSnapshotV1), every list present and every field typed. */
export function readQditSnapshot(value: unknown): QditSnapshotView {
  const snap = isRecord(value) ? value : {};
  const project = isRecord(snap.project) ? snap.project : {};
  return {
    captured_at: str(snap.captured_at),
    truncated: snap.truncated === true,
    project: {
      name: str(project.name) ?? "",
      slug: str(project.slug) ?? "",
      description: str(project.description),
    },
    members: arrayOf(snap.members).map((m) => ({
      user_id: str(m.user_id) ?? "",
      username: str(m.username),
      display_name: str(m.display_name),
      role: str(m.role),
    })),
    milestones: arrayOf(snap.milestones).map((m) => ({
      id: str(m.id) ?? "",
      title: str(m.title) ?? "",
      status: str(m.status),
      due_date: str(m.due_date),
    })),
    tasks: arrayOf(snap.tasks).map((t) => ({
      id: str(t.id) ?? "",
      title: str(t.title) ?? "",
      status: str(t.status) ?? "todo",
      assignee_id: str(t.assignee_id),
      priority: str(t.priority),
      due_date: str(t.due_date),
      milestone_id: str(t.milestone_id),
    })),
    proofs: arrayOf(snap.stellar_proofs).map((p) => ({
      id: str(p.id) ?? "",
      network: str(p.network),
      tx_hash: str(p.tx_hash),
      contract_id: str(p.contract_id),
      proof_url: str(p.proof_url),
      notes: str(p.notes),
    })),
    anchors: arrayOf(snap.milestone_anchors).length,
  };
}

export const BOARD_COLUMNS = ["todo", "in_progress", "done"] as const;

/** Tasks by board column; a status outside the three lands in its own trailing group. */
export function groupTasksByStatus(tasks: readonly SnapshotTaskView[]): { status: string; tasks: SnapshotTaskView[] }[] {
  const groups = new Map<string, SnapshotTaskView[]>(BOARD_COLUMNS.map((s) => [s, []]));
  for (const task of tasks) {
    const list = groups.get(task.status) ?? [];
    list.push(task);
    groups.set(task.status, list);
  }
  return [...groups.entries()].map(([status, list]) => ({ status, tasks: list }));
}

export interface DoqtriNoteView {
  doc_id: string;
  title: string;
  markdown: string;
  created_at: string | null;
  source: string | null;
}

export interface DoqtriSnapshotView {
  generated_at: string | null;
  notes: DoqtriNoteView[];
  nodeCount: number;
  linkCount: number;
  /** Distinct node labels, in payload order. */
  labels: string[];
}

/** A pushed doqtri payload (DoqtriSnapshotV1), read defensively; null when there is none. */
export function readDoqtriSnapshot(value: unknown): DoqtriSnapshotView | null {
  if (!isRecord(value)) return null;
  const map = isRecord(value.global_mindmap) ? value.global_mindmap : {};
  const nodes = arrayOf(map.nodes);
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const label = str(n.label)?.trim();
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return {
    generated_at: str(value.generated_at),
    notes: arrayOf(value.notes).map((n) => ({
      doc_id: str(n.doc_id) ?? "",
      title: str(n.title) ?? "",
      markdown: str(n.markdown) ?? "",
      created_at: str(n.created_at),
      source: str(n.source),
    })),
    nodeCount: nodes.length,
    linkCount: arrayOf(map.links).length,
    labels,
  };
}
