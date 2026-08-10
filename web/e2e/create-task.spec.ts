import { expect, test } from "@playwright/test";

import { choose } from "./select";
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
    await choose(page, "assigneeId", MEMBERS.ben.name);
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

  /**
   * Priority, on a task this test sets itself.
   *
   * Every task in the hosted project carries the default, so there is nothing
   * seeded to filter for — and `supabase/seed.sql`'s spread of priorities
   * reaches a local stack only. A spec that assumed a seeded urgent would pass
   * locally and fail in the one place it actually runs.
   */
  test("a priority set on the form reaches the board as a chip", async ({ page }) => {
    const title = unique();
    await page.goto(`/projects/${PROJECT.slug}/board`);

    await page.getByRole("button", { name: "New task" }).click();
    await page.getByLabel("Title").fill(title);
    await choose(page, "priority", "Urgent");
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });

    // "P0" is what the card shows; "Priority: Urgent" is what it says out loud.
    const card = page.getByRole("article").filter({ hasText: title });
    await expect(card).toContainText("P0");
    await expect(card.getByText("Priority: Urgent")).toBeAttached();

    // And it filters — the chip is not just decoration on the card.
    await page.goto(`/projects/${PROJECT.slug}/board?priority=urgent`);
    await expect(page.getByRole("article").filter({ hasText: title })).toHaveCount(1);

    await page.goto(`/projects/${PROJECT.slug}/board?priority=low`);
    await expect(page.getByRole("article").filter({ hasText: title })).toHaveCount(0);
  });

  test("the form reopens on the priority it was saved with", async ({ page }) => {
    const title = unique();
    await page.goto(`/projects/${PROJECT.slug}/board`);

    await page.getByRole("button", { name: "New task" }).click();
    await page.getByLabel("Title").fill(title);
    await choose(page, "priority", "High");
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });

    // An edit dialog that reopened on the default would silently demote every
    // task whose owner only came to change its title.
    const card = page.getByRole("article").filter({ hasText: title });
    await card.hover();
    await card.getByRole("button", { name: "Actions for this task" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();

    // The trigger's text, not a `value`: the control is a button over a hidden
    // input now, and what matters is that the user sees the saved priority
    // rather than the default staring back at them.
    await expect(page.getByRole("dialog").locator("#priority")).toHaveText("High");
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
