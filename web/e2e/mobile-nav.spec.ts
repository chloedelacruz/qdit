import { expect, test, type Page } from "@playwright/test";

import { MILESTONES, PROJECT } from "./seed";

/**
 * Runs only on the `mobile` project (Pixel 7). Below `lg` the sidebar gives way
 * to a bottom tab bar (QDIT-34): four destinations for the scope you are in,
 * plus More, which opens the whole sidebar as a bottom sheet. So this is a
 * different navigation path rather than the same one at a smaller size.
 *
 * What it holds the bar to is the bottom-navigation rule set: at most five
 * items, every one an icon *and* a word, the current one marked with
 * `aria-current`, thumb-sized targets, and nothing reachable only through the
 * old hamburger — which is gone.
 */

const tabBar = (page: Page) => page.getByRole("navigation", { name: "Tabs" });
const more = (page: Page) => tabBar(page).getByRole("button", { name: "More" });
const sheet = (page: Page) => page.getByRole("dialog", { name: "More" });

async function openMore(page: Page) {
  await more(page).click();
  await expect(sheet(page)).toBeVisible();
}

/** A seeded milestone's own page, reached through its row's link. */
async function openMilestone(page: Page, title: string) {
  await page.goto(`/projects/${PROJECT.slug}/milestones`);
  const href = await page.getByRole("link", { name: title, exact: true }).getAttribute("href");
  await page.goto(href!);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
}

/** True when the page can be scrolled sideways — the thing a phone must never do. */
const overflowsSideways = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

test.describe("mobile tab bar", () => {
  test("replaces the sidebar and the hamburger", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.locator("aside")).toBeHidden();
    await expect(tabBar(page)).toBeVisible();
    // The hamburger cost a tap before every destination; nothing should
    // still be hiding behind it.
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  });

  test("offers the workspace loop, each tab labelled, five items at most", async ({ page }) => {
    await page.goto("/dashboard");

    const bar = tabBar(page);
    const items = bar.getByRole("listitem");
    expect(await items.count()).toBeLessThanOrEqual(5);

    for (const label of ["Dashboard", "Projects", "Tasks", "Milestones"]) {
      // Visible text, not just an accessible name: an icon-only tab bar is
      // where discoverability goes to die.
      await expect(bar.getByRole("link", { name: label, exact: true })).toHaveText(label);
    }
    await expect(more(page)).toHaveText("More");
    await expect(bar.getByRole("link")).toHaveCount(4);
  });

  test("tabs are thumb-sized", async ({ page }) => {
    await page.goto("/dashboard");

    for (const target of [
      ...(await tabBar(page).getByRole("link").all()),
      more(page),
    ]) {
      const box = await target.boundingBox();
      expect(box, "tab has no box").not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("marks the current tab, and only that one", async ({ page }) => {
    await page.goto("/dashboard");

    const bar = tabBar(page);
    await expect(bar.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test("navigates and moves the current mark with it", async ({ page }) => {
    await page.goto("/dashboard");

    const bar = tabBar(page);
    await bar.getByRole("link", { name: "Tasks", exact: true }).click();

    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("All tasks");
    await expect(bar.getByRole("link", { name: "Tasks", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(bar.getByRole("link", { name: "Dashboard", exact: true })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the Projects tab lights on the index and gives way inside a project", async ({ page }) => {
    await page.goto("/projects");
    await expect(
      tabBar(page).getByRole("link", { name: "Projects", exact: true }),
    ).toHaveAttribute("aria-current", "page");

    await page.goto(`/projects/${PROJECT.slug}/board`);
    // Inside a project the bar switches scope, so there is no Projects tab to
    // light at all — and nothing workspace-wide is marked current.
    await expect(tabBar(page).getByRole("link", { name: "Projects", exact: true })).toHaveCount(0);
  });

  test("keeps the page clear of the bar", async ({ page }) => {
    await page.goto("/dashboard");

    // The last of the content must be reachable above the fixed bar, not
    // underneath it.
    const [padding, barHeight] = await Promise.all([
      page.locator("main").evaluate((main) => parseFloat(getComputedStyle(main).paddingBottom)),
      tabBar(page).evaluate((bar) => bar.getBoundingClientRect().height),
    ]);
    expect(padding).toBeGreaterThanOrEqual(barHeight);
  });
});

test.describe("inside a project", () => {
  test("the tabs follow the project scope", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/board`);

    const bar = tabBar(page);
    for (const [label, href] of [
      ["Overview", `/projects/${PROJECT.slug}`],
      ["Board", `/projects/${PROJECT.slug}/board`],
      ["Milestones", `/projects/${PROJECT.slug}/milestones`],
      ["Proofs", `/projects/${PROJECT.slug}/proofs`],
    ] as const) {
      await expect(bar.getByRole("link", { name: label, exact: true })).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(await bar.getByRole("listitem").count()).toBeLessThanOrEqual(5);

    await expect(bar.getByRole("link", { name: "Board", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Overview is exact: every project route is a descendant of it.
    await expect(bar.getByRole("link", { name: "Overview", exact: true })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("a milestone page keeps the Milestones tab lit", async ({ page }) => {
    await openMilestone(page, MILESTONES.approved);

    await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT.slug}/milestones/[0-9a-f-]{36}$`));
    await expect(
      tabBar(page).getByRole("link", { name: "Milestones", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });
});

test.describe("the More sheet", () => {
  test("opens from More and says so", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
    await openMore(page);
    await expect(more(page)).toHaveAttribute("aria-expanded", "true");
  });

  test("exposes every workspace destination, and help", async ({ page }) => {
    await page.goto("/dashboard");
    await openMore(page);

    // Role-name matching is substring by default, so "Projects" would also
    // match "All projects". Every sheet lookup here is exact.
    for (const label of [
      "Dashboard",
      "Projects",
      "All tasks",
      "All milestones",
      "All deployments",
      "Proof registry",
      "Wallet",
      "Settings",
      "User guide",
      "API docs",
    ]) {
      await expect(sheet(page).getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("navigates, and closes itself afterwards", async ({ page }) => {
    await page.goto("/dashboard");
    await openMore(page);

    await sheet(page).getByRole("link", { name: "All deployments", exact: true }).click();

    await expect(page).toHaveURL(/\/deployments$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("All deployments");
    await expect(sheet(page)).toBeHidden();
    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("closes on Escape without navigating", async ({ page }) => {
    await page.goto("/dashboard");
    await openMore(page);

    await page.keyboard.press("Escape");

    await expect(sheet(page)).toBeHidden();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("marks where you are, as the sidebar does", async ({ page }) => {
    await page.goto("/milestones");
    await openMore(page);

    await expect(
      sheet(page).getByRole("link", { name: "All milestones", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("reaches the project switcher and the rest of the project nav", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}`);
    await openMore(page);

    const body = sheet(page);
    await expect(body.getByRole("button", { name: `Project: ${PROJECT.name}` })).toBeVisible();
    // The two project destinations the tab bar has no room for.
    for (const label of ["Deployments", "Members"]) {
      await expect(body.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });
});

test.describe("no sideways scroll", () => {
  for (const [name, path] of [
    ["dashboard", "/dashboard"],
    ["all milestones", "/milestones"],
    ["the filter bar on all tasks", "/tasks"],
    ["the stacked board", `/projects/${PROJECT.slug}/board`],
    ["the project overview", `/projects/${PROJECT.slug}`],
    ["a project's milestones", `/projects/${PROJECT.slug}/milestones`],
  ] as const) {
    test(name, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      expect(await overflowsSideways(page)).toBe(false);
    });
  }

  test("a milestone page", async ({ page }) => {
    await openMilestone(page, MILESTONES.submitted);

    expect(await overflowsSideways(page)).toBe(false);
  });
});
