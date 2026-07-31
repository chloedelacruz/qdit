import { expect, test } from "@playwright/test";

/**
 * Expected values are derived by hand from `src/lib/placeholder-data.ts`:
 *   tasks     24 + 18 + 9 = 51
 *   completed 15 + 18 + 2 = 35  (69%)
 *   active milestones      = 2  (one proposed, one submitted)
 *   mainnet live projects  = 1
 * They are written out literally on purpose — importing the fixtures would make
 * the assertions restate the implementation instead of checking it.
 */
test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("renders four stat tiles with the aggregate figures", async ({ page }) => {
    const tiles = page.locator('[data-slot="stat-tile"]');
    await expect(tiles).toHaveCount(4);

    const valueFor = (label: string) =>
      tiles.filter({ hasText: label }).locator('[data-slot="stat-value"]');

    await expect(valueFor("Total tasks")).toHaveText("51");
    await expect(valueFor("Completed")).toHaveText("35");
    await expect(valueFor("Active milestones")).toHaveText("2");
    await expect(valueFor("Live on Mainnet")).toHaveText("1");
  });

  test("completion tile reports progress to assistive tech", async ({ page }) => {
    const bar = page.getByRole("progressbar", { name: "Completed" });
    await expect(bar).toHaveAttribute("aria-valuenow", "69");
    await expect(bar).toHaveAttribute("aria-valuemin", "0");
    await expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  test("lists every project with its status and deployment state", async ({ page }) => {
    const projects = page.getByRole("link", { name: /Atlas Escrow|Proof Registry|Builder Onboarding/ });
    await expect(projects).toHaveCount(3);

    const atlas = page.getByRole("link", { name: /Atlas Escrow/ });
    await expect(atlas).toContainText("Active");
    await expect(atlas).toContainText("Deployed to Testnet");
    await expect(atlas).toContainText("15/24 tasks");
  });

  test("project rows link to their detail route", async ({ page }) => {
    await expect(page.getByRole("link", { name: /Atlas Escrow/ })).toHaveAttribute(
      "href",
      "/projects/atlas-escrow",
    );
  });

  test("milestone panel shows proof state, including the missing one", async ({ page }) => {
    const panel = page.locator('[data-slot="card"]').filter({ hasText: "Milestone proof" });

    await expect(panel).toContainText("Contract v1");
    await expect(panel).toContainText("Submitted");
    await expect(panel).toContainText("Mainnet launch");
    await expect(panel).toContainText("Approved");

    // Dashboard MVP has no tx hash yet and must say so rather than render empty.
    await expect(panel).toContainText("No proof attached yet");
  });
});
