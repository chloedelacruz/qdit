import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * These specs cover the UI shell only — the app currently renders from
 * `src/lib/placeholder-data.ts`, so nothing here touches Supabase. Once real
 * queries land, the data-dependent assertions need to move behind seeded
 * fixtures rather than the demo constants.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // The sheet only exists below `lg`, so these would fail at desktop width.
      testIgnore: /mobile-nav\.spec\.ts/,
    },
    {
      // The sidebar collapses into a sheet below `lg`, so the mobile viewport
      // exercises a genuinely different navigation path.
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /mobile-nav\.spec\.ts/,
    },
  ],

  // Production build: the dev server's on-demand compilation makes the first
  // navigation to each route slow enough to cause flaky timeouts.
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      // `src/proxy.ts` refreshes the Supabase session on every request and
      // throws if the project is unconfigured — correct for a real deployment,
      // but these specs render placeholder data and never reach Supabase. Feed
      // it syntactically valid values so the proxy constructs a client and
      // no-ops. Overridden by a real .env.local if one exists.
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_playwright_dummy",
      NEXT_PUBLIC_SITE_URL: BASE_URL,
      NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
    },
  },
});
