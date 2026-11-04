import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { env } from "./env";
import { connect, openPair, startDisconnected, type Pair } from "./pair";
import { serviceRest } from "./rest";
import {
  H_SHIP,
  cleanUp,
  createQditProject,
  linkNoteToProject,
  milestoneFromHeading,
  seedNote,
  type QditProject,
} from "./world";

/**
 * Connection 3, webhooks (WP-2.7, WP-2.9; contract section 9).
 *
 * A status change on a linked milestone in qdit puts an event in qdit's
 * outbox; qdit's delivery run signs it and posts it to doqtri; doqtri checks
 * the signature, records the event id and re-reads the milestone. The
 * delivery run is the same route qdit's pg_cron job calls, called here on
 * demand with qdit's CRON_SECRET so the test does not wait for the schedule.
 */

let pair: Pair;
let project: QditProject;
let note: { id: string; title: string };
let milestoneId: string;

test.beforeAll(async ({ browser }) => {
  pair = await openPair(browser);
  await startDisconnected(pair);
  await connect(pair);
  project = await createQditProject(pair.qdit.id);
  note = await seedNote(pair.doqtri.id, pair.doqtri.workspaceId);
  await linkNoteToProject(pair.context, note.id, project.id);
  milestoneId = (await milestoneFromHeading(pair.context, note.id, H_SHIP)).qdit_milestone_id;
});

test.afterAll(async () => {
  await cleanUp({ projects: project ? [project] : [], notes: note ? [note] : [] });
  await pair?.context.close();
});

function deliver(secret: string | null) {
  return fetch(`${env().qditOrigin}/api/cron/deliver-webhooks`, {
    headers: secret === null ? {} : { Authorization: `Bearer ${secret}` },
  });
}

test("qdit's delivery run is configured: origins match and the scheduler has its secrets (D-57, D-95)", async () => {
  expect((await deliver(null)).status).toBe(401);
  expect((await deliver("not-the-cron-secret")).status).toBe(401);

  const res = await deliver(env().qditCronSecret);
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as {
    data: { doqtriOrigin: { status: string; env: string | null }; scheduler: { status: string; missingSecrets: string[] } };
  };
  expect(data.doqtriOrigin.status).toBe("match");
  expect(data.doqtriOrigin.env).toBe(env().doqtriOrigin);
  expect(data.scheduler.status, `missing: ${data.scheduler.missingSecrets.join(", ")}`).toBe("configured");
});

test("submitting the milestone in qdit delivers a signed webhook that doqtri records", async () => {
  // The person's own act, in qdit's UI.
  await pair.page.goto(`${env().qditOrigin}/projects/${project.slug}/milestones`);
  const row = pair.page.locator('[data-slot="list-row"]').filter({ hasText: H_SHIP.nodeLabel });
  await row.getByRole("button", { name: /^Status: Proposed/ }).click();
  await pair.page.getByRole("menuitem", { name: "Submit for approval" }).click();
  await expect(row).toContainText("Submitted");

  // qdit's trigger wrote one outbox row for the linked milestone.
  type Event = { id: string; status: string; cause: string; delivered_at: string | null; dead_at: string | null; last_error: string | null; attempts: number };
  const outbox = () =>
    serviceRest<Event[]>(
      "qdit",
      `integration_events?milestone_id=eq.${milestoneId}&status=eq.submitted&select=id,status,cause,delivered_at,dead_at,last_error,attempts`,
    );
  await expect.poll(async () => (await outbox()).length).toBeGreaterThan(0);
  const [event] = await outbox();
  expect(event).toMatchObject({ cause: "status_changed" });

  // Run delivery until doqtri has answered 2xx for it.
  await expect
    .poll(
      async () => {
        await deliver(env().qditCronSecret);
        const [now] = (await outbox()).filter((e) => e.id === event.id);
        return now.delivered_at ? "delivered" : `attempts ${now.attempts}, ${now.dead_at ? "dead" : "pending"}: ${now.last_error ?? ""}`;
      },
      { timeout: 90_000, intervals: [2_000, 5_000, 10_000] },
    )
    .toBe("delivered");

  // doqtri kept the event id (idempotency) and re-read the milestone.
  await expect
    .poll(async () => (await serviceRest<unknown[]>("doqtri", `qdit_webhook_events?id=eq.${event.id}&select=id`)).length)
    .toBe(1);
  const [state] = await serviceRest<{ qdit_status: string; chain_status: string }[]>(
    "doqtri",
    `qdit_milestone_states?milestone_id=eq.${milestoneId}&select=qdit_status,chain_status`,
  );
  // The project is not on chain, so doqtri keeps qdit's word and suggests nothing from the chain.
  expect(state).toEqual({ qdit_status: "submitted", chain_status: "unregistered" });
});

test("doqtri's webhook endpoint refuses a body that qdit did not sign", async () => {
  const body = JSON.stringify({
    id: randomUUID(),
    event: "milestone.status_changed",
    project_id: project.id,
    milestone_id: milestoneId,
    status: "approved",
    occurred_at: new Date().toISOString(),
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const forged = createHmac("sha256", "not-the-shared-secret").update(`${timestamp}.${body}`).digest("hex");

  const res = await fetch(`${env().doqtriOrigin}/api/integrations/qdit/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Qdit-Timestamp": timestamp, "X-Qdit-Signature": `sha256=${forged}` },
    body,
  });
  expect(res.status).toBe(401);

  const [state] = await serviceRest<{ qdit_status: string }[]>(
    "doqtri",
    `qdit_milestone_states?milestone_id=eq.${milestoneId}&select=qdit_status`,
  );
  expect(state.qdit_status).not.toBe("approved");
});
