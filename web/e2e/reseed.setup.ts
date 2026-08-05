import { expect, test as setup } from "@playwright/test";

import { PROJECT, SEEDED_TASKS } from "./seed";

/**
 * Puts the seeded tasks back in the columns `seed.ts` says they belong in.
 *
 * The suite runs against a hosted Supabase project, not a local stack — there
 * is no `supabase db reset` between runs, and `seed.sql` is deliberately never
 * applied to it (it ships a password). The seeded rows are therefore a
 * snapshot that has been sitting there since it was created, and anything that
 * moves one moves it permanently.
 *
 * `cleanup.teardown.ts` covers the other half of this: it *deletes* the rows
 * the write specs create. It cannot restore a seeded row that was mutated
 * rather than added, and mutating one does not need a spec — dragging a card
 * by hand while developing the board does it, which is how `Build the task
 * board` ended up in In Progress and left four specs red across two files.
 *
 * Runs in Node, never the browser, so the secret key stays server-side.
 *
 * Only `status` is restored, because that is the field a stray drag moves and
 * the field `BOARD_COUNTS` counts. Title, assignee and milestone are only
 * reachable through a dialog nobody opens by accident.
 */

// `fullyParallel` would otherwise let these two run in separate workers. They
// touch disjoint rows, so it is ordering for legibility rather than a race:
// the sweep is what makes the restore's "exactly one row" check meaningful.
setup.describe.configure({ mode: "serial" });

function credentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    // A warning rather than a failure, matching the teardown: without a secret
    // key the read-only specs are still worth running, and failing here would
    // bury their result under a setup error.
    console.warn("[reseed] SUPABASE_SECRET_KEY not set — seeded rows left as they are.");
    return null;
  }

  return {
    url,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  };
}

/**
 * Removes tasks the seeded project is not supposed to contain.
 *
 * `cleanup.teardown.ts` only deletes what matches the `e2e ` prefix every
 * write spec uses, which is the right rule for rows the suite created and no
 * help at all for a row a human created. A task called `123`, typed into the
 * New task dialog while checking something by hand, is invisible to it — and
 * it broke two board specs and two dashboard specs by moving a count.
 *
 * Deleting rather than reporting, because a count assertion cannot be honest
 * about a database somebody has been editing, and the seeded project is a
 * fixture rather than anyone's workspace.
 *
 * Safe to run before the write specs: they run after this (`mutations` and
 * `edits` both descend from `chromium`), so nothing under test exists yet.
 */
setup("remove tasks the seed does not account for", async () => {
  const auth = credentials();
  if (!auth) return;

  // Encoded per title, so the quotes and commas that separate the list stay
  // structural. No seeded title contains either.
  const canonical = SEEDED_TASKS.map((t) => `"${encodeURIComponent(t.title)}"`).join(",");

  const response = await fetch(
    `${auth.url}/rest/v1/tasks?project_id=eq.${PROJECT.id}&title=not.in.(${canonical})`,
    { method: "DELETE", headers: auth.headers },
  );

  expect(
    response.ok,
    `[reseed] sweeping unexpected tasks failed: ${response.status} ${await response.clone().text()}`,
  ).toBe(true);

  const removed = (await response.json()) as { title: string }[];
  for (const task of removed) {
    console.log(`[reseed] removed a task the seed does not define: ${JSON.stringify(task.title)}`);
  }
});

setup("restore the seeded tasks to their columns", async () => {
  const auth = credentials();
  if (!auth) return;

  for (const { title, status } of SEEDED_TASKS) {
    // Scoped to the seeded project as well as the title: a write spec is free
    // to create a project of its own containing a task named anything.
    const filter =
      `project_id=eq.${PROJECT.id}` + `&title=eq.${encodeURIComponent(title)}`;

    const response = await fetch(`${auth.url}/rest/v1/tasks?${filter}`, {
      method: "PATCH",
      headers: auth.headers,
      body: JSON.stringify({ status }),
    });

    expect(
      response.ok,
      `[reseed] restoring "${title}" failed: ${response.status} ${await response.clone().text()}`,
    ).toBe(true);

    /**
     * A row that matched nothing is the failure worth catching here.
     *
     * PostgREST answers a PATCH that updated no rows with 200 and `[]`, so
     * without this a seeded task that had been *deleted* would sail through
     * setup and surface later as an unexplained count mismatch in whichever
     * spec happened to assert on it.
     */
    const patched = (await response.json()) as unknown[];
    expect(
      patched.length,
      `[reseed] no seeded task titled "${title}" in project ${PROJECT.id}. ` +
        "It was deleted from the test database and has to be restored by hand.",
    ).toBe(1);
  }
});
