import { expect, test } from "@playwright/test";

import { MILESTONE_TOTAL, TASK_TOTAL } from "./seed";

/**
 * Signed in as the E2E account (Ada, who owns the seeded project):
 * 5 tasks with 2 done (40%), 2 open milestones, no Mainnet deployment, and
 * 1 open task assigned to her.
 */
test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("renders four rollup tiles", async ({ page }) => {
    const tiles = page.locator('[data-slot="stat-tile"]');
    await expect(tiles).toHaveCount(4);

    const valueFor = (label: string) =>
      tiles.filter({ hasText: label }).locator('[data-slot="stat-value"]');

    await expect(valueFor("Tasks complete")).toHaveText(`2/${TASK_TOTAL}`);
    await expect(valueFor("Open milestones")).toHaveText("2");
    await expect(valueFor("Live on Mainnet")).toHaveText("0");
    await expect(valueFor("Assigned to me")).toHaveText("1");
  });

  test("completion tile reports progress to assistive tech", async ({ page }) => {
    const bar = page.getByRole("progressbar", { name: "Tasks complete" });
    await expect(bar).toHaveAttribute("aria-valuenow", "40");
    await expect(bar).toHaveAttribute("aria-valuemin", "0");
    await expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  /**
   * The dashboard must stay an overview: adding work grows the tile numbers,
   * never the length of the page.
   */
  test("panels are capped rather than listing the whole workspace", async ({ page }) => {
    for (const name of ["My open tasks", "Awaiting approval", "Active projects"]) {
      const panel = page.getByRole("region", { name });
      await expect(panel).toBeVisible();
      expect(await panel.locator("a[href^='/projects/']").count()).toBeLessThanOrEqual(5);
    }
  });

  test("the primary panel is the user's own work", async ({ page }) => {
    // Spec §Visual Priority: exactly one primary object per page.
    const primary = page.locator(".surface-primary");
    await expect(primary).toHaveCount(1);
    await expect(page.getByRole("region", { name: "My open tasks" })).toContainText(
      "Publish the WASM to Testnet",
    );
  });

  test("each panel links to its filtered full view", async ({ page }) => {
    await expect(page.getByRole("link", { name: /^View all/ })).toHaveCount(3);

    await page.getByRole("link", { name: "View all awaiting approval" }).click();

    await expect(page).toHaveURL(/\/milestones\?status=submitted$/);
    await expect(page.locator("text=/Showing .* milestones/")).toContainText(
      `filtered from ${MILESTONE_TOTAL}`,
    );
  });
});
