import { expect, test } from "@playwright/test";

import { MEMBERS, PROJECT } from "./seed";

/**
 * The write path. Every row created here is titled `e2e task …` and removed by
 * `cleanup.teardown.ts` once the run finishes, so the suite leaves no residue
 * even if a test fails part-way through.
 *
 * Runs serially: these mutate shared state, and a parallel worker asserting a
 * board count mid-insert would flake.
 */
test.describe.configure({ mode: "serial" });

test.describe("creating a task", () => {
  const unique = () => `e2e task ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  test("the New task button opens a dialog", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/board`);

    await page.getByRole("button", { name: "New task" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "New task" })).toBeVisible();
    await expect(dialog.getByLabel("Title")).toBeFocused();
  });

  test("an empty title is rejected before anything is written", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/board`);
    const before = await page
      .locator('[data-slot="board-column"][data-status="todo"] [data-slot="board-count"]')
      .innerText();

    await page.getByRole("button", { name: "New task" }).click();
    await page.getByRole("button", { name: "Create task" }).click();

    // Dialog stays open, nothing created.
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.locator('[data-slot="board-column"][data-status="todo"] [data-slot="board-count"]'),
    ).toHaveText(before);
  });

  test("creates a task and shows it on the board with its details", async ({ page }) => {
    const title = unique();
    await page.goto(`/projects/${PROJECT.slug}/board`);

    const todoCount = page.locator(
      '[data-slot="board-column"][data-status="todo"] [data-slot="board-count"]',
    );
    const before = Number(await todoCount.innerText());

    await page.getByRole("button", { name: "New task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Due date").fill("2026-09-30");
    await page.selectOption("#assigneeId", { label: MEMBERS.ben.name });
    await page.getByRole("button", { name: "Create task" }).click();

    // The dialog closes only once the server confirms.
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });
    await expect(todoCount).toHaveText(String(before + 1));

    const card = page.getByRole("article").filter({ hasText: title });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("2026-09-30");
    await expect(card.getByLabel(MEMBERS.ben.name)).toBeVisible();

    // And it is a real row, visible from the cross-project view too.
    await page.goto("/tasks");
    await expect(page.getByText(title)).toBeVisible();
  });

  test("a created task counts toward the dashboard rollup", async ({ page }) => {
    const title = unique();

    await page.goto("/dashboard");
    const tile = page
      .locator('[data-slot="stat-tile"]')
      .filter({ hasText: "Tasks complete" })
      .locator('[data-slot="stat-value"]');
    const [done, total] = (await tile.innerText()).split("/").map(Number);

    await page.goto(`/projects/${PROJECT.slug}/board`);
    await page.getByRole("button", { name: "New task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });

    await page.goto("/dashboard");
    await expect(tile).toHaveText(`${done}/${total + 1}`);
  });
});
