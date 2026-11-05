import { expect, test, type Page } from "@playwright/test";

import { MILESTONES, PROJECT } from "./seed";

/**
 * The milestone page and its rows under a finger (QDIT-34). Runs only on the
 * `mobile` project (Pixel 7, touch, `pointer: coarse`).
 *
 * A phone has no hover, so everything the desktop reveals on hover has to be
 * either always shown or one tap away: row actions, the ⓘ explainers, and the
 * reason a control is disabled. Rows also grow to a 44px target here, which is
 * the platform minimum a tester on a phone kept missing.
 *
 * Read-only, like `mobile-nav.spec.ts`.
 */

/**
 * By the row's href rather than a tap on the row: what a tap on a row does is
 * `milestone-page.spec.ts`'s question, and under a phone layout the row's
 * centre can land on one of its own controls.
 */
async function openMilestone(page: Page, title: string) {
  await page.goto(`/projects/${PROJECT.slug}/milestones`);
  const href = await page.getByRole("link", { name: title, exact: true }).getAttribute("href");
  await page.goto(href!);
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT.slug}/milestones/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
}

const history = (page: Page) => page.getByRole("region", { name: /^History(?![a-z])/ });

test.describe("milestone rows under a finger", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/milestones`);
  });

  test("are at least 44px tall", async ({ page }) => {
    const rows = page.locator('[data-slot="list-row"]');
    await expect(rows.first()).toBeVisible();

    for (const row of await rows.all()) {
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("show their actions without a hover", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Actions for this milestone" }).first();
    await expect(trigger).toBeVisible();
    // Hidden by opacity under a mouse until hover; there is no hover here.
    expect(await trigger.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });
});

test.describe("milestone page under a finger", () => {
  test("an ⓘ opens on tap and closes on a second tap", async ({ page }) => {
    await openMilestone(page, MILESTONES.submitted);

    const trigger = page.getByRole("button", { name: "About the history" });
    await trigger.tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    await trigger.tap();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  /**
   * The reason a control is disabled must reach a phone too: Radix tooltips
   * open on hover and focus only, and `Hint` adds the tap.
   */
  test("tapping a disabled Certificate shows the reason", async ({ page }) => {
    await openMilestone(page, MILESTONES.proposed);

    test.skip(
      (await history(page).getByRole("link", { name: "Certificate" }).count()) > 0,
      `${MILESTONES.proposed} has been anchored on this database, so its certificate is live`,
    );

    const gate = history(page).locator('[data-slot="disabled-reason"]', { hasText: "Certificate" });
    test.skip((await gate.count()) === 0, "anchoring is not configured for this deployment");
    await gate.tap();

    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/anchor/i);
  });

  test("its header actions are on show", async ({ page }) => {
    await openMilestone(page, MILESTONES.submitted);

    const trigger = page.getByRole("button", { name: "Actions for this milestone" }).first();
    await expect(trigger).toBeVisible();
    expect(await trigger.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });
});
