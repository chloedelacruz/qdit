import { expect, test } from "@playwright/test";

test.describe("landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders the hero and both calls to action", async ({ page }) => {
    await expect(page).toHaveTitle(/qdit/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Track the work. Keep the proof.",
    );

    // The primary CTA is a button rather than a link: it opens the wallet
    // chooser in place instead of navigating somewhere to ask for credentials.
    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse projects" })).toBeVisible();
  });

  test("offers a signed-out visitor a way in without a password", async ({ page }) => {
    // Connecting is the whole of signing up — no form first, no account to
    // create beforehand — which is the claim the copy underneath it makes.
    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeEnabled();
    await expect(page.getByText(/No password\. Your wallet is the account/)).toBeVisible();

    // Clicking opens a wallet extension chooser, which Playwright cannot drive.
    // What happens after the click is covered by the unit tests over
    // lib/auth/challenge.ts; what this asserts is that the door is on the
    // marketing page at all, rather than one navigation behind it.
  });

  test("lists the four product pillars", async ({ page }) => {
    const pillars = page.getByRole("heading", { level: 2 });
    await expect(pillars).toHaveText([
      "Task board",
      "Milestones with proof",
      "Deployment state",
      "One proof trail",
      "Built for the proof trail",
    ]);
  });

  test("the app behind the landing is still gated", async ({ page }) => {
    // Moved off the primary CTA, which no longer navigates. The secondary one
    // still does, and the point it proves is unchanged: the landing page is
    // public, the app behind it is not.
    await page.getByRole("link", { name: "Browse projects" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to qdit" })).toBeVisible();
  });

  test("has exactly one h1", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});
