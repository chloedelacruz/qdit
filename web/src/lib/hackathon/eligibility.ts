import type {
  DoqtriGlobalMindmap,
  DoqtriSnapshotNote,
  DoqtriSnapshotV1,
  EligibilityInput,
  EligibilityResult,
  EligibilityRuleResult,
  HackathonWindow,
  QditSnapshotTask,
} from "@/lib/hackathon/types";

/**
 * The deterministic eligibility gate (WP-4.7, D-119; defaults Q-12, Q-13).
 *
 * A submission that fails any rule is not scored. Every rule is always
 * evaluated and reported, so an admin reviewing an override sees all the
 * reasons at once rather than only the first.
 */

/** Q-12: at least this many cards, each with owner, priority and due date. */
export const MIN_SPECIFIED_CARDS = 5;
/** Notes created inside the event window, from the editor. */
export const MIN_EVENT_NOTES = 5;
/** The largest connected group of event notes in the global mindmap. */
export const MIN_CONNECTED_NOTES = 5;

/** Notes from these sources were not written during the event. */
const EXCLUDED_NOTE_SOURCES: ReadonlySet<string> = new Set(["template", "import"]);

function toMs(iso: string): number {
  return Date.parse(iso);
}

/** Owner, priority and due date all set. */
export function isFullySpecifiedTask(task: QditSnapshotTask): boolean {
  return task.assignee_id != null && task.priority != null && task.due_date != null;
}

/**
 * Notes that count as event work: created inside `[opens_at, closes_at]`
 * (both inclusive) and not from a template or an import. An unparseable
 * timestamp never qualifies.
 */
export function qualifyingNotes(
  doqtri: DoqtriSnapshotV1,
  window: Pick<HackathonWindow, "opens_at" | "closes_at">,
): DoqtriSnapshotNote[] {
  const opens = toMs(window.opens_at);
  const closes = toMs(window.closes_at);
  return doqtri.notes.filter((note) => {
    if (note.source != null && EXCLUDED_NOTE_SOURCES.has(note.source)) return false;
    const created = toMs(note.created_at);
    return Number.isFinite(created) && created >= opens && created <= closes;
  });
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // Path compression.
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * The largest group of `docIds` that the global mindmap connects.
 *
 * Union-find over notes and map nodes together: a note joins every node whose
 * `doc_ids` name it, and a link joins its two nodes. Two notes are therefore
 * connected when they share a node, when a link joins nodes that hold them, or
 * transitively through any path in the map. Only `docIds` are counted; other
 * notes and nodes may sit on the path. Returned in `docIds` order.
 */
export function largestConnectedNotes(
  graph: DoqtriGlobalMindmap,
  docIds: readonly string[],
): string[] {
  const wanted = new Set(docIds);
  if (wanted.size === 0) return [];

  const uf = new UnionFind();
  const node = (id: string) => `n:${id}`;
  const doc = (id: string) => `d:${id}`;

  for (const n of graph.nodes) {
    uf.find(node(n.id));
    for (const d of n.doc_ids) uf.union(doc(d), node(n.id));
  }
  for (const l of graph.links) uf.union(node(l.source), node(l.target));

  const groups = new Map<string, string[]>();
  for (const id of wanted) {
    const root = uf.find(doc(id));
    const group = groups.get(root);
    if (group) group.push(id);
    else groups.set(root, [id]);
  }

  let best: string[] = [];
  for (const group of groups.values()) if (group.length > best.length) best = group;
  const order = new Map(docIds.map((id, i) => [id, i] as const));
  return [...best].sort((a, b) => order.get(a)! - order.get(b)!);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const { window, snapshot, doqtri, hasGlobalMindmapImage } = input;
  const team = [...new Set(input.teamMemberIds)];
  const rules: EligibilityRuleResult[] = [];

  // 1. team_size
  {
    const { team_min: min, team_max: max } = window;
    const passed = team.length >= min && team.length <= max;
    const range = min === max ? `${min}` : `${min}–${max}`;
    rules.push({
      id: "team_size",
      passed,
      reason: passed
        ? `${plural(team.length, "member")} (team size ${range})`
        : `${plural(team.length, "member")}; team must have ${range}`,
    });
  }

  // 2. members_joined
  {
    const joined = new Set(snapshot.members.map((m) => m.user_id));
    const count = team.filter((id) => joined.has(id)).length;
    const passed = count === team.length;
    rules.push({
      id: "members_joined",
      passed,
      reason: passed
        ? `All ${plural(team.length, "team member")} joined the project`
        : `${count} of ${plural(team.length, "team member")} joined the project`,
    });
  }

  // 3. cards
  {
    const count = snapshot.tasks.filter(isFullySpecifiedTask).length;
    const passed = count >= MIN_SPECIFIED_CARDS;
    rules.push({
      id: "cards",
      passed,
      reason: passed
        ? `${plural(count, "card")} have owner, priority and due date (needs ${MIN_SPECIFIED_CARDS})`
        : `${count} of ${MIN_SPECIFIED_CARDS} cards have owner, priority and due date`,
    });
  }

  // 4. board_current
  {
    const opens = toMs(window.opens_at);
    const updated = snapshot.tasks.filter((t) => toMs(t.updated_at) >= opens).length;
    const moved = snapshot.tasks.filter((t) => t.status !== "todo").length;
    const passed = updated >= 1 && moved >= 1;
    rules.push({
      id: "board_current",
      passed,
      reason: `${plural(updated, "card")} updated since the event opened, ${moved} out of todo`,
    });
  }

  // 5. notes_during_event, 6. notes_connected
  if (doqtri == null) {
    rules.push({ id: "notes_during_event", passed: false, reason: "No doqtri snapshot received" });
    rules.push({ id: "notes_connected", passed: false, reason: "No doqtri snapshot received" });
  } else {
    const notes = qualifyingNotes(doqtri, window);
    const eventPassed = notes.length >= MIN_EVENT_NOTES;
    rules.push({
      id: "notes_during_event",
      passed: eventPassed,
      reason: eventPassed
        ? `${plural(notes.length, "note")} written during the event (needs ${MIN_EVENT_NOTES})`
        : `${notes.length} of ${MIN_EVENT_NOTES} notes written during the event`,
    });

    const connected = largestConnectedNotes(
      doqtri.global_mindmap,
      notes.map((n) => n.doc_id),
    ).length;
    const connectedPassed = connected >= MIN_CONNECTED_NOTES;
    rules.push({
      id: "notes_connected",
      passed: connectedPassed,
      reason: connectedPassed
        ? `${plural(connected, "event note")} connected in the global mindmap (needs ${MIN_CONNECTED_NOTES})`
        : `${connected} of ${MIN_CONNECTED_NOTES} event notes connected in the global mindmap`,
    });
  }

  // 7. global_mindmap_image
  rules.push({
    id: "global_mindmap_image",
    passed: hasGlobalMindmapImage,
    reason: hasGlobalMindmapImage
      ? "Global mindmap image uploaded"
      : "Global mindmap image missing",
  });

  return { eligible: rules.every((r) => r.passed), rules };
}
