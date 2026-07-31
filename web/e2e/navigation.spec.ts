import { expect, test } from "@playwright/test";

const ROUTES = [
  { href: "/dashboard", nav: "Dashboard", heading: "Dashboard" },
  { href: "/projects", nav: "Projects", heading: "Projects" },
  { href: "/board", nav: "Board", heading: "Board" },
  { href: "/milestones", nav: "Milestones", heading: "Milestones" },
  { href: "/deployments", nav: "Deployments", heading: "Deployments" },
  { href: "/proofs", nav: "Proof registry", heading: "Proof registry" },
  { href: "/settings", nav: "Settings", heading: "Settings" },
] as const;

test.describe("app shell navigation", () => {
  for (const route of ROUTES) {
    test(`${route.href} renders and marks its nav item active`, async ({ page }) => {
      await page.goto(route.href);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(route.heading);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

      // The desktop sidebar and the mobile sheet both render the nav, so scope
      // to the one that is actually visible at this viewport.
      const activeLink = page.locator(`aside a[href="${route.href}"]`);
      await expect(activeLink).toHaveAttribute("aria-current", "page");
    });
  }

  test("only one nav item is active at a time", async ({ page }) => {
    await page.goto("/board");
    await expect(page.locator('aside a[aria-current="page"]')).toHaveCount(1);
  });

  test("navigates client-side between sections", async ({ page }) => {
    await page.goto("/dashboard");

    await page.locator('aside a[href="/milestones"]').click();
    await expect(page).toHaveURL(/\/milestones$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Milestones");

    await page.locator('aside a[href="/deployments"]').click();
    await expect(page).toHaveURL(/\/deployments$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deployments");
  });

  test("logo returns to the dashboard", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("banner").getByRole("link", { name: "qdit" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("unknown routes 404", async ({ page }) => {
    const response = await page.goto("/does-not-exist");
    expect(response?.status()).toBe(404);
  });
});
