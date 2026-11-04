import { expect, test, type Locator, type Page } from "@playwright/test";

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
} from "./world";

/**
 * Connection 5 and 6 as the public sees them: the proof chain (WP-3.2,
 * WP-3.3; D-77, D-78, D-83, D-95; contract section 12).
 *
 * Two parts:
 *
 * - A milestone this spec makes and leaves unanchored. Everything about it is
 *   automated: the public page's four steps, and what the anonymous RPC
 *   discloses.
 * - A milestone someone has taken through release plan S6 step 1 by hand
 *   (anchor, submit, sign Built, approve, sign Verified). Those steps are
 *   wallet prompts in two apps, which a test cannot answer, so the suite
 *   checks the result instead: both public pages, logged out, agree. Set
 *   DOQTRI_IT_WALKED_QDIT_PAGE and DOQTRI_IT_WALKED_DOC_ID to run it; without
 *   them those tests are skipped, and the run is not a full pass.
 */

const STEPS = ["plan", "submitted", "approved", "verified"] as const;

/* -------------------------------------------------------------------------- */
/* An unanchored milestone, made here                                          */
/* -------------------------------------------------------------------------- */

test.describe("a linked milestone nobody has anchored", () => {
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

  test("qdit's public page shows the four steps, none past the plan done (D-78)", async ({ browser }) => {
    const outsider = await browser.newContext();
    try {
      const page = await outsider.newPage();
      await page.goto(`${env().qditOrigin}/p/${project.slug}/${milestoneId}`);
      const steps = page.locator('[data-slot="proof-chain"] [data-step]');
      await expect(steps).toHaveCount(4);
      expect(await steps.evaluateAll((els) => els.map((el) => el.getAttribute("data-step")))).toEqual([...STEPS]);
      for (const key of ["submitted", "approved", "verified"]) {
        await expect(page.locator(`[data-step="${key}"]`)).not.toHaveAttribute("data-step-state", "done");
      }
      await expect(page.getByText("This milestone has not been anchored yet")).toBeVisible();
    } finally {
      await outsider.close();
    }
  });

  test("the anonymous RPC discloses only the doc pointer: no nodeId, no docUrl (D-77, D-95)", async () => {
    const e = env();
    const res = await fetch(`${e.qditSupabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/public_milestone_proof`, {
      method: "POST",
      headers: { apikey: e.qditPublishableKey, Authorization: `Bearer ${e.qditPublishableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: project.slug, p_milestone_id: milestoneId }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as unknown;
    const proof = (Array.isArray(body) ? body[0] : body) as { docSource?: Record<string, unknown> };
    expect(proof.docSource, "no docSource for a linked milestone").toBeTruthy();
    expect(Object.keys(proof.docSource!).sort()).toEqual(["docId", "docVersion", "nodeLabel", "projectId"]);
    // projectId is given only for a project registered on chain; the suite's
    // project is not, so it is null here (public_milestone_doc_source.sql).
    expect(proof.docSource).toMatchObject({ docId: note.id, nodeLabel: H_BUILD.nodeLabel, projectId: null });
  });
});

/* -------------------------------------------------------------------------- */
/* A milestone taken through the whole walk by hand                            */
/* -------------------------------------------------------------------------- */

test.describe("a milestone walked from plan to Verified (release plan S6 step 1)", () => {
  const walkedPage = () => env().walkedQditPage;
  const walkedDoc = () => env().walkedDocId;

  test.beforeEach(() => {
    test.skip(!walkedPage(), "DOQTRI_IT_WALKED_QDIT_PAGE / DOQTRI_IT_WALKED_DOC_ID not set: walk S6 step 1 by hand first");
  });

  async function outsiderPages(browser: import("@playwright/test").Browser): Promise<{ qdit: Page; doqtri: Page; close: () => Promise<void> }> {
    const context = await browser.newContext();
    const qdit = await context.newPage();
    const doqtri = await context.newPage();
    await qdit.goto(`${env().qditOrigin}${walkedPage()}`);
    await doqtri.goto(`${env().doqtriOrigin}/d/${walkedDoc()}`);
    return { qdit, doqtri, close: () => context.close() };
  }

  /** doqtri's receipt for this milestone: the one whose qdit link is this page. */
  function receipt(doqtri: Page): Locator {
    return doqtri
      .getByTestId("qdit-receipt")
      .filter({ has: doqtri.locator(`[data-testid="qdit-page"][href$="${walkedPage()}"]`) });
  }

  async function txHashIn(scope: Locator): Promise<string | null> {
    const href = await scope.locator('a[href*="/tx/"]').first().getAttribute("href");
    return href?.match(/\/tx\/([0-9a-f]{64})/)?.[1] ?? null;
  }

  test("both public pages say Done on all four steps, in the same words (D-78)", async ({ browser }) => {
    const { qdit, doqtri, close } = await outsiderPages(browser);
    try {
      for (const key of STEPS) {
        await expect(qdit.locator(`[data-step="${key}"]`), `qdit ${key}`).toHaveAttribute("data-step-state", "done");
        await expect(receipt(doqtri).getByTestId(`chain-step-${key}`), `doqtri ${key}`).toHaveAttribute("data-state", "done");
      }
      // qdit read the signed heading off doqtri's registry.
      await expect(qdit.locator('[data-slot="planned-in-doqtri"]')).toHaveAttribute("data-verdict", "verified");
    } finally {
      await close();
    }
  });

  test("both pages name the same approval transaction", async ({ browser }) => {
    const { qdit, doqtri, close } = await outsiderPages(browser);
    try {
      const fromQdit = await txHashIn(qdit.locator('[data-step="approved"]'));
      const fromDoqtri = await txHashIn(receipt(doqtri).getByTestId("chain-step-approved"));
      expect(fromQdit, "qdit shows no approval tx").toMatch(/^[0-9a-f]{64}$/);
      expect(fromDoqtri).toBe(fromQdit);
    } finally {
      await close();
    }
  });

  test("doqtri shows the artifact_ref in the contract's grammar, as text (section 10, D-94)", async ({ browser }) => {
    const { doqtri, close } = await outsiderPages(browser);
    try {
      const [, , milestoneId] = walkedPage().split("/").filter(Boolean);
      const text = (await receipt(doqtri).textContent()) ?? "";
      const ref = text.match(/qdit:(testnet|mainnet):C[A-Z2-7]{55}:[0-9a-f-]{36}\/[0-9a-f-]{36}@v\d+/)?.[0];
      expect(ref, "no artifact_ref on doqtri's receipt").toBeTruthy();
      expect(ref).toContain(`/${milestoneId}@v`);
      await expect(receipt(doqtri).locator(`a:text-is("${ref}")`)).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test("qdit's Open in doqtri lands on the doc's public page; the proof hash is not a tx link (D-83)", async ({ browser }) => {
    const { qdit, close } = await outsiderPages(browser);
    try {
      const open = qdit.getByRole("link", { name: /Open in doqtri/ });
      await expect(open).toHaveAttribute("href", `${env().doqtriOrigin}/d/${walkedDoc()}`);
      const landed = await fetch(`${env().doqtriOrigin}/d/${walkedDoc()}`);
      expect(landed.status).toBe(200);

      const hash = qdit.locator("section").filter({ has: qdit.getByRole("heading", { name: "Current proof hash" }) });
      await expect(hash).toBeVisible();
      await expect(hash.locator('a[href*="/tx/"]')).toHaveCount(0);
    } finally {
      await close();
    }
  });
});
