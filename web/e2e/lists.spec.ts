import { expect, test } from "@playwright/test";

import {
  DEPLOYMENT_CURRENT,
  DEPLOYMENT_ROWS,
  MILESTONE_TOTAL,
  MILESTONES,
  PROJECT,
} from "./seed";

/**
 * The cross-project list views. These exist so a workspace can be read whole,
 * but each one is scoped, filtered and paged rather than rendering everything.
 */
test.describe("cross-project lists", () => {
  test("all milestones names its project on every row", async ({ page }) => {
    await page.goto("/milestones");

    await expect(page.locator("text=/Showing .* milestones/").first()).toContainText(
      `Showing ${MILESTONE_TOTAL} of ${MILESTONE_TOTAL}`,
    );
    // Project name is essential context outside a project scope.
    await expect(page.getByText(PROJECT.name).first()).toBeVisible();
    await expect(page.getByText(MILESTONES.approved)).toBeVisible();
  });

  test("all deployments shows current state per project, not full history", async ({
    page,
  }) => {
    await page.goto("/deployments");

    await expect(page.locator("text=/Showing .* deployments/").first()).toContainText(
      `Showing ${DEPLOYMENT_CURRENT} of ${DEPLOYMENT_CURRENT}`,
    );
  });

  test("a project's own deployments page shows the whole history", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/deployments`);

    await expect(page.locator("text=/Showing .* deployments/").first()).toContainText(
      `Showing ${DEPLOYMENT_ROWS} of ${DEPLOYMENT_ROWS}`,
    );
    await expect(page.getByText("Current")).toHaveCount(1);
  });

  test("deployment pipeline fills to the current stage and no further", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/deployments`);

    // The project sits at "testnet" — stage 2 of 4.
    const pipeline = page.getByRole("list", {
      name: `${PROJECT.name} deployment pipeline`,
    });
    await expect(pipeline.locator('[data-reached="true"]')).toHaveCount(2);
    await expect(pipeline.locator('[data-reached="false"]')).toHaveCount(2);

    // Every stage is named for screen readers.
    await expect(pipeline).toContainText("Not Started");
    await expect(pipeline).toContainText("Mainnet Live");
  });

  test("milestone rows carry progress and proof state", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/milestones`);

    const row = page.locator("a", { hasText: MILESTONES.proposed }).first();
    // "Dashboard MVP" has no tasks and no proof yet.
    await expect(row).toContainText("No proof");
  });

  test("the project index reaches every project the user can see", async ({ page }) => {
    await page.goto("/projects");

    await expect(
      page.getByRole("link", { name: new RegExp(PROJECT.name) }),
    ).toBeVisible();
    await expect(page.locator("text=/Showing .* projects/").first()).toBeVisible();
  });
});
