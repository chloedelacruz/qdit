import { expect, test } from "@playwright/test";

/**
 * Runs only on the `mobile` project. Below `lg` the sidebar is replaced by a
 * sheet, so this is a different navigation path rather than the same one at a
 * smaller size.
 */
test.describe("mobile navigation", () => {
  test("desktop sidebar is hidden and the sheet trigger is offered", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.locator("aside")).toBeHidden();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  });

  test("sheet opens, navigates, and closes itself afterwards", async ({ page }) => {
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "Open navigation" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Role-name matching is substring by default, so "Board" would also match
    // "Dashboard". Every sheet lookup here is exact.
    await sheet.getByRole("link", { name: "Board", exact: true }).click();

    await expect(page).toHaveURL(/\/board$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Board");
    await expect(sheet).toBeHidden();
  });

  test("sheet exposes every nav destination", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open navigation" }).click();

    const sheet = page.getByRole("dialog");
    for (const label of [
      "Dashboard",
      "Projects",
      "Board",
      "Milestones",
      "Deployments",
      "Proof registry",
      "Settings",
    ]) {
      await expect(sheet.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("board columns stack without overflowing the viewport", async ({ page }) => {
    await page.goto("/board");

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
