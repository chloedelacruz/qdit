import { expect, test } from "@playwright/test";

test.describe("task board", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/board");
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
    const expected = { todo: 3, in_progress: 2, done: 1 };

    for (const [status, count] of Object.entries(expected)) {
      const column = page.locator(`[data-slot="board-column"][data-status="${status}"]`);
      await expect(column.locator('[data-slot="board-count"]')).toHaveText(String(count));
      await expect(column.getByRole("article")).toHaveCount(count);
    }
  });

  test("cards carry title, milestone, assignee and due date", async ({ page }) => {
    const card = page
      .getByRole("article")
      .filter({ hasText: "Write escrow release tests" });

    await expect(card).toContainText("Contract v1");
    await expect(card).toContainText("Ravi");
    await expect(card).toContainText("2026-08-04");
  });

  test("unassigned tasks say so instead of rendering a blank", async ({ page }) => {
    const card = page
      .getByRole("article")
      .filter({ hasText: "Deploy to Testnet and record tx hash" });

    await expect(card).toContainText("Unassigned");
  });

  test("every demo task appears exactly once across the board", async ({ page }) => {
    await expect(page.getByRole("article")).toHaveCount(6);
  });
});
