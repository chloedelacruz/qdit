import { expect, test } from "@playwright/test";

test.describe("landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders the hero and both calls to action", async ({ page }) => {
    await expect(page).toHaveTitle(/qdit/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Track the work. Keep the proof.",
    );
    await expect(page.getByRole("link", { name: "Open the dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "See the board" })).toBeVisible();
  });

  test("lists the four product pillars", async ({ page }) => {
    const pillars = page.getByRole("heading", { level: 2 });
    await expect(pillars).toHaveText([
      "Task board",
      "Milestones with proof",
      "Deployment state",
      "One proof trail",
      "Built for the proof trail",
    ]);
  });

  test("primary CTA navigates into the app shell", async ({ page }) => {
    await page.getByRole("link", { name: "Open the dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  });

  test("has exactly one h1", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});
