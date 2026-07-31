import { expect, test } from "@playwright/test";

test.describe("milestones", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/milestones");
  });

  test("lists every milestone with its project and status", async ({ page }) => {
    const cards = page.locator('[data-slot="card"]');
    await expect(cards).toHaveCount(3);

    const contractV1 = cards.filter({ hasText: "Contract v1" });
    await expect(contractV1).toContainText("Atlas Escrow");
    await expect(contractV1).toContainText("Submitted");
    await expect(contractV1).toContainText("5/8 tasks");
  });

  test("progress bars report the right percentage", async ({ page }) => {
    // 5/8 = 62.5% -> 63, 4/11 = 36.4% -> 36, 6/6 = 100%
    await expect(page.getByRole("progressbar", { name: "Contract v1 progress" })).toHaveAttribute(
      "aria-valuenow",
      "63",
    );
    await expect(page.getByRole("progressbar", { name: "Dashboard MVP progress" })).toHaveAttribute(
      "aria-valuenow",
      "36",
    );
    await expect(
      page.getByRole("progressbar", { name: "Mainnet launch progress" }),
    ).toHaveAttribute("aria-valuenow", "100");
  });

  test("milestones without a hash show the empty proof state", async ({ page }) => {
    const dashboardMvp = page.locator('[data-slot="card"]').filter({ hasText: "Dashboard MVP" });
    await expect(dashboardMvp).toContainText("No proof attached");
    await expect(dashboardMvp.getByRole("link", { name: /stellar\.expert/ })).toHaveCount(0);
  });

  test("approved milestone links its mainnet transaction", async ({ page }) => {
    const launch = page.locator('[data-slot="card"]').filter({ hasText: "Mainnet launch" });

    await expect(launch).toContainText("Approved");
    await expect(launch.getByRole("link", { name: "View transaction on stellar.expert" })).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/public/tx/a71c3e05d92f4b8617c0e5a3d4f96b2801e7c5a9d3b60f4e28c1a97d5b306e4f",
    );
  });
});
