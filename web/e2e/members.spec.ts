import { expect, test } from "@playwright/test";

import { MEMBERS, PROJECT } from "./seed";

/**
 * The project roster (spec §10).
 *
 * Read-only on purpose, which is why this lives in the `chromium` project
 * rather than needing one of its own: it asserts what the page renders and
 * never writes, so it cannot interleave with the write specs on the shared
 * database.
 *
 * The add/remove/change-role paths are deliberately not covered here. Adding a
 * member requires somebody who is *not* already on the project, and all three
 * seeded users belong to the one seeded project — so `listAddableMembers()`
 * returns an empty set and there is nobody to add. That is the same gap that
 * keeps `stellar-proof.spec.ts` skipped, and it needs seed data to fix rather
 * than a test.
 */
test.describe("project members", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/members`);
  });

  test("is reachable from the project nav", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}`);

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Members" })
      .click();

    await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT.slug}/members$`));
  });

  test("lists the seeded team", async ({ page }) => {
    // Size-independent: asserts these people are present, not how many rows
    // there are, so adding a teammate later does not break this.
    for (const member of Object.values(MEMBERS)) {
      await expect(page.getByText(member.name, { exact: true })).toBeVisible();
    }
  });

  test("names the owner, so it is clear who approves milestones", async ({ page }) => {
    // Approving a milestone is the owner's alone — the contract checks
    // `approver == owner` — so the roster has to say who that is.
    await expect(page.getByText("Owner", { exact: true })).toBeVisible();
  });

  test("shows every role as a badge rather than raw enum text", async ({ page }) => {
    const badges = page.getByText(/^(Owner|Admin|Member|Viewer)$/);
    expect(await badges.count()).toBeGreaterThan(0);

    // The database stores `in_progress`-style values; none should reach the UI.
    await expect(page.getByText(/^(owner|admin|member|viewer)$/)).toHaveCount(0);
  });

  /**
   * The two rules RLS does not encode — nobody changes the owner's row, and an
   * admin does not change their own — are said up front (QDIT-34): the items
   * are shown, marked disabled, and carry the reason, rather than opening a
   * form whose submit then refuses.
   *
   * The signed-in account is the owner, so its row is both the owner's and
   * its own; Ben's row is the control that stays usable.
   */
  test("the owner's row offers Edit and Delete disabled, with the reason", async ({ page }) => {
    const row = page
      .locator('[data-slot="list-row"]')
      .filter({ hasText: MEMBERS.owner.name });
    await row.hover();
    await row.getByRole("button", { name: "Actions for this member" }).click();

    for (const name of ["Edit", "Delete"]) {
      const item = page.getByRole("menuitem", { name: new RegExp(`^${name}\\b`) });
      await expect(item).toHaveAttribute("aria-disabled", "true");
      // The reason travels with the item for a screen reader, not only in
      // the hover tooltip.
      await expect(item).toContainText(/owner/i);
    }

    // Choosing a blocked item opens nothing.
    await page.getByRole("menuitem", { name: /^Delete\b/ }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("another member's row keeps Edit and Delete usable", async ({ page }) => {
    const row = page.locator('[data-slot="list-row"]').filter({ hasText: MEMBERS.ben.name });
    await row.hover();
    await row.getByRole("button", { name: "Actions for this member" }).click();

    await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("the roster is the page's primary object", async ({ page }) => {
    // Spec §Visual Priority: exactly one primary object per page.
    await expect(page.locator(".surface-primary")).toHaveCount(1);
  });
});
