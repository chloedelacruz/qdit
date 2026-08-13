import { expect, test } from "@playwright/test";

import { PROJECT } from "./seed";

const WORKSPACE_ROUTES = [
  ["/dashboard", "Dashboard"],
  ["/projects", "Projects"],
  ["/tasks", "All tasks"],
  ["/milestones", "All milestones"],
  ["/deployments", "All deployments"],
  ["/proofs", "Proof registry"],
  ["/wallet", "Wallet"],
  ["/settings", "Settings"],
] as const;

test.describe("app shell navigation", () => {
  for (const [href, label] of WORKSPACE_ROUTES) {
    test(`${href} renders and marks its nav item active`, async ({ page }) => {
      await page.goto(href);

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const link = page
        .getByRole("navigation")
        .getByRole("link", { name: label, exact: true });
      await expect(link.first()).toHaveAttribute("aria-current", "page");
    });
  }

  test("only one nav item is active at a time", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.locator('nav [aria-current="page"]')).toHaveCount(1);
  });

  /**
   * `/projects` is the index and `/projects/[slug]` belongs to the project nav,
   * so the index must not stay lit once you are inside a project.
   */
  test("the projects index deactivates once a project is in scope", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/board`);

    const sidebar = page.getByRole("navigation", { name: "Workspace" });
    await expect(
      sidebar.getByRole("link", { name: "Projects", exact: true }),
    ).not.toHaveAttribute("aria-current", "page");

    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Board" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("project Overview stays exact and does not match its children", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/milestones`);

    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Overview" }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("navigates client-side between sections", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Proof registry", exact: true }).click();

    await expect(page).toHaveURL(/\/proofs$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Proof registry");
  });

  test("the account menu exposes the signed-in identity and a sign out", async ({ page }) => {
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /^Account:/ }).click();
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("unknown routes 404", async ({ page }) => {
    const response = await page.goto("/nope");
    expect(response?.status()).toBe(404);
  });
});
