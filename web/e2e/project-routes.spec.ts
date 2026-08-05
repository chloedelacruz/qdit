import { expect, test } from "@playwright/test";

import { BOARD_COUNTS, PROJECT, TASK_TOTAL } from "./seed";

/**
 * The project-scoped routes. Before the scope overhaul every project name
 * linked to `/projects/[slug]`, which did not exist — and the old spec only
 * asserted the `href` attribute, so a 404 shipped green. These navigate.
 */
test.describe("project routes", () => {
  test("a project name navigates to a page that actually renders", async ({ page }) => {
    await page.goto("/projects");

    await page.getByRole("link", { name: new RegExp(PROJECT.name) }).first().click();

    await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT.slug}$`));

    // `loading.tsx` renders a skeleton with no <h1>, so asserting the heading
    // straight after the URL changes races the loading state. Wait for the
    // skeleton to clear first — under parallel load against a remote database
    // that gap is wide enough to flake.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(PROJECT.name);
  });

  /**
   * Asserts the rendered result, not the status line. Next returns 200 for
   * *streamed* responses even when `notFound()` is thrown — documented in
   * `not-found.md` — and injects `noindex` itself.
   */
  test("an unknown slug renders not-found rather than an empty shell", async ({ page }) => {
    await page.goto("/projects/does-not-exist");

    // The app's own not-found page, not Next's default. It names both reasons
    // a slug fails to resolve, because RLS makes them indistinguishable from
    // here: a project you are not a member of returns no rows.
    await expect(page.getByText(/not found/i).first()).toBeVisible();
    await expect(page.getByText(/not a member of/i)).toBeVisible();
    await expect(page.locator('[data-slot="stat-tile"]')).toHaveCount(0);
  });

  test("every scoped section resolves for a real project", async ({ page }) => {
    for (const [segment, heading] of [
      ["board", "Board"],
      ["milestones", "Milestones"],
      ["deployments", "Deployments"],
      ["proofs", "Proofs"],
    ] as const) {
      const response = await page.goto(`/projects/${PROJECT.slug}/${segment}`);
      expect(response?.status(), `${segment} should resolve`).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    }
  });

  test("breadcrumb walks back up to the project and the index", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/board`);

    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "href",
      "/projects",
    );

    await crumbs.getByRole("link", { name: PROJECT.name }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT.slug}$`));
  });

  test("project nav appears only once a project is in scope", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    await page.goto("/dashboard");
    await expect(sidebar.getByRole("link", { name: "Overview" })).toHaveCount(0);

    await page.goto(`/projects/${PROJECT.slug}`);
    await expect(sidebar.getByRole("link", { name: "Overview" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Board" })).toHaveAttribute(
      "href",
      `/projects/${PROJECT.slug}/board`,
    );
  });

  test("the switcher names the project currently in scope", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}`);
    await expect(
      page.getByRole("button", { name: `Project: ${PROJECT.name}` }),
    ).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Choose a project" })).toBeVisible();
  });

  test("the scoped board only contains that project's tasks", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/board`);

    const total = Object.values(BOARD_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(TASK_TOTAL);
    await expect(page.getByRole("article")).toHaveCount(total);
  });
});
