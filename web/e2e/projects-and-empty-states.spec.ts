import { expect, test } from "@playwright/test";

test.describe("projects", () => {
  test("renders one card per project with status and counts", async ({ page }) => {
    await page.goto("/projects");

    const cards = page.locator('[data-slot="card"]');
    await expect(cards).toHaveCount(3);

    const paused = cards.filter({ hasText: "Builder Onboarding" });
    await expect(paused).toContainText("Paused");
    await expect(paused).toContainText("Not Started");
    await expect(paused).toContainText("2/9 tasks");
  });

  test("project names link to their slug route", async ({ page }) => {
    await page.goto("/projects");

    // `exact` matters here: role-name matching is substring and
    // case-insensitive by default, so a loose "Proof Registry" would also pick
    // up the sidebar's "Proof registry" nav link.
    await expect(
      page.getByRole("main").getByRole("link", { name: "Proof Registry", exact: true }),
    ).toHaveAttribute("href", "/projects/proof-registry");
  });
});

test.describe("empty states", () => {
  test("proof registry explains why it is empty", async ({ page }) => {
    await page.goto("/proofs");

    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Nothing recorded yet");
    await expect(page.getByText(/Proof records appear here/)).toBeVisible();
  });
});

test.describe("settings", () => {
  test("documents all four member roles", async ({ page }) => {
    await page.goto("/settings");

    const card = page.locator('[data-slot="card"]').filter({ hasText: "Roles" });
    for (const role of ["Owner", "Admin", "Member", "Viewer"]) {
      await expect(card).toContainText(role);
    }
    await expect(card).toContainText("Read-only access.");
  });
});
