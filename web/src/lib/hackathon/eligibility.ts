import type {
  DoqtriGlobalMindmap,
  DoqtriSnapshotNote,
  DoqtriSnapshotV1,
  EligibilityInput,
  EligibilityResult,
  EligibilityRuleResult,
  HackathonWindow,
  QditSnapshotTask,
  QditSnapshotV1,
} from "@/lib/hackathon/types";

/**
 * The deterministic eligibility gate (WP-4.7, D-119; defaults Q-12, Q-13;
 * the two chain rules from QDIT-54).
 *
 * The chain rules read `input.chain`, which the grading worker fetches before
 * calling this (chain-facts.ts), so the gate itself stays pure.
 *
 * A submission that fails any rule is not scored. Every rule is always
 * evaluated and reported, so an admin reviewing an override sees all the
 * reasons at once rather than only the first. Anything that cannot be read
 * fails closed: it never counts towards passing a rule.
 */

/** Q-12: at least this many cards, each with owner, priority and due date. */
export const MIN_SPECIFIED_CARDS = 5;
/** Notes created inside the event window, from the editor. */
export const MIN_EVENT_NOTES = 5;
/** The largest group of event notes connected by the global mindmap or `[[links]]`. */
export const MIN_CONNECTED_NOTES = 5;

/** QDIT-54: event notes anchored on DoqtriRegistry. */
export const MIN_ANCHORED_NOTES = 5;
/** QDIT-54: milestones whose on-chain record was submitted during the event. */
export const MIN_ANCHORED_MILESTONES = 1;

/** Appended to the reason of a failed rule read from a truncated qdit snapshot. */
export const TRUNCATED_SUFFIX = " (snapshot was truncated)";

/** Notes from these sources were not written during the event. */
const EXCLUDED_NOTE_SOURCES: ReadonlySet<string> = new Set(["template", "import"]);

/**
 * ISO 8601 date-time with an explicit offset: `Z` or `±hh:mm`. A timestamp
 * without one would be read in the server's local zone, so it is refused.
 */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Epoch ms for an ISO instant with an explicit offset, or null. */
export function parseInstant(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** The event window as epoch ms. Throws a RangeError when either end is unreadable. */
export function parseWindow(window: Pick<HackathonWindow, "opens_at" | "closes_at">): {
  opens: number;
  closes: number;
} {
  const opens = parseInstant(window.opens_at);
  const closes = parseInstant(window.closes_at);
  if (opens == null) throw new RangeError(`Invalid hackathon opens_at: ${String(window.opens_at)}`);
  if (closes == null) {
    throw new RangeError(`Invalid hackathon closes_at: ${String(window.closes_at)}`);
  }
  return { opens, closes };
}

/** Notes with duplicate `doc_id`s collapsed to the first occurrence. */
export function uniqueNotes(notes: readonly DoqtriSnapshotNote[]): DoqtriSnapshotNote[] {
  const seen = new Set<string>();
  return notes.filter((n) => {
    if (seen.has(n.doc_id)) return false;
    seen.add(n.doc_id);
    return true;
  });
}

/** The project's member ids. */
export function memberIds(snapshot: QditSnapshotV1): Set<string> {
  return new Set(snapshot.members.map((m) => m.user_id));
}

/**
 * Owner, priority and due date all set, and the owner is a project member.
 * An assignee who has left the project does not make a card count.
 */
export function isFullySpecifiedTask(
  task: QditSnapshotTask,
  members: ReadonlySet<string>,
): boolean {
  return (
    task.assignee_id != null &&
    members.has(task.assignee_id) &&
    task.priority != null &&
    task.due_date != null
  );
}

/** Created inside `[opens_at, closes_at]`, both inclusive. */
export function createdDuringEvent(
  note: DoqtriSnapshotNote,
  window: { opens: number; closes: number },
): boolean {
  const created = parseInstant(note.created_at);
  return created != null && created >= window.opens && created <= window.closes;
}

/**
 * Notes that count as event work: unique by `doc_id`, created inside the
 * window, and not from a template or an import.
 *
 * `source: null` counts on purpose: doqtri does not send "editor" today, so a
 * note without a recorded source is an ordinary note written in the editor.
 */
export function qualifyingNotes(
  doqtri: DoqtriSnapshotV1,
  window: Pick<HackathonWindow, "opens_at" | "closes_at">,
): DoqtriSnapshotNote[] {
  const parsed = parseWindow(window);
  return uniqueNotes(doqtri.notes).filter((note) => {
    if (note.source != null && EXCLUDED_NOTE_SOURCES.has(note.source)) return false;
    return createdDuringEvent(note, parsed);
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
 * doqtri's `[[Title]]` and `[[Title|alias]]`, capturing Title only: the same
 * pattern as doqtri's `lib/wikilinks.ts`, so qdit sees the links its Graph
 * view draws.
 */
const WIKILINK = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/** doqtri matches a link to a note's title ignoring case and surrounding space. */
function linkKey(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * Every `[[link]]` in `notes` that names another note in `notes`, as
 * `[from, to]` doc id pairs. Links to a title no note has (doqtri's ghost
 * nodes) are dropped, so two notes never join through a note that does not
 * exist. When two notes share a title the later one wins, as in doqtri.
 */
export function noteLinks(
  notes: readonly Pick<DoqtriSnapshotNote, "doc_id" | "title" | "markdown">[],
): [string, string][] {
  const idByTitle = new Map<string, string>();
  for (const n of notes) idByTitle.set(linkKey(n.title), n.doc_id);

  const pairs: [string, string][] = [];
  for (const n of notes) {
    if (typeof n.markdown !== "string") continue;
    for (const match of n.markdown.matchAll(WIKILINK)) {
      const to = idByTitle.get(linkKey(match[1]));
      if (to !== undefined && to !== n.doc_id) pairs.push([n.doc_id, to]);
    }
  }
  return pairs;
}

/**
 * The largest group of `docIds` that the global mindmap or the notes' own
 * `[[links]]` connect.
 *
 * Union-find over notes and map nodes together: a note joins every node whose
 * `doc_ids` name it, and a link joins its two nodes. Two notes are therefore
 * connected when they share a node, when a link joins nodes that hold them, or
 * transitively through any path in the map. A `[[link]]` from one note in
 * `notes` to another joins the two notes directly (doqtri's Graph view), and
 * mixes freely with map paths. Only `docIds` are counted (once each); other
 * notes and nodes may sit on the path. Returned in `docIds` order.
 */
export function largestConnectedNotes(
  graph: DoqtriGlobalMindmap,
  docIds: readonly string[],
  notes: readonly Pick<DoqtriSnapshotNote, "doc_id" | "title" | "markdown">[] = [],
): string[] {
  const wanted = [...new Set(docIds)];
  if (wanted.length === 0) return [];

  const uf = new UnionFind();
  const node = (id: string) => `n:${id}`;
  const doc = (id: string) => `d:${id}`;

  for (const n of graph.nodes) {
    uf.find(node(n.id));
    for (const d of n.doc_ids) uf.union(doc(d), node(n.id));
  }
  for (const l of graph.links) uf.union(node(l.source), node(l.target));
  for (const [from, to] of noteLinks(notes)) uf.union(doc(from), doc(to));

  const groups = new Map<string, string[]>();
  for (const id of wanted) {
    const root = uf.find(doc(id));
    const group = groups.get(root);
    if (group) group.push(id);
    else groups.set(root, [id]);
  }

  let best: string[] = [];
  for (const group of groups.values()) if (group.length > best.length) best = group;
  return best;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Throws a RangeError when the window's timestamps are unreadable. */
export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const { window, snapshot, doqtri, hasGlobalMindmapImage, chain } = input;
  const parsedWindow = parseWindow(window);
  const team = [...new Set(input.teamMemberIds)];
  const members = memberIds(snapshot);
  const rules: EligibilityRuleResult[] = [];

  /** A rule read from the qdit snapshot: a failure may be the truncation's fault. */
  function qditRule(rule: EligibilityRuleResult): EligibilityRuleResult {
    if (!rule.passed && snapshot.truncated) rule.reason += TRUNCATED_SUFFIX;
    return rule;
  }

  // 1. team_size: from the submission form, not the snapshot, so truncation cannot explain it.
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
    const count = team.filter((id) => members.has(id)).length;
    const passed = count === team.length;
    rules.push(
      qditRule({
        id: "members_joined",
        passed,
        reason: passed
          ? `All ${plural(team.length, "team member")} joined the project`
          : `${count} of ${plural(team.length, "team member")} joined the project`,
      }),
    );
  }

  // 3. cards
  {
    const count = snapshot.tasks.filter((t) => isFullySpecifiedTask(t, members)).length;
    const passed = count >= MIN_SPECIFIED_CARDS;
    rules.push(
      qditRule({
        id: "cards",
        passed,
        reason: passed
          ? `${plural(count, "card")} have owner, priority and due date (needs ${MIN_SPECIFIED_CARDS})`
          : `${count} of ${MIN_SPECIFIED_CARDS} cards have owner, priority and due date`,
      }),
    );
  }

  // 4. board_current
  {
    const updated = snapshot.tasks.filter((t) => {
      const at = parseInstant(t.updated_at);
      return at != null && at >= parsedWindow.opens;
    }).length;
    const moved = snapshot.tasks.filter((t) => t.status !== "todo").length;
    const passed = updated >= 1 && moved >= 1;
    rules.push(
      qditRule({
        id: "board_current",
        passed,
        reason: `${plural(updated, "card")} updated since the event opened, ${moved} out of todo`,
      }),
    );
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
      uniqueNotes(doqtri.notes),
    ).length;
    const connectedPassed = connected >= MIN_CONNECTED_NOTES;
    rules.push({
      id: "notes_connected",
      passed: connectedPassed,
      reason: connectedPassed
        ? `${plural(connected, "event note")} connected by the global mindmap or [[links]] (needs ${MIN_CONNECTED_NOTES})`
        : `${connected} of ${MIN_CONNECTED_NOTES} event notes connected by the global mindmap or [[links]]`,
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

  // 8. notes_on_chain
  if (doqtri == null) {
    rules.push({ id: "notes_on_chain", passed: false, reason: "No doqtri snapshot received" });
  } else {
    const anchored = new Set(chain.anchoredNoteIds.map((id) => id.toLowerCase()));
    const count = qualifyingNotes(doqtri, window).filter((n) => anchored.has(n.doc_id.toLowerCase())).length;
    const passed = count >= MIN_ANCHORED_NOTES;
    rules.push({
      id: "notes_on_chain",
      passed,
      reason: passed
        ? `${plural(count, "event note")} anchored on chain (needs ${MIN_ANCHORED_NOTES})`
        : `${count} of ${MIN_ANCHORED_NOTES} event notes anchored on chain`,
    });
  }

  // 9. milestones_on_chain
  {
    const anchored = new Set(chain.anchoredMilestoneIds);
    const count = snapshot.milestones.filter((m) => anchored.has(m.id)).length;
    const passed = count >= MIN_ANCHORED_MILESTONES;
    const unregistered = snapshot.project.chain_contract_id == null ? " (project not registered on chain)" : "";
    rules.push(
      qditRule({
        id: "milestones_on_chain",
        passed,
        reason: passed
          ? `${plural(count, "milestone")} anchored on chain during the event`
          : `No milestone anchored on chain during the event${unregistered}`,
      }),
    );
  }

  return { eligible: rules.every((r) => r.passed), rules };
}
