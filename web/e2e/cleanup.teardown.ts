import { test as teardown } from "@playwright/test";

/**
 * Deletes the rows the write-path specs create.
 *
 * Runs in Node, never in the browser, so the secret key stays server-side. It
 * matches on the `e2e task ` title prefix rather than tracking ids, which means
 * a run that crashed part-way through still gets cleaned up on the next one.
 *
 * Missing credentials are a warning, not a failure: the read-only specs are
 * still worth running without a secret key, and failing the suite here would
 * hide their result.
 */
teardown("remove rows created by the write-path specs", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    console.warn("[teardown] SUPABASE_SECRET_KEY not set — leaving e2e rows in place.");
    return;
  }

  const response = await fetch(`${url}/rest/v1/tasks?title=like.e2e%20task%20*`, {
    method: "DELETE",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      Prefer: "return=representation",
    },
  });

  if (!response.ok) {
    console.warn(`[teardown] cleanup failed: ${response.status} ${await response.text()}`);
    return;
  }

  const removed = (await response.json()) as unknown[];
  if (removed.length > 0) console.log(`[teardown] removed ${removed.length} e2e task(s).`);
});
