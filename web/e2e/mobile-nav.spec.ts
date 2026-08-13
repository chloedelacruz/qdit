import { expect, test } from "@playwright/test";

import { PROJECT } from "./seed";

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

    // Role-name matching is substring by default, so "Projects" would also
    // match "All projects". Every sheet lookup here is exact.
    await sheet.getByRole("link", { name: "All tasks", exact: true }).click();

    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("All tasks");
    await expect(sheet).toBeHidden();
  });

  test("sheet exposes every workspace destination", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open navigation" }).click();

    const sheet = page.getByRole("dialog");
    for (const label of [
      "Dashboard",
      "Projects",
      "All tasks",
      "All milestones",
      "All deployments",
      "Proof registry",
      "Wallet",
      "Settings",
    ]) {
      await expect(sheet.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("the project switcher is reachable on mobile", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}`);
    await page.getByRole("button", { name: "Open navigation" }).click();

    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: `Project: ${PROJECT.name}` })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Board", exact: true })).toBeVisible();
  });

  test("board columns stack without overflowing the viewport", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/board`);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test("the filter bar wraps instead of overflowing", async ({ page }) => {
    await page.goto("/tasks");

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
