import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import { PNG_FIXTURE } from "../../e2e/hackathon-fixture";
import { env } from "./env";
import { connect, openPair, startDisconnected, type Pair } from "./pair";
import { serviceRest, tag } from "./rest";
import {
  cleanUp,
  createQditProject,
  HACKATHON_SLUG_PREFIX,
  MEMBER_USERNAME_PREFIX,
  qditAuthHeaders,
  removeHackathon,
  removeQditAccounts,
  seedNote,
  type QditProject,
} from "./world";

/**
 * A doqtri push becomes part of a qdit hackathon submission (WP-4.7, QDIT-49;
 * D-117, D-118; contract v1.2.0, hackathon-snapshots).
 *
 * The person connects doqtri to qdit, has five notes in their doqtri
 * workspace, and presses Send to qdit hackathon (doqtri's
 * POST /api/integrations/qdit/hackathon, which builds the snapshot from
 * doqtri's database and pushes it to qdit's
 * POST /api/v1/projects/{id}/hackathon-snapshots with doqtri's token). Then,
 * in qdit, they submit the entry: the dialog and the entry card show the
 * note count doqtri reported, and the frozen version points at that
 * snapshot.
 *
 * Needs doqtri's NEXT_PUBLIC_QDIT_HACKATHON=1 as well as
 * NEXT_PUBLIC_QDIT_INTEGRATION, and qdit's hackathon migration; skipped, with
 * the reason, without either.
 *
 * Builds its own hackathon (`dqit-hackathon-…`, open now), a qdit project
 * owned by the person with two extra members (accounts `dqit_h_…`,
 * example.invalid addresses, random passwords that are never used) and five
 * `DQIT` notes. afterAll removes them, the mindmap image under the
 * hackathon's Storage prefix first; global-teardown.ts sweeps the same
 * prefixes after a crash.
 */

let pair: Pair;
let project: QditProject;
let hackathon: { id: string; slug: string };
const notes: { id: string; title: string }[] = [];
const members: { id: string; username: string }[] = [];
let skipReason: string | null = null;

async function createMember(suffix: string): Promise<{ id: string; username: string }> {
  const id = randomBytes(4).toString("hex");
  const username = `${MEMBER_USERNAME_PREFIX}${id}_${suffix}`;
  const res = await fetch(`${env().qditSupabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...qditAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `dqit-hackathon-${id}-${suffix}@example.invalid`,
      password: randomBytes(18).toString("base64url"),
      email_confirm: true,
      user_metadata: { username, full_name: `DQIT member ${suffix}` },
    }),
  });
  const body = (await res.json()) as { id?: string };
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  return { id: body.id!, username };
}

test.beforeAll(async ({ browser }) => {
  const flag = await fetch(`${env().doqtriOrigin}/api/integrations/qdit/hackathon`, { method: "POST" });
  if (flag.status === 404) {
    skipReason = "doqtri answers 404 on /api/integrations/qdit/hackathon: NEXT_PUBLIC_QDIT_HACKATHON is off there.";
    return;
  }
  const table = await fetch(`${env().qditSupabaseUrl.replace(/\/+$/, "")}/rest/v1/hackathons?select=id&limit=1`, {
    headers: qditAuthHeaders(),
  });
  if (!table.ok) {
    skipReason = "qdit's hackathon migration (20261110100000_hackathons.sql) is not applied.";
    return;
  }

  pair = await openPair(browser);
  await startDisconnected(pair);
  await connect(pair);

  project = await createQditProject(pair.qdit.id);
  members.push(await createMember("m1"), await createMember("m2"));
  await serviceRest("qdit", "project_members", {
    method: "POST",
    body: members.map((m) => ({ project_id: project.id, user_id: m.id, role: "member" })),
    prefer: "return=minimal",
  });

  const slug = `${HACKATHON_SLUG_PREFIX}${randomBytes(5).toString("hex")}`;
  const now = Date.now();
  const [row] = await serviceRest<{ id: string }[]>("qdit", "hackathons", {
    method: "POST",
    body: {
      slug,
      name: tag("DQIT hackathon"),
      opens_at: new Date(now - 10 * 60_000).toISOString(),
      closes_at: new Date(now + 60 * 60_000).toISOString(),
      team_min: 3,
      team_max: 4,
    },
  });
  hackathon = { id: row.id, slug };

  for (let i = 0; i < 5; i++) notes.push(await seedNote(pair.doqtri.id, pair.doqtri.workspaceId));
});

test.afterAll(async () => {
  if (hackathon) await removeHackathon(hackathon.id).catch(() => undefined);
  await cleanUp({ projects: project ? [project] : [], notes });
  await removeQditAccounts(members.map((m) => m.id)).catch(() => undefined);
  await pair?.context.close();
});

test.beforeEach(() => {
  test.skip(skipReason !== null, skipReason ?? "");
});

test("a doqtri push shows its note count on the qdit submission", async () => {
  test.setTimeout(240_000);
  const e = env();

  // Send to qdit hackathon, as doqtri's dialog posts it.
  const sent = await pair.context.request.post(`${e.doqtriOrigin}/api/integrations/qdit/hackathon`, {
    data: { hackathon: hackathon.slug, project_id: project.id, workspace_id: pair.doqtri.workspaceId },
  });
  const receipt = (await sent.json()) as { ok: boolean; note_count?: number; code?: string; message?: string };
  expect(sent.status(), JSON.stringify(receipt)).toBe(200);
  expect(receipt.ok).toBe(true);
  // Every note in the workspace goes, ours among them.
  const noteCount = receipt.note_count!;
  expect(noteCount).toBeGreaterThanOrEqual(5);

  // qdit stored it, with that count, for this project and hackathon.
  const [snapshot] = await serviceRest<{ id: string; note_count: number }[]>(
    "qdit",
    `hackathon_doqtri_snapshots?hackathon_id=eq.${hackathon.id}&project_id=eq.${project.id}&select=id,note_count`,
  );
  expect(snapshot.note_count).toBe(noteCount);

  const notesText = `${noteCount} ${noteCount === 1 ? "note" : "notes"}`;
  const page = pair.page;
  await page.goto(`${e.qditOrigin}/hackathons/${hackathon.slug}`);
  await page.getByRole("button", { name: "Add submission to hackathon", exact: true }).click();
  const dialog = page.getByRole("dialog");
  // The dialog says what will be frozen.
  await expect(dialog.getByText(`doqtri snapshot received: ${notesText}`)).toBeVisible();

  await dialog.getByLabel("Team name").fill(tag("DQIT team"));
  for (const username of [pair.qdit.username, ...members.map((m) => m.username)]) {
    await dialog.getByRole("checkbox", { name: new RegExp(`@${username}`) }).click();
  }
  await dialog.locator('input[type="file"]').first().setInputFiles({
    name: "global-mindmap.png",
    mimeType: "image/png",
    buffer: PNG_FIXTURE,
  });
  await expect(dialog.getByText("Attached.", { exact: true })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Submission received.")).toBeVisible();

  // The entry card shows the count, and that the snapshot is in it.
  const entry = page.locator("article", { hasText: "Received" });
  await expect(entry).toContainText(`${notesText}, received`);
  await expect(entry).not.toContainText("Not in this submission yet");

  // The frozen version points at that snapshot.
  const [submission] = await serviceRest<{ current_version_id: string }[]>(
    "qdit",
    `hackathon_submissions?hackathon_id=eq.${hackathon.id}&select=current_version_id`,
  );
  const [version] = await serviceRest<{ doqtri_snapshot_id: string }[]>(
    "qdit",
    `hackathon_submission_versions?id=eq.${submission.current_version_id}&select=doqtri_snapshot_id`,
  );
  expect(version.doqtri_snapshot_id).toBe(snapshot.id);
});
