import { expect, test } from "@playwright/test";

test.describe("landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders the hero and both calls to action", async ({ page }) => {
    await expect(page).toHaveTitle(/qdit/);

    // The headline is split across two lines, so it is checked in halves
    // rather than pinned to one string that a <br> would have to survive.
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toContainText("A milestone is a claim.");
    await expect(h1).toContainText("Make it checkable.");

    // The primary CTA is a button rather than a link: it opens the wallet
    // chooser in place instead of navigating somewhere to ask for credentials.
    // `.first()` because the closing plate offers the same door again.
    await expect(page.getByRole("button", { name: "Connect wallet" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Verify a hash" })).toBeVisible();
  });

  test("offers a signed-out visitor a way in without a password", async ({ page }) => {
    // Connecting is the whole of signing up — no form first, no account to
    // create beforehand — which is the claim the copy underneath it makes.
    await expect(page.getByRole("button", { name: "Connect wallet" }).first()).toBeEnabled();
    await expect(page.getByText(/No password\. Your wallet is the account/)).toBeVisible();

    // Clicking opens a wallet extension chooser, which Playwright cannot drive.
    // What happens after the click is covered by the unit tests over
    // lib/auth/challenge.ts; what this asserts is that the door is on the
    // marketing page at all, rather than one navigation behind it.
  });

  test("the hero's proof record settles into a verified state", async ({ page }) => {
    // The one piece of motion on the page, and the product's whole argument:
    // if this never resolves, the card is showing a claim it never checked.
    await expect(page.getByText("Succeeded — checked against Horizon")).toBeVisible();
  });

  test("names the three moves and the sections around them", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Track the work. Keep the proof.",
      "Everything a reviewer asks for, on the milestone itself.",
      "A tool that asks you to trust a number should show its own.",
    ]);

    await expect(page.getByRole("heading", { level: 3 })).toHaveText([
      "Track",
      "Anchor",
      "Verify",
      "Deployment state",
      "Signed by your wallet",
      "Roles the database enforces",
    ]);
  });

  test("reveals every band once it has been scrolled to", async ({ page }) => {
    // Sections ship hidden and are unhidden by a scroll sweep. A regression
    // there would leave the page blank below the fold while still passing every
    // assertion above — those query the DOM, and a `.reveal` that never fires is
    // present, laid out and `toBeVisible()`, just at opacity 0.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(r));
      }
    });

    await expect(page.locator('.reveal:not([data-shown="true"])')).toHaveCount(0);
    await expect(page.getByText("Task hub and proof registry.")).toBeVisible();
  });

  test("the app behind the landing is still gated", async ({ page }) => {
    // Moved off the primary CTA, which no longer navigates. The header's still
    // does, and the point it proves is unchanged: the landing page is public,
    // the app behind it is not.
    await page.getByRole("link", { name: "Open app" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to qdit" })).toBeVisible();
  });

  test("has exactly one h1", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});
