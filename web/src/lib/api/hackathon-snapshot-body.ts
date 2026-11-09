import { createHash } from "node:crypto";

import { isObject, type JsonObject } from "./body";

/**
 * The body of `POST /api/v1/projects/{id}/hackathon-snapshots` — contract
 * section 8 (v1.2.0, WP-4.7, D-117, D-118).
 *
 * Every rule of the contract's field list, checked by hand so that each
 * problem is reported at its own path (`notes[3].markdown`,
 * `global_mindmap.links[12].target`) and all of them at once, like every
 * other `/api/v1` body (`./body.ts`):
 *
 *   - a "character" is one Unicode code point (`[...s].length`, so an emoji
 *     is one), and a byte length is the length in UTF-8;
 *   - every field is present (nullable ones as `null`), and any other field
 *     is refused, at every level except inside a note's `mindmap`, which is
 *     stored as sent and whose inner shape qdit does not check;
 *   - `mindmap` is measured as the UTF-8 length of `JSON.stringify(mindmap)`
 *     (no whitespace), not as it was sent.
 *
 *   - every string is well-formed Unicode: a lone UTF-16 surrogate (which
 *     JSON's `\ud800` escape can carry, and which Postgres's jsonb refuses)
 *     is a 400 on its field, inside `mindmap` too;
 *   - `mindmap` nests at most 64 levels, checked without recursion before
 *     anything serializes it.
 *
 * The 2 MiB limit on the whole body is the route's (`readJsonBody`), checked
 * before this runs. An array over its count limit is reported once, on the
 * array, without looking inside it, and at most 50 problems are reported,
 * then a `"…"` marker, so a bad body cannot buy an answer as large as itself.
 *
 * Duplicate keys: JSON.parse keeps the last, and this checks (and the route
 * stores) that parsed object; the idempotency hash is over the raw bytes
 * (`./body.ts`).
 *
 * Pure: no Next, no Supabase.
 */

/** Section 4: the one body over 64 KiB (D-118). */
export const MAX_SNAPSHOT_BODY_BYTES = 2 * 1024 * 1024;

export const SNAPSHOT_LIMITS = {
  slugLength: 64,
  notes: 200,
  titleLength: 300,
  markdownBytes: 102_400,
  mindmapBytes: 65_536,
  mindmapDepth: 64,
  nodes: 5_000,
  nodeIdLength: 128,
  labelLength: 300,
  kindLength: 32,
  links: 20_000,
  /** Per node: never more than the notes sent, and never more than 200. */
  docIdsPerNode: 200,
  /** Problems reported in `details.fields` before the `"…"` marker. */
  problems: 50,
} as const;

/** The key `details.fields` carries when problems past the cap were left out. */
export const MORE_PROBLEMS_KEY = "…";

export const NOTE_SOURCES = ["editor", "template", "import"] as const;
export type NoteSource = (typeof NOTE_SOURCES)[number];

export type SnapshotNote = {
  doc_id: string;
  title: string;
  markdown: string;
  mindmap: JsonObject | null;
  created_at: string;
  updated_at: string;
  version: number | null;
  source: NoteSource | null;
};

export type SnapshotNode = { id: string; label: string; kind: string; depth: number; doc_ids: string[] };
export type SnapshotLink = { source: string; target: string };

export type HackathonSnapshot = {
  hackathon_slug: string;
  snapshot_id: string;
  workspace_id: string;
  generated_at: string;
  notes: SnapshotNote[];
  global_mindmap: { nodes: SnapshotNode[]; links: SnapshotLink[] };
};

export type SnapshotValidation =
  | {
      ok: true;
      /** The body itself, stored as sent. */
      snapshot: HackathonSnapshot;
      /** Lowercased, for the database's arguments. */
      snapshotId: string;
      workspaceId: string;
    }
  | { ok: false; fields: Record<string, string> };

const TOP_KEYS = ["hackathon_slug", "snapshot_id", "workspace_id", "generated_at", "notes", "global_mindmap"];
const NOTE_KEYS = ["doc_id", "title", "markdown", "mindmap", "created_at", "updated_at", "version", "source"];
const MAP_KEYS = ["nodes", "links"];
const NODE_KEYS = ["id", "label", "kind", "depth", "doc_ids"];
const LINK_KEYS = ["source", "target"];

const SLUG = /^[a-z0-9-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** RFC 3339 date-time (section 4: any offset, fractional seconds). */
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
/** DoqtriRegistry `Document.version` is a `u32`. */
const MAX_DOC_VERSION = 4_294_967_295;

/** Code points, as the contract counts characters. */
export function codePoints(value: string): number {
  return [...value].length;
}

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** Lowercase hex SHA-256: of the raw body for the idempotency key, of a note's markdown for the chain check. */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : data).digest("hex");
}

const NOT_WELL_FORMED = "must be well-formed Unicode (no lone surrogates)";

class Problems {
  /** Null prototype, so `constructor` or `__proto__` is a path like any other. */
  private readonly found: Record<string, string> = Object.create(null);
  private count = 0;
  private omitted = false;

  add(path: string, problem: string): void {
    if (Object.hasOwn(this.found, path)) return;
    if (this.count >= SNAPSHOT_LIMITS.problems) {
      this.omitted = true;
      return;
    }
    this.found[path] = problem;
    this.count += 1;
  }

  get fields(): Record<string, string> {
    const fields: Record<string, string> = Object.create(null);
    Object.assign(fields, this.found);
    if (this.omitted) fields[MORE_PROBLEMS_KEY] = "more problems omitted";
    return fields;
  }

  unknown(value: JsonObject, allowed: readonly string[], prefix: string): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) this.add(prefix + key, "unknown field");
    }
  }

  get any(): boolean {
    return this.count > 0;
  }
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = TIMESTAMP.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const offsetOk =
    match[7] === undefined || (Number(match[7]) <= 23 && Number(match[8]) <= 59);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 60 &&
    offsetOk
  );
}

function uuid(problems: Problems, path: string, value: unknown): string | undefined {
  if (value === undefined) return void problems.add(path, "is required");
  if (typeof value !== "string" || !UUID.test(value)) return void problems.add(path, "must be a UUID");
  return value.toLowerCase();
}

function timestamp(problems: Problems, path: string, value: unknown): void {
  if (value === undefined) return problems.add(path, "is required");
  if (!isTimestamp(value)) problems.add(path, "must be an RFC 3339 timestamp");
}

/** A string of at most `max` characters (and at least `min`). */
function text(problems: Problems, path: string, value: unknown, min: number, max: number): void {
  if (value === undefined) return problems.add(path, "is required");
  if (typeof value !== "string") return problems.add(path, "must be a string");
  if (!value.isWellFormed()) return problems.add(path, NOT_WELL_FORMED);
  const length = codePoints(value);
  if (length < min || length > max) {
    problems.add(path, min > 0 ? `must be ${min} to ${max} characters` : `must be at most ${max} characters`);
  }
}

/** An array of at most `max` elements, or undefined after adding a problem. */
function list(problems: Problems, path: string, value: unknown, max: number, noun: string): unknown[] | undefined {
  if (value === undefined) return void problems.add(path, "is required");
  if (!Array.isArray(value)) return void problems.add(path, "must be an array");
  if (value.length > max) return void problems.add(path, `must hold at most ${max.toLocaleString("en-US")} ${noun}`);
  return value;
}

/**
 * What is wrong with a note's mindmap, or null. Walked with an explicit
 * stack, so no depth of nesting can overflow the call stack, and only then
 * serialized to be measured.
 */
function mindmapProblem(mindmap: JsonObject): string | null {
  const stack: [value: unknown, depth: number][] = [[mindmap, 1]];
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!;
    if (typeof value === "string") {
      if (!value.isWellFormed()) return NOT_WELL_FORMED;
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    if (depth > SNAPSHOT_LIMITS.mindmapDepth) return "must nest at most 64 levels";
    if (Array.isArray(value)) {
      for (const item of value) stack.push([item, depth + 1]);
    } else {
      for (const [key, item] of Object.entries(value)) {
        if (!key.isWellFormed()) return NOT_WELL_FORMED;
        stack.push([item, depth + 1]);
      }
    }
  }

  let json: string;
  try {
    json = JSON.stringify(mindmap);
  } catch {
    return "must be serializable as JSON";
  }
  return utf8Bytes(json) > SNAPSHOT_LIMITS.mindmapBytes ? "must be at most 65,536 bytes as JSON" : null;
}

function checkNote(problems: Problems, path: string, value: unknown): string | undefined {
  if (!isObject(value)) return void problems.add(path, "must be an object");
  const at = `${path}.`;
  problems.unknown(value, NOTE_KEYS, at);

  const docId = uuid(problems, `${at}doc_id`, value.doc_id);
  text(problems, `${at}title`, value.title, 0, SNAPSHOT_LIMITS.titleLength);

  if (value.markdown === undefined) problems.add(`${at}markdown`, "is required");
  else if (typeof value.markdown !== "string") problems.add(`${at}markdown`, "must be a string");
  else if (!value.markdown.isWellFormed()) problems.add(`${at}markdown`, NOT_WELL_FORMED);
  else if (utf8Bytes(value.markdown) > SNAPSHOT_LIMITS.markdownBytes) {
    problems.add(`${at}markdown`, "must be at most 102,400 bytes in UTF-8");
  }

  // Its shape is not checked: stored as sent (the unknown-field rule stops
  // here). Only its nesting, its strings and its size.
  if (value.mindmap === undefined) problems.add(`${at}mindmap`, "is required");
  else if (value.mindmap !== null && !isObject(value.mindmap)) {
    problems.add(`${at}mindmap`, "must be a JSON object or null");
  } else if (value.mindmap !== null) {
    const problem = mindmapProblem(value.mindmap);
    if (problem) problems.add(`${at}mindmap`, problem);
  }

  timestamp(problems, `${at}created_at`, value.created_at);
  timestamp(problems, `${at}updated_at`, value.updated_at);

  const version = value.version;
  if (version === undefined) problems.add(`${at}version`, "is required");
  else if (
    version !== null &&
    (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > MAX_DOC_VERSION)
  ) {
    problems.add(`${at}version`, "must be an integer from 1 to 4294967295, or null");
  }

  const source = value.source;
  if (source === undefined) problems.add(`${at}source`, "is required");
  else if (source !== null && !NOTE_SOURCES.includes(source as NoteSource)) {
    problems.add(`${at}source`, "must be editor, template, import or null");
  }

  return docId;
}

function checkMindmap(
  problems: Problems,
  value: unknown,
  docIds: ReadonlySet<string> | null,
  noteCount: number | null,
): void {
  const path = "global_mindmap";
  const maxDocIds = Math.min(SNAPSHOT_LIMITS.docIdsPerNode, noteCount ?? SNAPSHOT_LIMITS.docIdsPerNode);
  if (value === undefined) return problems.add(path, "is required");
  if (!isObject(value)) return problems.add(path, "must be an object");
  problems.unknown(value, MAP_KEYS, `${path}.`);

  const nodeIds = new Set<string>();
  const nodes = list(problems, `${path}.nodes`, value.nodes, SNAPSHOT_LIMITS.nodes, "nodes");
  nodes?.forEach((node, i) => {
    const at = `${path}.nodes[${i}]`;
    if (!isObject(node)) return problems.add(at, "must be an object");
    problems.unknown(node, NODE_KEYS, `${at}.`);

    text(problems, `${at}.id`, node.id, 1, SNAPSHOT_LIMITS.nodeIdLength);
    if (typeof node.id === "string") {
      if (nodeIds.has(node.id)) problems.add(`${at}.id`, "must be unique within nodes");
      nodeIds.add(node.id);
    }
    text(problems, `${at}.label`, node.label, 0, SNAPSHOT_LIMITS.labelLength);
    text(problems, `${at}.kind`, node.kind, 1, SNAPSHOT_LIMITS.kindLength);

    if (node.depth === undefined) problems.add(`${at}.depth`, "is required");
    else if (typeof node.depth !== "number" || !Number.isSafeInteger(node.depth) || node.depth < 0) {
      problems.add(`${at}.depth`, "must be an integer >= 0");
    }

    // At most one per note sent, and never more than 200 (refused on the
    // array, unread past that).
    if (node.doc_ids === undefined) problems.add(`${at}.doc_ids`, "is required");
    else if (!Array.isArray(node.doc_ids)) problems.add(`${at}.doc_ids`, "must be an array");
    else if (node.doc_ids.length > maxDocIds) problems.add(`${at}.doc_ids`, `must hold at most ${maxDocIds} doc_ids`);
    else {
      node.doc_ids.forEach((id, j) => {
        const idAt = `${at}.doc_ids[${j}]`;
        if (typeof id !== "string" || !UUID.test(id)) problems.add(idAt, "must be a UUID");
        // Only when the notes themselves were readable; otherwise the problem is theirs.
        else if (docIds && !docIds.has(id.toLowerCase())) problems.add(idAt, "must be the doc_id of a note in notes");
      });
    }
  });

  const links = list(problems, `${path}.links`, value.links, SNAPSHOT_LIMITS.links, "links");
  links?.forEach((link, i) => {
    const at = `${path}.links[${i}]`;
    if (!isObject(link)) return problems.add(at, "must be an object");
    problems.unknown(link, LINK_KEYS, `${at}.`);
    for (const end of LINK_KEYS) {
      const id = link[end];
      if (id === undefined) problems.add(`${at}.${end}`, "is required");
      else if (typeof id !== "string") problems.add(`${at}.${end}`, "must be a string");
      else if (!id.isWellFormed()) problems.add(`${at}.${end}`, NOT_WELL_FORMED);
      // Only against a node list that was read; a refused list is its own problem.
      else if (nodes && !nodeIds.has(id)) problems.add(`${at}.${end}`, "must be the id of a node in nodes");
    }
  });
}

/** Checks a parsed body against the contract; every problem at once. */
export function validateHackathonSnapshot(body: JsonObject): SnapshotValidation {
  const problems = new Problems();
  problems.unknown(body, TOP_KEYS, "");

  const slug = body.hackathon_slug;
  if (slug === undefined) problems.add("hackathon_slug", "is required");
  else if (typeof slug !== "string" || codePoints(slug) < 1 || codePoints(slug) > SNAPSHOT_LIMITS.slugLength || !SLUG.test(slug)) {
    problems.add("hackathon_slug", "must be 1 to 64 of a-z, 0-9 and -");
  }

  const snapshotId = uuid(problems, "snapshot_id", body.snapshot_id);
  const workspaceId = uuid(problems, "workspace_id", body.workspace_id);
  timestamp(problems, "generated_at", body.generated_at);

  let docIds: Set<string> | null = null;
  const notes = list(problems, "notes", body.notes, SNAPSHOT_LIMITS.notes, "notes");
  if (notes) {
    const seen = new Set<string>();
    let unreadable = false;
    notes.forEach((note, i) => {
      const docId = checkNote(problems, `notes[${i}]`, note);
      if (docId === undefined) return void (unreadable = true);
      if (seen.has(docId)) problems.add(`notes[${i}].doc_id`, "must appear at most once in notes");
      seen.add(docId);
    });
    // The map's doc_ids are held to the notes only when every note's doc_id
    // was readable; otherwise that note's problem is the one to report.
    if (!unreadable) docIds = seen;
  }

  checkMindmap(problems, body.global_mindmap, docIds, notes ? notes.length : null);

  if (problems.any) return { ok: false, fields: problems.fields };

  return {
    ok: true,
    snapshot: body as unknown as HackathonSnapshot,
    snapshotId: snapshotId!,
    workspaceId: workspaceId!,
  };
}
