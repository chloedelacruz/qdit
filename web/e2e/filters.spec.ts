import { expect, test } from "@playwright/test";

import { MILESTONE_TOTAL, TASK_TOTAL } from "./seed";

/**
 * Filtering lives entirely in the query string, so these assert the URL as much
 * as the DOM — a filtered view has to survive a reload and be pasteable to a
 * teammate.
 *
 * Paging is exercised with an explicit `?limit=`, which keeps the test
 * meaningful at any workspace size rather than depending on there being more
 * than 25 rows seeded.
 */
test.describe("filtering", () => {
  const counter = (page: import("@playwright/test").Page, noun: string) =>
    page.locator(`text=/Showing .* ${noun}/`).first();

  test("a status facet narrows the list and says what it hid", async ({ page }) => {
    await page.goto("/tasks");
    await expect(counter(page, "tasks")).toContainText(`of ${TASK_TOTAL}`);

    await page.getByRole("button", { name: "Filter by status" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Done" }).click();
    await page.keyboard.press("Escape");

    await expect(counter(page, "tasks")).toContainText("Showing 2 of 2");
    await expect(counter(page, "tasks")).toContainText(`filtered from ${TASK_TOTAL}`);
  });

  test("filter state is written to the URL and survives a reload", async ({ page }) => {
    await page.goto("/tasks");

    await page.getByRole("button", { name: "Filter by status" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Done" }).click();
    await page.keyboard.press("Escape");

    await expect(page).toHaveURL(/status=done/);

    await page.reload();
    await expect(counter(page, "tasks")).toContainText("Showing 2 of 2");
  });

  test("a pasted filter URL reproduces the same view", async ({ page }) => {
    await page.goto("/tasks?status=done");
    await expect(counter(page, "tasks")).toContainText("Showing 2 of 2");
    await expect(counter(page, "tasks")).toContainText(`filtered from ${TASK_TOTAL}`);
  });

  test("multiple values in one facet are OR'd together", async ({ page }) => {
    await page.goto("/tasks?status=todo,in_progress");
    // 5 tasks, 2 done, so 3 are open.
    await expect(counter(page, "tasks")).toContainText("Showing 3 of 3");
  });

  test("clearing filters returns to the unfiltered view", async ({ page }) => {
    await page.goto("/tasks?status=done");
    await expect(counter(page, "tasks")).toContainText("filtered from");

    await page.getByRole("button", { name: /Clear/ }).click();

    await expect(counter(page, "tasks")).toContainText(`Showing ${TASK_TOTAL} of ${TASK_TOTAL}`);
    await expect(page).not.toHaveURL(/status=/);
  });

  test("search matches on title", async ({ page }) => {
    await page.goto("/tasks");
    await page.getByRole("searchbox").fill("WASM");

    await expect(counter(page, "tasks")).toContainText(`filtered from ${TASK_TOTAL}`);
    await expect(page.getByText("Publish the WASM to Testnet")).toBeVisible();
  });

  test("a filter that matches nothing offers to clear, not to create", async ({ page }) => {
    await page.goto("/tasks?q=zzzznotathing");

    await expect(page.getByText(/No tasks match these filters/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
    // The "create your first task" empty state would be wrong here.
    await expect(page.getByText("No tasks yet")).toHaveCount(0);
  });

  test("long lists page rather than rendering everything", async ({ page }) => {
    await page.goto("/tasks?limit=2");

    await expect(counter(page, "tasks")).toContainText(`Showing 2 of ${TASK_TOTAL}`);
    await expect(page.getByRole("link", { name: /Load .* more/ })).toBeVisible();

    await page.getByRole("link", { name: /Load .* more/ }).click();

    await expect(counter(page, "tasks")).toContainText(
      `Showing ${TASK_TOTAL} of ${TASK_TOTAL}`,
    );
    await expect(page.getByRole("link", { name: /Load .* more/ })).toHaveCount(0);
  });

  test("changing a filter resets paging", async ({ page }) => {
    await page.goto("/tasks?limit=2");
    await expect(page).toHaveURL(/limit=2/);

    await page.getByRole("button", { name: "Filter by status" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Todo" }).click();
    await page.keyboard.press("Escape");

    await expect(page).not.toHaveURL(/limit=/);
  });

  test("milestone status filters independently of tasks", async ({ page }) => {
    await page.goto("/milestones?status=approved");
    await expect(counter(page, "milestones")).toContainText(
      `filtered from ${MILESTONE_TOTAL}`,
    );
    await expect(page.getByText("Contract scaffold + tests")).toBeVisible();
  });
});
