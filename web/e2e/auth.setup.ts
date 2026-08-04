import { expect, test as setup } from "@playwright/test";
import path from "node:path";

/**
 * Signs in once and saves the session for every other project to reuse.
 *
 * Running the login flow per test would be slow and would hammer the Auth
 * server's rate limit. This runs as a Playwright dependency, so a failure here
 * fails the whole suite loudly rather than surfacing as 60 confusing redirects
 * to /login.
 *
 * Credentials come from the environment. They are never written in a spec file:
 * `supabase/seed.sql` once shipped a password to git and it authenticated
 * against the hosted project.
 */
export const STORAGE_STATE = path.join(__dirname, ".auth/user.json");

setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "E2E_EMAIL and E2E_PASSWORD are required. Copy web/.env.example to " +
        "web/.env.local and set them to an account that belongs to a project.",
    );
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
