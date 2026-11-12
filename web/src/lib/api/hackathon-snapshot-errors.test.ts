import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  FIELD_HINTS,
  NO_HACKATHON,
  pushError,
  REVOKED_MESSAGE,
  SNAPSHOT_CONFLICTS,
} from "./hackathon-snapshot-errors";

/**
 * The route keys parts of its error mapping on message text from
 * `push_doqtri_hackathon_snapshot()`. Each string it matches must still be
 * in the migration verbatim, raised with the SQLSTATE the mapping expects,
 * so that rewording the SQL fails here instead of changing the answer.
 */
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../../supabase/migrations");
/**
 * Newest first, so `functionBody()` finds the definition in force:
 * 20261112140000 (QDIT-66) replaced the push's body, and
 * assert_hackathon_open() is still the one in 20261110100000.
 */
const sql = ["20261112140000_hackathon_mindmap_link.sql", "20261110100000_hackathons.sql"]
  .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
  .join("\n");

/** A SQL string literal for `text`, with `'` doubled. */
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** The body of the newest `create or replace function public.<name>(`, up to its closing `$$;`. */
function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is defined in the migration`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end);
}

/** `raise exception '<message>'` followed, in the same statement, by `errcode = '<code>'`. */
function raises(body: string, message: string, code: string): boolean {
  const pattern = new RegExp(
    `raise exception ${escape(literal(message))}[^;]*errcode = '${code}'`,
  );
  return pattern.test(body);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("the strings pushError matches are still the migration's", () => {
  const push = functionBody("push_doqtri_hackathon_snapshot");

  it("raises the revoked message with 42501", () => {
    expect(raises(push, REVOKED_MESSAGE, "42501")).toBe(true);
  });

  it("raises 'No such hackathon.' with P0002", () => {
    expect(raises(push, NO_HACKATHON, "P0002")).toBe(true);
  });

  it("raises snapshot_conflict and snapshot_limit with QD409", () => {
    expect(raises(push, "snapshot_conflict", "QD409")).toBe(true);
    expect(raises(push, "snapshot_limit", "QD409")).toBe(true);
  });

  it("raises hackathon_not_open and hackathon_closed with QD409, through assert_hackathon_open()", () => {
    expect(push).toContain("public.assert_hackathon_open(");
    const window = functionBody("assert_hackathon_open");
    expect(raises(window, "hackathon_not_open", "QD409")).toBe(true);
    expect(raises(window, "hackathon_closed", "QD409")).toBe(true);
  });

  it("covers every QD409 token the push can raise, and no others", () => {
    const tokens = new Set(
      [push, functionBody("assert_hackathon_open")].flatMap((body) =>
        [...body.matchAll(/raise exception '([a-z_]+)'[^;]*errcode = 'QD409'/g)].map((m) => m[1]),
      ),
    );
    expect([...tokens].sort()).toEqual(Object.keys(SNAPSHOT_CONFLICTS).sort());
  });

  it("raises 22023 with the hints the mapping names as request fields", () => {
    for (const hint of Object.keys(FIELD_HINTS)) {
      expect(push).toMatch(new RegExp(`errcode = '22023',\\s*hint = '${hint}'`));
    }
  });
});

describe("pushError", () => {
  it("maps each matched string as the route expects", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(pushError({ code: "42501", message: REVOKED_MESSAGE }).code).toBe("unauthorized");
    expect(pushError({ code: "42501", message: "Only doqtri can send hackathon snapshots." }).code).toBe("forbidden");
    expect(pushError({ code: "P0002", message: NO_HACKATHON }).message).toBe(NO_HACKATHON);
    expect(pushError({ code: "P0002", message: "No such project." }).message).toBe("No such project.");
    for (const reason of Object.keys(SNAPSHOT_CONFLICTS)) {
      expect(pushError({ code: "QD409", message: reason }).details).toEqual({ reason });
    }
    expect(pushError({ code: "QD409", message: "constructor" }).code).toBe("internal_error");
    expect(pushError({ code: "22023", message: "x", hint: "toString" }).code).toBe("internal_error");
    vi.restoreAllMocks();
  });
});
