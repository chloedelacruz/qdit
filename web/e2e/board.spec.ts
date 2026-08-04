import { expect, test } from "@playwright/test";

import { BOARD_COUNTS, MEMBERS, PROJECT, TASKS } from "./seed";

test.describe("project board", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/board`);
  });

  test("renders the three columns in Todo → In Progress → Done order", async ({ page }) => {
    const columns = page.locator('[data-slot="board-column"]');
    await expect(columns).toHaveCount(3);

    const order = await columns.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-status")),
    );
    expect(order).toEqual(["todo", "in_progress", "done"]);
  });

  test("each column counts its own cards", async ({ page }) => {
    for (const [status, count] of Object.entries(BOARD_COUNTS)) {
      const column = page.locator(`[data-slot="board-column"][data-status="${status}"]`);
      await expect(column.locator('[data-slot="board-count"]')).toHaveText(String(count));
      await expect(column.getByRole("article")).toHaveCount(count);
    }
  });

  /**
   * Columns scroll inside a bounded height. Without this a single long column
   * pushes the other two off-screen, which is the failure mode the board had
   * before the scale overhaul.
   */
  test("columns are height-capped and scroll independently", async ({ page }) => {
    const scroller = page
      .locator('[data-slot="board-column"][data-status="todo"] > div')
      .last();

    expect(await scroller.evaluate((n) => getComputedStyle(n).overflowY)).toBe("auto");
    expect(await scroller.evaluate((n) => getComputedStyle(n).maxHeight !== "none")).toBe(
      true,
    );
  });

  test("cards carry milestone, due date and assignee", async ({ page }) => {
    const card = page.getByRole("article").filter({ hasText: TASKS.inProgress });

    await expect(card).toContainText("Testnet deployment");
    await expect(card).toContainText("2026-08-03");
    await expect(card.getByLabel(MEMBERS.ada.name)).toBeVisible();
  });

  test("unassigned tasks are marked rather than left blank", async ({ page }) => {
    const card = page.getByRole("article").filter({ hasText: TASKS.unassigned });
    await expect(card.getByLabel("Unassigned")).toBeVisible();
  });

  test("filtering by assignee narrows every column at once", async ({ page }) => {
    await page.getByRole("button", { name: "Filter by assignee" }).click();
    await page.getByRole("menuitemcheckbox", { name: MEMBERS.ben.name }).click();
    await page.keyboard.press("Escape");

    await expect(page).toHaveURL(/assignee=/);

    // Ben has two tasks: one done, one todo.
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(
      page.getByRole("article").filter({ hasText: TASKS.inProgress }),
    ).toHaveCount(0);
  });

  test("a filter matching nothing explains itself", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/board?q=zzzznotathing`);

    await expect(page.getByText(/tasks match these filters/)).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
  });
});
