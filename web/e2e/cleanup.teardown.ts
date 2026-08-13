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

/**
 * Deletes the accounts `wallet-auth.spec.ts` registers.
 *
 * A separate teardown because it is a different API. The rows above live in
 * PostgREST; an account lives in `auth.users`, which only the Auth admin API
 * can remove — and removing it is what cascades the profile away, since
 * `profiles.id references auth.users on delete cascade`.
 *
 * Matched on the `e2e-wallet-` email prefix rather than on ids collected during
 * the run, so a crashed run is cleaned up by the next one. That prefix is the
 * contract between the two files; changing it in one place breaks cleanup
 * silently, which is why it is stated in both.
 */
teardown("remove accounts created by the wallet registration specs", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    console.warn("[teardown] SUPABASE_SECRET_KEY not set — leaving e2e accounts in place.");
    return;
  }

  const headers = { apikey: secret, Authorization: `Bearer ${secret}` };

  // The admin list endpoint has no server-side filter, so the prefix match
  // happens here. 200 per page is its maximum and is far more than a run makes.
  const listed = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers });

  if (!listed.ok) {
    console.warn(
      `[teardown] could not list accounts: ${listed.status} ${await listed.text()}`,
    );
    return;
  }

  const { users } = (await listed.json()) as { users: { id: string; email?: string }[] };
  const mine = users.filter((user) => user.email?.startsWith("e2e-wallet-"));

  for (const user of mine) {
    const deleted = await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers,
    });

    if (!deleted.ok) {
      console.warn(
        `[teardown] could not delete ${user.email}: ${deleted.status} ${await deleted.text()}`,
      );
    }
  }

  if (mine.length > 0) {
    console.log(`[teardown] removed ${mine.length} e2e wallet account(s).`);
  }
});
