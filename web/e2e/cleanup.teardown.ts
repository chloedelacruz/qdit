import { test as teardown } from "@playwright/test";

/**
 * Deletes the rows the write-path specs create.
 *
 * Runs in Node, never in the browser, so the secret key stays server-side. It
 * matches on an `e2e ` prefix rather than tracking ids, which means a run that
 * crashed part-way through still gets cleaned up on the next one.
 *
 * Missing credentials are a warning, not a failure: the read-only specs are
 * still worth running without a secret key, and failing the suite here would
 * hide their result.
 */

/**
 * Children first, then projects.
 *
 * Deleting a project cascades to everything inside it, so the order only
 * matters for the reporting — a cascade would otherwise remove rows this has
 * not counted yet and the log would undercount what it cleaned up.
 */
const TARGETS = [
  { table: "tasks", column: "title", noun: "task" },
  { table: "milestones", column: "title", noun: "milestone" },
  { table: "stellar_proofs", column: "notes", noun: "proof" },
  { table: "deployments", column: "release_notes", noun: "deployment" },
  { table: "projects", column: "name", noun: "project" },
] as const;

teardown("remove rows created by the write-path specs", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    console.warn("[teardown] SUPABASE_SECRET_KEY not set — leaving e2e rows in place.");
    return;
  }

  for (const { table, column, noun } of TARGETS) {
    // PostgREST `like` uses `*` as the wildcard, and the prefix is spelled the
    // same way every spec spells it: `e2e <noun> …`.
    const filter = `${column}=like.e2e%20${noun}%20*`;

    const response = await fetch(`${url}/rest/v1/${table}?${filter}`, {
      method: "DELETE",
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        Prefer: "return=representation",
      },
    });

    if (!response.ok) {
      console.warn(
        `[teardown] ${table} cleanup failed: ${response.status} ${await response.text()}`,
      );
      continue;
    }

    const removed = (await response.json()) as unknown[];
    if (removed.length > 0) {
      console.log(`[teardown] removed ${removed.length} e2e ${noun}(s).`);
    }
  }
});
