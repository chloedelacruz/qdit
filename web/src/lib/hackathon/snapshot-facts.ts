import {
  createdDuringEvent,
  isFullySpecifiedTask,
  largestConnectedNotes,
  memberIds,
  parseInstant,
  parseWindow,
  qualifyingNotes,
  uniqueNotes,
} from "@/lib/hackathon/eligibility";
import { HACKATHON_TIMEZONE } from "@/lib/hackathon/types";
import type {
  AnchorAction,
  DoqtriNoteSource,
  DoqtriSnapshotV1,
  HackathonWindow,
  MilestoneStatus,
  QditSnapshotV1,
  TaskPriority,
  TaskStatus,
} from "@/lib/hackathon/types";
import { MILESTONE_STATUSES, TASK_STATUSES } from "@/lib/types/database";

/**
 * Facts computed by code from the frozen snapshots, for the AI prompt.
 *
 * The model is told these are trusted and the team's own text is not, so it
 * does not have to count cards or notes itself (and cannot be talked into a
 * different count). Plain JSON: numbers, strings, nulls, arrays and objects.
 */

export interface AssigneeTaskCount {
  user_id: string;
  /** Null when the assignee has no username or is not a project member. */
  username: string | null;
  count: number;
}

export interface SnapshotFacts {
  captured_at: string;
  truncated: boolean;
  members: number;
  tasks: {
    total: number;
    by_status: Record<TaskStatus, number>;
    by_priority: Record<TaskPriority, number>;
    /** Most tasks first, then by username. */
    by_assignee: AssigneeTaskCount[];
    unassigned: number;
    /** Owner (a project member), priority and due date all set. */
    fully_specified: number;
    /**
     * Not done and due before the snapshot's calendar day in
     * `HACKATHON_TIMEZONE`. Null when `captured_at` is unreadable.
     */
    overdue: number | null;
  };
  milestones: {
    total: number;
    by_status: Record<MilestoneStatus, number>;
    approved: number;
    linked_to_doc_nodes: number;
  };
  proof_chain: {
    anchors: number;
    anchors_by_action: Record<AnchorAction, number>;
    reviews: number;
    stellar_proofs: number;
    deployments: number;
    registered_on_chain: boolean;
  };
  doc_links: number;
  /** Null when no doqtri snapshot was received. */
  doqtri: {
    /** Unique by `doc_id`; every count below is over these. */
    notes: number;
    /** Created inside the event window, any source. */
    notes_created_during_event: number;
    /** Created inside the window and not from a template or import. */
    qualifying_notes: number;
    notes_by_source: Record<DoqtriNoteSource | "unknown", number>;
    global_mindmap_nodes: number;
    global_mindmap_links: number;
    /** Largest group of qualifying notes the global mindmap connects. */
    largest_connected_qualifying_notes: number;
  } | null;
}

function countBy<K extends string>(keys: readonly K[], values: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = 0;
  for (const v of values) if (v in out) out[v] += 1;
  return out;
}

/** `YYYY-MM-DD` of an instant in `timeZone`, or null when the instant is unreadable. */
export function calendarDay(iso: string, timeZone: string = HACKATHON_TIMEZONE): string | null {
  const ms = parseInstant(iso);
  if (ms == null) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Throws a RangeError when a doqtri snapshot is given and the window is unreadable. */
export function snapshotFacts(
  snapshot: QditSnapshotV1,
  doqtri: DoqtriSnapshotV1 | null,
  window: Pick<HackathonWindow, "opens_at" | "closes_at">,
): SnapshotFacts {
  const { tasks, milestones } = snapshot;

  const members = memberIds(snapshot);
  const usernames = new Map(snapshot.members.map((m) => [m.user_id, m.username] as const));
  const perAssignee = new Map<string, number>();
  let unassigned = 0;
  for (const t of tasks) {
    if (t.assignee_id == null) unassigned += 1;
    else perAssignee.set(t.assignee_id, (perAssignee.get(t.assignee_id) ?? 0) + 1);
  }
  const by_assignee: AssigneeTaskCount[] = [...perAssignee]
    .map(([user_id, count]) => ({ user_id, username: usernames.get(user_id) ?? null, count }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      if (a.username !== b.username) {
        // Named members first, then alphabetical.
        if (a.username == null) return 1;
        if (b.username == null) return -1;
        return a.username < b.username ? -1 : 1;
      }
      return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
    });

  const today = calendarDay(snapshot.captured_at);
  const overdue =
    today == null
      ? null
      : tasks.filter((t) => t.status !== "done" && t.due_date != null && t.due_date < today)
          .length;

  let doqtriFacts: SnapshotFacts["doqtri"] = null;
  if (doqtri != null) {
    const parsedWindow = parseWindow(window);
    const notes = uniqueNotes(doqtri.notes);
    const duringEvent = notes.filter((n) => createdDuringEvent(n, parsedWindow)).length;
    const qualifying = qualifyingNotes(doqtri, window);
    doqtriFacts = {
      notes: notes.length,
      notes_created_during_event: duringEvent,
      qualifying_notes: qualifying.length,
      notes_by_source: countBy(
        ["editor", "template", "import", "unknown"] as const,
        notes.map((n) => n.source ?? "unknown"),
      ),
      global_mindmap_nodes: doqtri.global_mindmap.nodes.length,
      global_mindmap_links: doqtri.global_mindmap.links.length,
      largest_connected_qualifying_notes: largestConnectedNotes(
        doqtri.global_mindmap,
        qualifying.map((n) => n.doc_id),
      ).length,
    };
  }

  return {
    captured_at: snapshot.captured_at,
    truncated: snapshot.truncated,
    members: snapshot.members.length,
    tasks: {
      total: tasks.length,
      by_status: countBy(TASK_STATUSES, tasks.map((t) => t.status)),
      by_priority: countBy(
        ["low", "medium", "high", "urgent"] as const,
        tasks.map((t) => t.priority),
      ),
      by_assignee,
      unassigned,
      fully_specified: tasks.filter((t) => isFullySpecifiedTask(t, members)).length,
      overdue,
    },
    milestones: {
      total: milestones.length,
      by_status: countBy(MILESTONE_STATUSES, milestones.map((m) => m.status)),
      approved: milestones.filter((m) => m.status === "approved").length,
      linked_to_doc_nodes: new Set(snapshot.milestone_links.map((l) => l.milestone_id)).size,
    },
    proof_chain: {
      anchors: snapshot.milestone_anchors.length,
      anchors_by_action: countBy(
        ["submit", "approve", "reject"] as const,
        snapshot.milestone_anchors.map((a) => a.action),
      ),
      reviews: snapshot.milestone_reviews.length,
      stellar_proofs: snapshot.stellar_proofs.length,
      deployments: snapshot.deployments.length,
      registered_on_chain: snapshot.project.chain_contract_id != null,
    },
    doc_links: snapshot.doc_links.length,
    doqtri: doqtriFacts,
  };
}
