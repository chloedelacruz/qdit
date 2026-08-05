import { expect, test } from "@playwright/test";

import { BOARD_COUNTS, MEMBERS, MILESTONES, PROJECT, TASKS } from "./seed";

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

/**
 * A card is two lines and cannot hold a task's description — the detail panel
 * is where the rest of it lives, and until it existed the description was
 * captured by the forms and never shown back anywhere.
 */
test.describe("task detail panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/board`);
  });

  function card(page: import("@playwright/test").Page, title: string) {
    return page.getByRole("article").filter({ hasText: title });
  }

  test("a card opens into a panel carrying the whole task", async ({ page }) => {
    await card(page, TASKS.todo).getByRole("button", { name: TASKS.todo }).click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(TASKS.todo);
    // The description: the field this panel exists to surface.
    await expect(panel).toContainText("Three columns with drag-free status changes");
    await expect(panel).toContainText(MILESTONES.proposed);
    await expect(panel).toContainText(MEMBERS.ben.name);
  });

  test("clicking the card body opens it too, not just the title", async ({ page }) => {
    await card(page, TASKS.unassigned).click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(TASKS.unassigned);
    // Nothing assigned, no milestone and no due date all read as absent.
    await expect(panel).toContainText("No milestone");
    await expect(panel).toContainText("No due date");
  });

  test("a task with no description says so rather than showing a blank", async ({
    page,
  }) => {
    await card(page, TASKS.inProgress).getByRole("button", { name: TASKS.inProgress }).click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/None yet|No description/);
  });

  /**
   * The point of putting the open task in the query string: a board link that
   * names the card being talked about survives being pasted somewhere.
   */
  test("the open task is in the URL and survives a reload", async ({ page }) => {
    await card(page, TASKS.todo).getByRole("button", { name: TASKS.todo }).click();
    await expect(page).toHaveURL(/[?&]task=/);

    await page.reload();
    await expect(page.getByRole("dialog")).toContainText(TASKS.todo);
  });

  test("closing drops the parameter, and back closes the panel", async ({ page }) => {
    await card(page, TASKS.todo).getByRole("button", { name: TASKS.todo }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]task=/);

    // Opening pushes an entry, so the browser's own back button closes it.
    await card(page, TASKS.todo).getByRole("button", { name: TASKS.todo }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  /**
   * The card is both a drag handle and a link to the panel, and it carries two
   * controls of its own. A press on either must not also open the panel behind
   * the menu it just opened.
   */
  test("the status menu on a card does not open the panel", async ({ page }) => {
    await card(page, TASKS.todo).getByRole("button", { name: /^Status:/ }).click();

    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});
