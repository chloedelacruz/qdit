import { expect, test } from "@playwright/test";

import { env } from "./env";
import { connect, openPair, startDisconnected, type Pair } from "./pair";
import {
  H_BUILD,
  cleanUp,
  createQditProject,
  linkNoteToProject,
  milestoneFromHeading,
  seedNote,
  type QditProject,
  openPlanDocCard,
} from "./world";

/**
 * The doc card and "Planned in doqtri" (WP-2.6, WP-3.2; D-04, D-11; contract
 * section 12).
 *
 * qdit's project page shows the doqtri doc linked to the project, from what
 * doqtri wrote through /api/v1. qdit's public milestone page shows where the
 * milestone was planned, with a doqtri link built from the doc id and
 * DOQTRI_ORIGIN, never from the stored doc_url (D-95).
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
  milestoneId = (await milestoneFromHeading(pair.context, note.id, H_BUILD)).qdit_milestone_id;
});

test.afterAll(async () => {
  await cleanUp({ projects: project ? [project] : [], notes: note ? [note] : [] });
  await pair?.context.close();
});

test("qdit's project page shows the linked doqtri note with a live connection", async () => {
  await pair.page.goto(`${env().qditOrigin}/projects/${project.slug}`);
  const card = await openPlanDocCard(pair.page, note.title);
  await expect(card).toHaveAttribute("data-state", "loaded");
  await expect(card).toContainText(note.title);
  await expect(card.locator(`a[href="${env().doqtriOrigin}/d/${note.id}"]`)).toBeVisible();
});

test("qdit's public page says where the milestone was planned and links doqtri by doc id", async ({ browser }) => {
  const outsider = await browser.newContext();
  try {
    const page = await outsider.newPage();
    await page.goto(`${env().qditOrigin}/p/${project.slug}/${milestoneId}`);
    const planned = page.locator('[data-slot="planned-in-doqtri"]');
    await expect(planned).toBeVisible();
    await expect(planned.getByRole("heading", { name: "Planned in doqtri" })).toBeVisible();
    // Public: the doc's title is never shown (section 12).
    await expect(planned).not.toContainText(note.title);
    await expect(planned.getByRole("link", { name: /Open in doqtri/ })).toHaveAttribute(
      "href",
      `${env().doqtriOrigin}/d/${note.id}`,
    );
    // qdit read doqtri's real DoqtriRegistry (not "unconfigured" or
    // "unreachable"), and the heading was never signed there.
    await expect(planned).toHaveAttribute("data-verdict", "unsigned");
  } finally {
    await outsider.close();
  }
});

test("doqtri's milestone card reads the milestone back from the real qdit", async () => {
  await pair.page.goto(`${env().doqtriOrigin}/vault/${note.id}`);
  const card = pair.page.getByTestId("qdit-links").getByTestId("qdit-milestone-card");
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-state", "loaded");
  await expect(card).toContainText("Proposed");
  await expect(card).toContainText("Not on chain yet");
});
