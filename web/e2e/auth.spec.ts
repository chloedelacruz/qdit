import { expect, test } from "@playwright/test";

/**
 * Runs in the `anon` project — no saved session. Everything here describes what
 * a signed-out visitor gets, which nothing covered before auth existed.
 */
test.describe("authentication", () => {
  const GUARDED = [
    "/dashboard",
    "/projects",
    "/tasks",
    "/milestones",
    "/deployments",
    "/proofs",
    "/settings",
    "/projects/milestone-proof-registry",
    "/projects/milestone-proof-registry/board",
  ];

  for (const path of GUARDED) {
    test(`${path} redirects a signed-out visitor to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to qdit");
    });
  }

  test("no workspace data leaks into the sign-in page", async ({ page }) => {
    await page.goto("/dashboard");

    // The redirect must happen before any row renders — a flash of real data
    // would mean the gate ran too late.
    await expect(page.locator('[data-slot="stat-tile"]')).toHaveCount(0);
    await expect(page.getByText("Milestone Proof Registry")).toHaveCount(0);
  });

  test("the wallet is the front door and email is the way back in", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lost your wallet?" })).toBeVisible();
  });

  test("there is no way to sign up with an email and password", async ({ page }) => {
    await page.goto("/login");

    // Accounts start with a wallet. The email and password are chosen on
    // /register, which is unreachable without a proved address, so a form
    // offering to make an account here would describe a flow that does not
    // exist — and `supabase/config.toml` has closed the endpoint it would post
    // to.
    await expect(page.getByRole("button", { name: "Create one" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(0);
  });

  test("/register is unreachable without a proved wallet", async ({ page }) => {
    // The registration ticket is what says an address was proved, and it is set
    // by the verify route and nothing else. Without one there is no address to
    // register and no form to render.
    await page.goto("/register");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to qdit");
  });

  test("a forged ticket cookie does not open registration", async ({
    page,
    context,
    // The suite's own base URL, not a literal: the port is configurable and
    // `PLAYWRIGHT_BASE_URL` can move the host entirely.
    baseURL,
  }) => {
    // Signed with a key the server does not have. The page must treat it the
    // same as no ticket at all — an unsigned address is a claim, and claiming
    // an address is the thing the whole challenge flow exists to prevent.
    await context.addCookies([
      {
        name: "qdit-wallet-ticket",
        value: [
          Buffer.from(
            "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ",
          ).toString("base64url"),
          String(Math.floor(Date.now() / 1000) + 3600),
          "not-a-real-signature",
        ].join("."),
        url: baseURL!,
      },
    ]);

    await page.goto("/register");

    await expect(page).toHaveURL(/\/login$/);
  });

  test("invalid credentials are rejected without revealing which field was wrong", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@qdit.test");
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 20_000 });

    // Account enumeration: the message must not distinguish "no such user"
    // from "wrong password".
    await expect(alert).not.toContainText(/no user|not found|unknown email/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("client-side validation catches a malformed email before submitting", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Password must be at least 6 characters.")).toBeVisible();
  });

  test("the auth callback rejects an off-origin redirect target", async ({ page }) => {
    // An open `next` parameter would let a crafted confirmation link bounce a
    // freshly authenticated user to an attacker's page.
    await page.goto("/auth/callback?next=https://example.com/phish");

    await expect(page).not.toHaveURL(/example\.com/);
    await expect(page).toHaveURL(/localhost|127\.0\.0\.1/);
  });

  /**
   * Lives here, not in navigation.spec.ts, because `signOut()` defaults to
   * global scope and revokes *every* refresh token for the user. Run against
   * the shared storageState session it would sign out all the parallel
   * workers mid-suite, which is exactly how it failed the first time.
   */
  test("signing out ends the session and re-gates the app", async ({ page }) => {
    const email = process.env.E2E_EMAIL!;
    const password = process.env.E2E_PASSWORD!;

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The session is genuinely gone, not just navigated away from.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});
