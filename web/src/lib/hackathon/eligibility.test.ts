import { describe, expect, it } from "vitest";

import {
  checkEligibility,
  largestConnectedNotes,
  parseInstant,
  qualifyingNotes,
  TRUNCATED_SUFFIX,
} from "@/lib/hackathon/eligibility";
import {
  ELIGIBILITY_RULE_IDS,
  type DoqtriGlobalMindmap,
  type DoqtriSnapshotNote,
  type DoqtriSnapshotV1,
  type EligibilityInput,
  type EligibilityRuleId,
  type HackathonWindow,
  type QditSnapshotTask,
  type QditSnapshotV1,
} from "@/lib/hackathon/types";

const WINDOW: HackathonWindow = {
  opens_at: "2026-11-20T09:00:00.000Z",
  closes_at: "2026-11-21T17:00:00.000Z",
  team_min: 3,
  team_max: 4,
};
const DURING = "2026-11-20T12:00:00.000Z";
const BEFORE = "2026-11-19T12:00:00.000Z";
const TEAM = ["u1", "u2", "u3"];

function task(i: number, overrides: Partial<QditSnapshotTask> = {}): QditSnapshotTask {
  return {
    id: `t${i}`,
    milestone_id: null,
    title: `Task ${i}`,
    description: null,
    status: "in_progress",
    assignee_id: "u1",
    priority: "medium",
    due_date: "2026-11-21",
    created_at: DURING,
    updated_at: DURING,
    ...overrides,
  };
}

function tasks(n: number, overrides: Partial<QditSnapshotTask> = {}): QditSnapshotTask[] {
  return Array.from({ length: n }, (_, i) => task(i, overrides));
}

function snapshot(overrides: Partial<QditSnapshotV1> = {}): QditSnapshotV1 {
  return {
    schema_version: 1,
    captured_at: "2026-11-21T16:00:00.000Z",
    truncated: false,
    project: {
      id: "p1",
      slug: "team-one",
      name: "Team One",
      description: null,
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
    tasks: tasks(5),
    milestone_reviews: [],
    milestone_anchors: [],
    stellar_proofs: [],
    deployments: [],
    doc_links: [],
    milestone_links: [],
    ...overrides,
  };
}

function note(id: string, overrides: Partial<DoqtriSnapshotNote> = {}): DoqtriSnapshotNote {
  return {
    doc_id: id,
    title: id,
    markdown: `# ${id}`,
    mindmap: null,
    created_at: DURING,
    updated_at: DURING,
    version: null,
    source: "editor",
    ...overrides,
  };
}

/** Every note hangs off one shared hub concept. */
function hub(ids: readonly string[]): DoqtriGlobalMindmap {
  return {
    nodes: [
      ...ids.map((id) => ({ id: `doc:${id}`, label: id, kind: "document", depth: 0, doc_ids: [id] })),
      { id: "concept:hub", label: "Hub", kind: "concept", depth: 1, doc_ids: [...ids] },
    ],
    links: ids.map((id) => ({ source: `doc:${id}`, target: "concept:hub" })),
  };
}

function doqtri(
  notes: DoqtriSnapshotNote[],
  graph: DoqtriGlobalMindmap = hub(notes.map((n) => n.doc_id)),
): DoqtriSnapshotV1 {
  return {
    hackathon_slug: "hack",
    snapshot_id: "s1",
    workspace_id: "w1",
    generated_at: DURING,
    notes,
    global_mindmap: graph,
  };
}

const FIVE = ["n1", "n2", "n3", "n4", "n5"];

function input(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    window: WINDOW,
    teamMemberIds: TEAM,
    snapshot: snapshot(),
    doqtri: doqtri(FIVE.map((id) => note(id))),
    hasGlobalMindmapImage: true,
    ...overrides,
  };
}

function rule(result: ReturnType<typeof checkEligibility>, id: EligibilityRuleId) {
  const r = result.rules.find((x) => x.id === id);
  if (!r) throw new Error(`rule ${id} missing`);
  return r;
}

describe("checkEligibility", () => {
  it("passes a complete entry and reports every rule in order", () => {
    const result = checkEligibility(input());
    expect(result.eligible).toBe(true);
    expect(result.rules.map((r) => r.id)).toEqual([...ELIGIBILITY_RULE_IDS]);
    expect(result.rules.every((r) => r.passed)).toBe(true);
  });

  const cases: Array<{
    name: string;
    rule: EligibilityRuleId;
    input: Partial<EligibilityInput>;
    passed: boolean;
    reason?: string;
  }> = [
    // team_size
    { name: "team of 3", rule: "team_size", input: { teamMemberIds: ["u1", "u2", "u3"] }, passed: true },
    { name: "team of 4", rule: "team_size", input: { teamMemberIds: ["u1", "u2", "u3", "u4"] }, passed: true },
    {
      name: "team of 2",
      rule: "team_size",
      input: { teamMemberIds: ["u1", "u2"] },
      passed: false,
      reason: "2 members; team must have 3–4",
    },
    {
      name: "team of 5",
      rule: "team_size",
      input: { teamMemberIds: ["u1", "u2", "u3", "u4", "u5"] },
      passed: false,
    },
    {
      name: "duplicate ids count once",
      rule: "team_size",
      input: { teamMemberIds: ["u1", "u1", "u2"] },
      passed: false,
    },

    // members_joined
    {
      name: "a team member outside the project",
      rule: "members_joined",
      input: { teamMemberIds: ["u1", "u2", "stranger"] },
      passed: false,
      reason: "2 of 3 team members joined the project",
    },

    // cards
    { name: "exactly 5 fully specified cards", rule: "cards", input: {}, passed: true },
    {
      name: "4 fully specified cards",
      rule: "cards",
      input: { snapshot: snapshot({ tasks: [...tasks(4), task(9, { assignee_id: null })] }) },
      passed: false,
      reason: "4 of 5 cards have owner, priority and due date",
    },
    {
      name: "a card assigned to someone outside the project does not count",
      rule: "cards",
      input: { snapshot: snapshot({ tasks: [...tasks(4), task(9, { assignee_id: "stranger" })] }) },
      passed: false,
      reason: "4 of 5 cards have owner, priority and due date",
    },
    {
      name: "a card without a due date does not count",
      rule: "cards",
      input: { snapshot: snapshot({ tasks: [...tasks(4), task(9, { due_date: null })] }) },
      passed: false,
    },

    // board_current
    {
      name: "nothing updated since the event opened",
      rule: "board_current",
      input: { snapshot: snapshot({ tasks: tasks(5, { updated_at: BEFORE }) }) },
      passed: false,
    },
    {
      name: "every card still in todo",
      rule: "board_current",
      input: { snapshot: snapshot({ tasks: tasks(5, { status: "todo" }) }) },
      passed: false,
      reason: "5 cards updated since the event opened, 0 out of todo",
    },
    {
      name: "an updated_at without an offset fails closed",
      rule: "board_current",
      input: {
        snapshot: snapshot({ tasks: tasks(5, { updated_at: "2026-11-20T12:00:00" }) }),
      },
      passed: false,
      reason: "0 cards updated since the event opened, 5 out of todo",
    },
    {
      name: "a card updated exactly at opens_at counts",
      rule: "board_current",
      input: {
        snapshot: snapshot({
          tasks: [...tasks(4, { updated_at: BEFORE }), task(9, { updated_at: WINDOW.opens_at })],
        }),
      },
      passed: true,
    },

    // notes_during_event
    {
      name: "null doqtri",
      rule: "notes_during_event",
      input: { doqtri: null },
      passed: false,
      reason: "No doqtri snapshot received",
    },
    {
      name: "a note created 1 s before opens_at is excluded",
      rule: "notes_during_event",
      input: {
        doqtri: doqtri([
          ...FIVE.slice(0, 4).map((id) => note(id)),
          note("early", { created_at: "2026-11-20T08:59:59.000Z" }),
        ]),
      },
      passed: false,
      reason: "4 of 5 notes written during the event",
    },
    {
      name: "notes created exactly at opens_at and closes_at count",
      rule: "notes_during_event",
      input: {
        doqtri: doqtri([
          ...FIVE.slice(0, 3).map((id) => note(id)),
          note("open", { created_at: WINDOW.opens_at }),
          note("close", { created_at: WINDOW.closes_at }),
        ]),
      },
      passed: true,
    },
    {
      name: "a note created 1 s after closes_at is excluded",
      rule: "notes_during_event",
      input: {
        doqtri: doqtri([
          ...FIVE.slice(0, 4).map((id) => note(id)),
          note("late", { created_at: "2026-11-21T17:00:01.000Z" }),
        ]),
      },
      passed: false,
    },
    {
      name: "a created_at without an offset fails closed",
      rule: "notes_during_event",
      input: {
        doqtri: doqtri([
          ...FIVE.slice(0, 4).map((id) => note(id)),
          note("local", { created_at: "2026-11-20T12:00:00.000" }),
        ]),
      },
      passed: false,
    },
    {
      name: "a created_at with a +08:00 offset is compared as an instant",
      rule: "notes_during_event",
      input: {
        doqtri: doqtri([
          ...FIVE.slice(0, 4).map((id) => note(id)),
          // 09:00 UTC, exactly opens_at.
          note("manila", { created_at: "2026-11-20T17:00:00+08:00" }),
        ]),
      },
      passed: true,
    },
    {
      name: "a duplicated doc_id counts once",
      rule: "notes_during_event",
      input: {
        doqtri: doqtri([...FIVE.slice(0, 4).map((id) => note(id)), note("n1")]),
      },
      passed: false,
      reason: "4 of 5 notes written during the event",
    },
    {
      name: "a template note is excluded",
      rule: "notes_during_event",
      input: {
        doqtri: doqtri([...FIVE.slice(0, 4).map((id) => note(id)), note("tpl", { source: "template" })]),
      },
      passed: false,
    },
    {
      name: "an imported note is excluded",
      rule: "notes_during_event",
      input: {
        doqtri: doqtri([...FIVE.slice(0, 4).map((id) => note(id)), note("imp", { source: "import" })]),
      },
      passed: false,
    },
    {
      name: "a note with no recorded source counts",
      rule: "notes_during_event",
      input: {
        doqtri: doqtri([...FIVE.slice(0, 4).map((id) => note(id)), note("old", { source: null })]),
      },
      passed: true,
    },

    // notes_connected
    {
      name: "null doqtri",
      rule: "notes_connected",
      input: { doqtri: null },
      passed: false,
      reason: "No doqtri snapshot received",
    },
    {
      name: "two disconnected clusters of 3",
      rule: "notes_connected",
      input: {
        doqtri: doqtri(
          ["a1", "a2", "a3", "b1", "b2", "b3"].map((id) => note(id)),
          {
            nodes: [
              ...hub(["a1", "a2", "a3"]).nodes,
              { id: "concept:other", label: "Other", kind: "concept", depth: 1, doc_ids: ["b1", "b2", "b3"] },
            ],
            links: hub(["a1", "a2", "a3"]).links,
          },
        ),
      },
      passed: false,
      reason: "3 of 5 event notes connected in the global mindmap",
    },
    {
      name: "notes joined only by links between their document nodes",
      rule: "notes_connected",
      input: {
        doqtri: doqtri(
          FIVE.map((id) => note(id)),
          {
            nodes: FIVE.map((id) => ({ id: `doc:${id}`, label: id, kind: "document", depth: 0, doc_ids: [id] })),
            links: FIVE.slice(1).map((id, i) => ({ source: `doc:${FIVE[i]}`, target: `doc:${id}` })),
          },
        ),
      },
      passed: true,
    },
    {
      name: "a template note in the cluster does not make up the count",
      rule: "notes_connected",
      input: {
        doqtri: doqtri([
          ...FIVE.slice(0, 4).map((id) => note(id)),
          note("tpl", { source: "template" }),
          note("lonely"),
        ], {
          nodes: [...hub([...FIVE.slice(0, 4), "tpl"]).nodes, { id: "doc:lonely", label: "x", kind: "document", depth: 0, doc_ids: ["lonely"] }],
          links: [],
        }),
      },
      passed: false,
      reason: "4 of 5 event notes connected in the global mindmap",
    },

    // global_mindmap_image
    {
      name: "no image",
      rule: "global_mindmap_image",
      input: { hasGlobalMindmapImage: false },
      passed: false,
      reason: "Global mindmap image missing",
    },
  ];

  it.each(cases)("$rule: $name", ({ rule: id, input: overrides, passed, reason }) => {
    const result = checkEligibility(input(overrides));
    const r = rule(result, id);
    expect(r.passed).toBe(passed);
    if (reason) expect(r.reason).toBe(reason);
    if (!passed) expect(result.eligible).toBe(false);
  });
});

describe("checkEligibility with a truncated snapshot", () => {
  it("marks failed qdit rules, and only those", () => {
    const result = checkEligibility(
      input({
        teamMemberIds: ["u1", "u2"],
        snapshot: snapshot({ truncated: true, tasks: tasks(4) }),
        doqtri: null,
      }),
    );
    expect(rule(result, "cards").reason).toBe(
      `4 of 5 cards have owner, priority and due date${TRUNCATED_SUFFIX}`,
    );
    // Passed qdit rule: unchanged.
    expect(rule(result, "board_current").reason).not.toContain(TRUNCATED_SUFFIX);
    expect(rule(result, "members_joined").reason).not.toContain(TRUNCATED_SUFFIX);
    // From the form, not the snapshot.
    expect(rule(result, "team_size").reason).not.toContain(TRUNCATED_SUFFIX);
    // doqtri rule.
    expect(rule(result, "notes_during_event").reason).toBe("No doqtri snapshot received");
  });

  it("leaves reasons alone when the snapshot is complete", () => {
    const result = checkEligibility(input({ snapshot: snapshot({ tasks: tasks(4) }) }));
    expect(rule(result, "cards").reason).toBe("4 of 5 cards have owner, priority and due date");
  });
});

describe("checkEligibility with an unreadable window", () => {
  it.each([
    ["opens_at without an offset", { opens_at: "2026-11-20T09:00:00" }],
    ["closes_at that is not a date", { closes_at: "Friday" }],
  ])("throws on %s", (_name, override) => {
    expect(() => checkEligibility(input({ window: { ...WINDOW, ...override } }))).toThrow(RangeError);
  });
});

describe("parseInstant", () => {
  it.each<[unknown, number | null]>([
    ["2026-11-20T09:00:00Z", Date.UTC(2026, 10, 20, 9)],
    ["2026-11-20T09:00:00.123456+00:00", Date.UTC(2026, 10, 20, 9, 0, 0, 123)],
    ["2026-11-20T17:00+08:00", Date.UTC(2026, 10, 20, 9)],
    ["2026-11-20T09:00:00-05:30", Date.UTC(2026, 10, 20, 14, 30)],
    ["2026-11-20T09:00:00", null],
    ["2026-11-20", null],
    ["2026-11-20 09:00:00Z", null],
    ["2026-11-20T09:00:00+0800", null],
    ["2026-13-45T09:00:00Z", null],
    ["", null],
    [null, null],
    [1763629200000, null],
  ])("%j → %s", (value, expected) => {
    expect(parseInstant(value)).toBe(expected);
  });
});

describe("qualifyingNotes", () => {
  it("drops notes whose created_at does not parse", () => {
    const d = doqtri([note("ok"), note("bad", { created_at: "not a date" })]);
    expect(qualifyingNotes(d, WINDOW).map((n) => n.doc_id)).toEqual(["ok"]);
  });
});

describe("largestConnectedNotes", () => {
  it("returns nothing for no notes", () => {
    expect(largestConnectedNotes(hub(["a"]), [])).toEqual([]);
  });

  it("connects through notes and nodes outside the counted set", () => {
    // a —doc:a— concept:x (a, t) — doc:t — concept:y (t, b) — b
    const graph: DoqtriGlobalMindmap = {
      nodes: [
        { id: "concept:x", label: "x", kind: "concept", depth: 1, doc_ids: ["a", "t"] },
        { id: "concept:y", label: "y", kind: "concept", depth: 1, doc_ids: ["t", "b"] },
      ],
      links: [],
    };
    expect(largestConnectedNotes(graph, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("ignores notes that appear in no node", () => {
    expect(largestConnectedNotes(hub(["a", "b"]), ["a", "b", "c"])).toEqual(["a", "b"]);
  });
});
