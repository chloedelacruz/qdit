import { describe, expect, it } from "vitest";

import { SNAPSHOT_DOC, SNAPSHOT_DOC_2, snapshotBody, snapshotNote as note } from "@/test/api-fixtures";

import {
  codePoints,
  MORE_PROBLEMS_KEY,
  sha256Hex,
  SNAPSHOT_LIMITS,
  validateHackathonSnapshot,
  type SnapshotValidation,
} from "./hackathon-snapshot-body";

/**
 * The snapshot body rules of contract section 8 (v1.2.0, D-117, D-118):
 * every field, every limit at and past its edge, the unknown-field rule at
 * each level and not inside `mindmap`, and characters counted as code points.
 */

const DOC_2 = SNAPSHOT_DOC_2;
const DOC = SNAPSHOT_DOC;

const fieldsOf = (result: SnapshotValidation) => {
  expect(result.ok).toBe(false);
  return result.ok ? {} : result.fields;
};

const map = (nodes: unknown[], links: unknown[] = []) => ({ global_mindmap: { nodes, links } });
const node = (overrides: Record<string, unknown> = {}) => ({
  id: "n",
  label: "L",
  kind: "concept",
  depth: 0,
  doc_ids: [DOC],
  ...overrides,
});

describe("validateHackathonSnapshot: the contract's example", () => {
  it("accepts it as sent, with lowercased ids for the database", () => {
    const body = snapshotBody({ snapshot_id: "4E7D2C1B-9A8F-4B6E-8D5C-3F2A1E0D9C8B" });
    const result = validateHackathonSnapshot(body);
    expect(result).toEqual({
      ok: true,
      snapshot: body,
      snapshotId: "4e7d2c1b-9a8f-4b6e-8d5c-3f2a1e0d9c8b",
      workspaceId: "6b5a4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d",
    });
  });

  it("accepts no notes and an empty map", () => {
    expect(validateHackathonSnapshot(snapshotBody({ notes: [], ...map([]) })).ok).toBe(true);
  });

  it("accepts the nullable fields as null and an empty title", () => {
    const body = snapshotBody({ notes: [note({ mindmap: null, version: null, source: null, title: "" })] });
    expect(validateHackathonSnapshot(body).ok).toBe(true);
  });

  it.each(["template", "import"])("accepts source %s", (source) => {
    expect(validateHackathonSnapshot(snapshotBody({ notes: [note({ source })] })).ok).toBe(true);
  });
});

describe("validateHackathonSnapshot: required fields", () => {
  it.each(["hackathon_slug", "snapshot_id", "workspace_id", "generated_at", "notes", "global_mindmap"])(
    "refuses a body without %s",
    (key) => {
      const body: Record<string, unknown> = snapshotBody();
      delete body[key];
      expect(fieldsOf(validateHackathonSnapshot(body))).toEqual({ [key]: "is required" });
    },
  );

  it.each(["doc_id", "title", "markdown", "mindmap", "created_at", "updated_at", "version", "source"])(
    "refuses a note without %s (optional fields are present as null)",
    (key) => {
      const n: Record<string, unknown> = note();
      delete n[key];
      expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [n] })))).toEqual({
        [`notes[0].${key}`]: "is required",
      });
    },
  );

  it.each(["id", "label", "kind", "depth", "doc_ids"])("refuses a node without %s", (key) => {
    const n: Record<string, unknown> = node();
    delete n[key];
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody(map([n]))))).toEqual({
      [`global_mindmap.nodes[0].${key}`]: "is required",
    });
  });

  it("refuses a map without nodes or links, and a link without an end", () => {
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ global_mindmap: {} })))).toEqual({
      "global_mindmap.nodes": "is required",
      "global_mindmap.links": "is required",
    });
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody(map([node()], [{ source: "n" }]))))).toEqual({
      "global_mindmap.links[0].target": "is required",
    });
  });
});

describe("validateHackathonSnapshot: unknown fields", () => {
  it("refuses one at every level, by its path", () => {
    const body = snapshotBody({
      extra: 1,
      notes: [note(), note({ doc_id: DOC_2, colour: "red" })],
      global_mindmap: {
        nodes: [node({ weight: 2 }), node({ id: "m", doc_ids: [DOC_2] })],
        links: [{ source: "n", target: "m" }, { source: "m", target: "n", label: "x" }],
        layout: "force",
      },
    });
    expect(fieldsOf(validateHackathonSnapshot(body))).toEqual({
      extra: "unknown field",
      "notes[1].colour": "unknown field",
      "global_mindmap.layout": "unknown field",
      "global_mindmap.nodes[0].weight": "unknown field",
      "global_mindmap.links[1].label": "unknown field",
    });
  });

  it("does not look inside a note's mindmap", () => {
    const mindmap = { whatever: [1, 2, { deep: { keys: "anything" } }], edges: null, "": 0 };
    expect(validateHackathonSnapshot(snapshotBody({ notes: [note({ mindmap })] })).ok).toBe(true);
  });
});

describe("validateHackathonSnapshot: top-level values", () => {
  it.each([
    ["", "hackathon_slug"],
    ["a".repeat(65), "hackathon_slug"],
    ["Stellar-Build", "hackathon_slug"],
    ["stellar_build", "hackathon_slug"],
    [7, "hackathon_slug"],
  ])("refuses hackathon_slug %j", (slug, field) => {
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ hackathon_slug: slug })))).toEqual({
      [field]: "must be 1 to 64 of a-z, 0-9 and -",
    });
  });

  it("accepts a 64-character slug", () => {
    expect(validateHackathonSnapshot(snapshotBody({ hackathon_slug: "a".repeat(64) })).ok).toBe(true);
  });

  it("refuses ids that are not UUIDs", () => {
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ snapshot_id: "4e7d2c1b", workspace_id: null })))).toEqual({
      snapshot_id: "must be a UUID",
      workspace_id: "must be a UUID",
    });
  });

  it.each(["2026-11-20", "2026-11-20 15:04:05Z", "2026-02-30T00:00:00Z", "2026-11-20T15:04:05", "yesterday", 1792843200])(
    "refuses generated_at %j",
    (value) => {
      expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ generated_at: value })))).toEqual({
        generated_at: "must be an RFC 3339 timestamp",
      });
    },
  );

  it.each(["2026-11-20T15:04:05Z", "2026-11-20T15:04:05.123456789-07:30", "2026-11-20t15:04:05z"])(
    "accepts generated_at %s (any offset, fractional seconds)",
    (value) => {
      expect(validateHackathonSnapshot(snapshotBody({ generated_at: value })).ok).toBe(true);
    },
  );

  it("refuses notes and the map of the wrong type", () => {
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: {}, global_mindmap: [] })))).toEqual({
      notes: "must be an array",
      global_mindmap: "must be an object",
    });
  });
});

describe("validateHackathonSnapshot: notes", () => {
  it("takes 200 notes and refuses 201, once, on the array", () => {
    const notes = (n: number) =>
      Array.from({ length: n }, (_, i) => note({ doc_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    expect(validateHackathonSnapshot(snapshotBody({ notes: notes(200), ...map([]) })).ok).toBe(true);
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: notes(201), ...map([]) })))).toEqual({
      notes: "must hold at most 200 notes",
    });
  });

  it("refuses a note that is not an object", () => {
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [note(), "x"] })))).toEqual({
      "notes[1]": "must be an object",
    });
  });

  it("refuses a doc_id sent twice, in any case", () => {
    const body = snapshotBody({ notes: [note(), note({ doc_id: DOC.toUpperCase() })] });
    expect(fieldsOf(validateHackathonSnapshot(body))).toEqual({ "notes[1].doc_id": "must appear at most once in notes" });
  });

  it("counts title characters as code points: 300 emoji pass, 301 do not", () => {
    const emoji = "\u{1F680}"; // two UTF-16 units, four UTF-8 bytes, one character
    expect(codePoints(emoji.repeat(300))).toBe(300);
    expect(emoji.repeat(300).length).toBe(600);
    expect(validateHackathonSnapshot(snapshotBody({ notes: [note({ title: emoji.repeat(300) })] })).ok).toBe(true);
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [note({ title: emoji.repeat(301) })] })))).toEqual({
      "notes[0].title": "must be at most 300 characters",
    });
  });

  it("measures markdown in UTF-8 bytes: 102,400 pass, one more does not", () => {
    const exact = "€".repeat(34_133) + "a"; // 3 * 34,133 + 1 = 102,400 bytes
    expect(validateHackathonSnapshot(snapshotBody({ notes: [note({ markdown: exact })] })).ok).toBe(true);
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [note({ markdown: exact + "a" })] })))).toEqual({
      "notes[0].markdown": "must be at most 102,400 bytes in UTF-8",
    });
    // Under 102,400 code points, over 102,400 bytes.
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [note({ markdown: "€".repeat(34_134) })] })))).toEqual({
      "notes[0].markdown": "must be at most 102,400 bytes in UTF-8",
    });
  });

  it("measures mindmap as the UTF-8 bytes of JSON.stringify, not as sent", () => {
    // {"t":"..."} is 8 bytes of punctuation and key around the string.
    const exact = { t: "x".repeat(SNAPSHOT_LIMITS.mindmapBytes - 8) };
    expect(Buffer.byteLength(JSON.stringify(exact))).toBe(65_536);
    expect(validateHackathonSnapshot(snapshotBody({ notes: [note({ mindmap: exact })] })).ok).toBe(true);

    const over = { t: "x".repeat(SNAPSHOT_LIMITS.mindmapBytes - 7) };
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [note({ mindmap: over })] })))).toEqual({
      "notes[0].mindmap": "must be at most 65,536 bytes as JSON",
    });

    const emoji = { t: "\u{1F680}".repeat(16_382) }; // 8 + 4 * 16,382 = 65,536
    expect(validateHackathonSnapshot(snapshotBody({ notes: [note({ mindmap: emoji })] })).ok).toBe(true);
  });

  it.each([[[1, 2]], ["map"], [3]])("refuses a mindmap of %j", (mindmap) => {
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [note({ mindmap })] })))).toEqual({
      "notes[0].mindmap": "must be a JSON object or null",
    });
  });

  it.each([0, -1, 1.5, "3", 4_294_967_296])("refuses version %j", (version) => {
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [note({ version })] })))).toEqual({
      "notes[0].version": "must be an integer from 1 to 4294967295, or null",
    });
  });

  it("accepts version 1 and the u32 maximum", () => {
    expect(validateHackathonSnapshot(snapshotBody({ notes: [note({ version: 1 })] })).ok).toBe(true);
    expect(validateHackathonSnapshot(snapshotBody({ notes: [note({ version: 4_294_967_295 })] })).ok).toBe(true);
  });

  it("refuses other values for source, title, markdown and the timestamps", () => {
    const body = snapshotBody({
      notes: [note({ source: "paste", title: null, markdown: 5, created_at: "now", updated_at: null })],
    });
    expect(fieldsOf(validateHackathonSnapshot(body))).toEqual({
      "notes[0].source": "must be editor, template, import or null",
      "notes[0].title": "must be a string",
      "notes[0].markdown": "must be a string",
      "notes[0].created_at": "must be an RFC 3339 timestamp",
      "notes[0].updated_at": "must be an RFC 3339 timestamp",
    });
  });
});

describe("validateHackathonSnapshot: global_mindmap", () => {
  it("takes 5,000 nodes and refuses 5,001", () => {
    const nodes = (n: number) => Array.from({ length: n }, (_, i) => node({ id: `n${i}` }));
    expect(validateHackathonSnapshot(snapshotBody(map(nodes(5_000)))).ok).toBe(true);
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody(map(nodes(5_001)))))).toEqual({
      "global_mindmap.nodes": "must hold at most 5,000 nodes",
    });
  });

  it("takes 20,000 links and refuses 20,001", () => {
    const links = (n: number) => Array.from({ length: n }, () => ({ source: "n", target: "n" }));
    expect(validateHackathonSnapshot(snapshotBody(map([node()], links(20_000)))).ok).toBe(true);
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody(map([node()], links(20_001)))))).toEqual({
      "global_mindmap.links": "must hold at most 20,000 links",
    });
  });

  it("holds node ids to 1 to 128 characters, unique; labels to 300; kinds to 1 to 32", () => {
    const emoji = "\u{1F9E0}";
    const ok = map([node({ id: emoji.repeat(128), label: emoji.repeat(300), kind: emoji.repeat(32) })]);
    expect(validateHackathonSnapshot(snapshotBody(ok)).ok).toBe(true);

    const body = snapshotBody(
      map([
        node({ id: "" }),
        node({ id: emoji.repeat(129) }),
        node({ id: "a", label: "x".repeat(301) }),
        node({ id: "a", kind: "" }),
        node({ id: "b", kind: "k".repeat(33) }),
      ]),
    );
    expect(fieldsOf(validateHackathonSnapshot(body))).toEqual({
      "global_mindmap.nodes[0].id": "must be 1 to 128 characters",
      "global_mindmap.nodes[1].id": "must be 1 to 128 characters",
      "global_mindmap.nodes[2].label": "must be at most 300 characters",
      "global_mindmap.nodes[3].id": "must be unique within nodes",
      "global_mindmap.nodes[3].kind": "must be 1 to 32 characters",
      "global_mindmap.nodes[4].kind": "must be 1 to 32 characters",
    });
  });

  it("holds depth to an integer >= 0", () => {
    const body = snapshotBody(map([node({ id: "a", depth: -1 }), node({ id: "b", depth: 0.5 }), node({ id: "c", depth: "1" })]));
    expect(fieldsOf(validateHackathonSnapshot(body))).toEqual({
      "global_mindmap.nodes[0].depth": "must be an integer >= 0",
      "global_mindmap.nodes[1].depth": "must be an integer >= 0",
      "global_mindmap.nodes[2].depth": "must be an integer >= 0",
    });
  });

  it("holds doc_ids to the notes sent", () => {
    const body = snapshotBody(
      map([node({ doc_ids: [DOC_2] }), node({ id: "m", doc_ids: "x" }), node({ id: "o", doc_ids: ["nope"] })]),
    );
    expect(fieldsOf(validateHackathonSnapshot(body))).toEqual({
      "global_mindmap.nodes[0].doc_ids[0]": "must be the doc_id of a note in notes",
      "global_mindmap.nodes[1].doc_ids": "must be an array",
      "global_mindmap.nodes[2].doc_ids[0]": "must be a UUID",
    });
  });

  it("holds link ends to the nodes sent", () => {
    const body = snapshotBody(map([node()], [{ source: "n", target: "ghost" }, { source: 3, target: "n" }, "x"]));
    expect(fieldsOf(validateHackathonSnapshot(body))).toEqual({
      "global_mindmap.links[0].target": "must be the id of a node in nodes",
      "global_mindmap.links[1].source": "must be a string",
      "global_mindmap.links[2]": "must be an object",
    });
  });
});

describe("sha256Hex", () => {
  it("is the lowercase hex SHA-256 of the UTF-8 bytes", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(new TextEncoder().encode("€"))).toBe(sha256Hex("€"));
  });
});

describe("validateHackathonSnapshot: review hardening", () => {
  const LONE = "\ud800";

  it.each([
    ["notes[0].title", { notes: [note({ title: `a${LONE}b` })] }],
    ["notes[0].markdown", { notes: [note({ markdown: `# x\udc00` })] }],
    ["global_mindmap.nodes[0].id", map([node({ id: LONE })])],
    ["global_mindmap.nodes[0].label", map([node({ label: LONE })])],
    ["global_mindmap.nodes[0].kind", map([node({ kind: LONE })])],
    ["global_mindmap.links[0].source", map([node()], [{ source: LONE, target: "n" }])],
    ["notes[0].mindmap", { notes: [note({ mindmap: { deep: [{ text: LONE }] } })] }],
    ["notes[0].mindmap", { notes: [note({ mindmap: { [LONE]: 1 } })] }],
  ])("refuses a lone surrogate on %s", (field, overrides) => {
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody(overrides)))).toEqual({
      [field]: "must be well-formed Unicode (no lone surrogates)",
    });
  });

  it("refuses lone surrogates in the regex-held fields by their own rule", () => {
    const fields = fieldsOf(
      validateHackathonSnapshot(snapshotBody({ hackathon_slug: LONE, snapshot_id: LONE, generated_at: LONE })),
    );
    expect(Object.keys(fields).sort()).toEqual(["generated_at", "hackathon_slug", "snapshot_id"]);
  });

  it("accepts a well-formed surrogate pair (an emoji)", () => {
    expect(validateHackathonSnapshot(snapshotBody({ notes: [note({ title: "\ud83d\ude80" })] })).ok).toBe(true);
  });

  const nested = (levels: number) => {
    let value: Record<string, unknown> = {};
    for (let i = 1; i < levels; i++) value = { c: value };
    return value;
  };

  it("takes a mindmap 64 levels deep and refuses 65", () => {
    expect(validateHackathonSnapshot(snapshotBody({ notes: [note({ mindmap: nested(64) })] })).ok).toBe(true);
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [note({ mindmap: nested(65) })] })))).toEqual({
      "notes[0].mindmap": "must nest at most 64 levels",
    });
    const arrays = { a: JSON.parse("[".repeat(64) + "]".repeat(64)) };
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [note({ mindmap: arrays })] })))).toEqual({
      "notes[0].mindmap": "must nest at most 64 levels",
    });
  });

  it("walks a very deep mindmap without overflowing the stack", () => {
    const deep = JSON.parse(`{"a":${"[".repeat(200_000)}${"]".repeat(200_000)}}`);
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [note({ mindmap: deep })] })))).toEqual({
      "notes[0].mindmap": "must nest at most 64 levels",
    });
  });

  it("refuses a mindmap that JSON.stringify throws on, rather than failing", () => {
    // Not reachable from a parsed body; the guard is for a future caller.
    const mindmap = { n: BigInt(1) } as unknown as Record<string, unknown>;
    expect(fieldsOf(validateHackathonSnapshot(snapshotBody({ notes: [note({ mindmap })] })))).toEqual({
      "notes[0].mindmap": "must be serializable as JSON",
    });
  });

  it("holds a node's doc_ids to the number of notes sent, without reading past it", () => {
    const body = snapshotBody({
      notes: [note(), note({ doc_id: DOC_2 })],
      ...map([node({ doc_ids: [DOC, DOC_2] }), node({ id: "m", doc_ids: [DOC, DOC_2, DOC] })]),
    });
    expect(fieldsOf(validateHackathonSnapshot(body))).toEqual({
      "global_mindmap.nodes[1].doc_ids": "must hold at most 2 doc_ids",
    });
  });

  it("holds a node's doc_ids to 200 even when the notes could not be read", () => {
    const body = snapshotBody({
      notes: "not a list",
      ...map([node({ doc_ids: Array.from({ length: 201 }, () => DOC) })]),
    });
    expect(fieldsOf(validateHackathonSnapshot(body))).toMatchObject({
      "global_mindmap.nodes[0].doc_ids": "must hold at most 200 doc_ids",
    });
  });

  it("reports at most 50 problems, then a marker", () => {
    const links = Array.from({ length: 80 }, () => ({ source: "ghost", target: "n" }));
    const fields = fieldsOf(validateHackathonSnapshot(snapshotBody(map([node()], links))));
    expect(Object.keys(fields)).toHaveLength(51);
    expect(fields[MORE_PROBLEMS_KEY]).toBe("more problems omitted");
    expect(fields["global_mindmap.links[49].source"]).toBeDefined();
    expect(fields["global_mindmap.links[50].source"]).toBeUndefined();
  });

  it("does not add the marker at exactly 50 problems", () => {
    const links = Array.from({ length: 50 }, () => ({ source: "ghost", target: "n" }));
    const fields = fieldsOf(validateHackathonSnapshot(snapshotBody(map([node()], links))));
    expect(Object.keys(fields)).toHaveLength(50);
    expect(fields[MORE_PROBLEMS_KEY]).toBeUndefined();
  });

  it.each(["__proto__", "constructor", "toString"])("records an unknown %s key at every level", (key) => {
    const raw = JSON.stringify(snapshotBody({ notes: [note()], ...map([node({ doc_ids: [DOC] })], [{ source: "n", target: "n" }]) }));
    const body = JSON.parse(raw);
    for (const target of [body, body.notes[0], body.global_mindmap, body.global_mindmap.nodes[0], body.global_mindmap.links[0]]) {
      Object.defineProperty(target, key, { value: 1, enumerable: true, configurable: true, writable: true });
    }
    expect(fieldsOf(validateHackathonSnapshot(body))).toEqual({
      [key]: "unknown field",
      [`notes[0].${key}`]: "unknown field",
      [`global_mindmap.${key}`]: "unknown field",
      [`global_mindmap.nodes[0].${key}`]: "unknown field",
      [`global_mindmap.links[0].${key}`]: "unknown field",
    });
  });

  it("keeps the last of duplicate keys, as JSON.parse does", () => {
    const raw = JSON.stringify(snapshotBody()).replace('"hackathon_slug":', '"hackathon_slug":"BAD SLUG","hackathon_slug":');
    const result = validateHackathonSnapshot(JSON.parse(raw));
    expect(result.ok && result.snapshot.hackathon_slug).toBe("stellar-build-2026");
  });
});
