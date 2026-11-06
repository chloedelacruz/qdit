import { expect, test, type Page } from "@playwright/test";

import { MILESTONES, PROJECT, TASKS } from "./seed";

/**
 * `/projects/[slug]/milestones/[milestoneId]` — one milestone, everything about
 * it, one click from any milestone row (QDIT-34).
 *
 * Before it existed a milestone's proofs were four clicks away through a
 * filter and its history sat in a dialog behind a hover-only menu. So the
 * claims here are about reach (one click in, breadcrumb and back out, a task
 * row straight into its board panel) and about the page holding what the
 * dialogs used to: tasks, proof, history and the certificate.
 *
 * Read-only: nothing is written, so this runs in `chromium` beside the other
 * read specs. Milestone ids are never hardcoded — every test arrives by
 * clicking a row, which is also the path being tested.
 *
 * Seed facts used (seed.ts / supabase/seed.sql):
 *   - `MILESTONES.submitted` holds `TASKS.inProgress`, and is the one milestone
 *     on the dashboard's "Awaiting approval" panel.
 *
 * What a milestone says before it is anchored, on a project not yet registered,
 * is in `milestone-gates.spec.ts`: the seeded rows are both on production.
 */

/**
 * A click-through's URL changes only when the server answers, and with every
 * worker hitting one local server that has taken 15s. Slow, not broken, so this
 * allows what `navigationTimeout` allows a page load (QDIT-38).
 */
const expectNavigation = expect.configure({ timeout: 30_000 });

const MILESTONE_URL = new RegExp(`/projects/${PROJECT.slug}/milestones/[0-9a-f-]{36}$`);

/** Opens a seeded milestone's page the way a person would: from its row. */
async function openMilestone(page: Page, title: string) {
  await page.goto(`/projects/${PROJECT.slug}/milestones`);
  await page.getByRole("link", { name: title, exact: true }).click();
  await expectNavigation(page).toHaveURL(MILESTONE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
}

/**
 * A Section by its heading. The heading's name also carries the count and any
 * ⓘ, so it is matched on how it starts — and not on a word boundary, because
 * the count may be joined to the title with no space ("Tasks1").
 */
const section = (page: Page, title: string) =>
  page.getByRole("region", { name: new RegExp(`^${title}(?![a-z])`) });

test.describe("reaching a milestone", () => {
  test("is one click from the dashboard", async ({ page }) => {
    await page.goto("/dashboard");

    await page
      .getByRole("region", { name: "Awaiting approval" })
      .getByRole("link", { name: MILESTONES.submitted, exact: true })
      .click();

    await expectNavigation(page).toHaveURL(MILESTONE_URL);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(MILESTONES.submitted);
  });

  test("every row on the project's milestones list links to its own page", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/milestones`);

    const hrefs = new Set<string>();
    for (const title of Object.values(MILESTONES)) {
      const link = page.getByRole("link", { name: title, exact: true });
      await expect(link).toHaveAttribute(
        "href",
        new RegExp(`^/projects/${PROJECT.slug}/milestones/[0-9a-f-]{36}$`),
      );
      hrefs.add((await link.getAttribute("href"))!);
    }
    // One page per milestone, not three links to the same list.
    expect(hrefs.size).toBe(Object.values(MILESTONES).length);
  });

  test("rows on the cross-project list link there too", async ({ page }) => {
    await page.goto("/milestones");

    await expect(page.getByRole("link", { name: MILESTONES.approved, exact: true })).toHaveAttribute(
      "href",
      new RegExp(`^/projects/${PROJECT.slug}/milestones/[0-9a-f-]{36}$`),
    );
  });
});

test.describe("the milestone page", () => {
  test.beforeEach(async ({ page }) => {
    await openMilestone(page, MILESTONES.submitted);
  });

  test("states its facts: progress, chain and public link", async ({ page }) => {
    const facts = page.locator("dl").first();
    for (const term of ["Progress", "On chain", "Public link"]) {
      await expect(facts.locator("dt", { hasText: term })).toBeVisible();
    }

    const progress = page.getByRole("progressbar", { name: "Progress" });
    await expect(progress).toHaveAttribute("aria-valuemin", "0");
    await expect(progress).toHaveAttribute("aria-valuemax", "100");
    const now = Number(await progress.getAttribute("aria-valuenow"));
    expect(now).toBeGreaterThanOrEqual(0);
    expect(now).toBeLessThanOrEqual(100);

    // Either the link itself, or the way to turn publishing on — never a
    // dead end.
    await expect(
      page
        .getByRole("button", { name: "Copy public link" })
        .or(page.locator(`a[href="/projects/${PROJECT.slug}#publishing"]`))
        .first(),
    ).toBeVisible();
  });

  test("holds tasks, proof and history", async ({ page }) => {
    for (const title of ["Tasks", "Proof", "History"]) {
      await expect(
        page.getByRole("heading", { level: 2, name: new RegExp(`^${title}(?![a-z])`) }),
      ).toBeVisible();
    }

    // Deep-linkable, so a row or a notification can land on it.
    await expect(page.locator("section#history")).toBeVisible();

    await expect(section(page, "Tasks")).toContainText(TASKS.inProgress);
    // Scoped to this milestone, not the whole project.
    await expect(section(page, "Tasks")).not.toContainText(TASKS.done);
  });

  test("its proof section opens the proof list filtered to it", async ({ page }) => {
    const milestoneId = page.url().split("/").pop()!;

    await expect(page.getByRole("link", { name: "View all proof" })).toHaveAttribute(
      "href",
      `/projects/${PROJECT.slug}/proofs?milestone=${milestoneId}`,
    );
  });

  test("a task row opens the board with that task's panel", async ({ page }) => {
    await section(page, "Tasks").getByRole("link", { name: TASKS.inProgress, exact: true }).click();

    await expectNavigation(page).toHaveURL(
      new RegExp(`/projects/${PROJECT.slug}/board\\?task=[0-9a-f-]{36}$`),
    );
    await expect(page.getByRole("dialog")).toContainText(TASKS.inProgress);
  });

  test("the breadcrumb walks back to the list, and Back returns here", async ({ page }) => {
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Projects", exact: true })).toHaveAttribute(
      "href",
      "/projects",
    );
    await expect(crumbs.getByRole("link", { name: PROJECT.name, exact: true })).toHaveAttribute(
      "href",
      `/projects/${PROJECT.slug}`,
    );

    await crumbs.getByRole("link", { name: "Milestones", exact: true }).click();
    await expectNavigation(page).toHaveURL(new RegExp(`/projects/${PROJECT.slug}/milestones$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Milestones");

    await page.goBack();
    await expectNavigation(page).toHaveURL(MILESTONE_URL);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(MILESTONES.submitted);
  });

  test("its actions are on show in the header, not hover-only", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Actions for this milestone" }).first();
    await expect(trigger).toBeVisible();
    // `toBeVisible` ignores opacity, and opacity 0 is exactly how a row hides
    // this control until hover.
    expect(await trigger.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  test("history is on the page, no longer a menu item", async ({ page }) => {
    await page.getByRole("button", { name: "Actions for this milestone" }).first().click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "History" })).toHaveCount(0);
  });
});

test.describe("keyboard", () => {
  test("an ⓘ opens with Enter and closes with Escape, back to its trigger", async ({ page }) => {
    await openMilestone(page, MILESTONES.submitted);

    const trigger = page.getByRole("button", { name: "About the history" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.focus();
    await page.keyboard.press("Enter");

    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const bubble = page.getByRole("dialog");
    await expect(bubble).toBeVisible();
    await expect(bubble).not.toBeEmpty();

    await page.keyboard.press("Escape");
    await expect(bubble).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a page's explainer sits behind the ⓘ beside its heading", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/milestones`);

    const trigger = page.getByRole("button", { name: "About Milestones" });
    await expect(trigger).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).not.toBeEmpty();
  });
});
