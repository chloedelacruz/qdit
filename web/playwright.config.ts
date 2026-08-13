import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import path from "node:path";

// Load .env / .env.local exactly as Next does, so the specs and the server
// under test see the same Supabase project and the same test credentials.
// Without this, the `webServer.env` block below would pass undefined through.
loadEnvConfig(process.cwd());

const PORT = Number(process.env.PORT ?? 3100);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

const STORAGE_STATE = path.join(__dirname, "e2e/.auth/user.json");

/**
 * These specs run against a real Supabase project with Row Level Security
 * enforced — there are no fixtures any more. Assertions therefore describe the
 * seeded rows, and anything that must hold at any data size (paging, filtering)
 * is written to be size-independent.
 *
 * Projects:
 *   setup    signs in once and saves the session
 *   reseed   restores the seeded tasks to the columns `seed.ts` claims
 *   anon     runs *without* that session, to prove the auth gate works
 *   chromium desktop, signed in
 *   mobile   Pixel 7, signed in — the sidebar becomes a sheet below `lg`
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  /**
   * Assertions wait longer than Playwright's 5s default because every page now
   * makes real round trips to a hosted Supabase project rather than rendering
   * in-memory fixtures. A cold route resolving in ~6s is slow, not broken, and
   * the tight default turned that into a flake that "fixed itself" on re-run.
   */
  expect: { timeout: 15_000 },
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    navigationTimeout: 30_000,
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, teardown: "cleanup" },
    { name: "cleanup", testMatch: /cleanup\.teardown\.ts/ },

    /**
     * The other half of `cleanup`: that one deletes the rows the write specs
     * add, this one puts the seeded rows back where `seed.ts` says they go.
     * Neither can do the other's job — a mutated seeded row is not a row to
     * delete, and a stray drag during manual testing mutates one without any
     * spec being involved.
     *
     * Runs before `chromium` because that is where the count assertions live.
     */
    { name: "reseed", testMatch: /reseed\.setup\.ts/ },

    {
      // Deliberately no storageState: these specs assert what a signed-out
      // visitor sees, so they must not depend on the setup project.
      name: "anon",
      use: { ...devices["Desktop Chrome"] },
      // Anchored to a path separator: the unanchored form also matched
      // `wallet-auth.spec.ts`, which would have run it here *as well as* in the
      // `wallet` project below — twice, against one database, with the second
      // run's teardown deleting the first's accounts mid-flight.
      testMatch: /[\\/](auth|landing)\.spec\.ts$/,
    },

    {
      /**
       * Signed-out, like `anon`, but dependent on `setup` — and the dependency
       * is the whole reason it is a separate project.
       *
       * These specs register real accounts, so they must be cleaned up, and the
       * `cleanup` teardown hangs off `setup`. A teardown runs once its project
       * and everything depending on that project have finished; `anon` depends
       * on nothing, so a spec living there could still be creating accounts
       * after cleanup had already swept.
       *
       * No `storageState`: a saved session would make the connect flow replace
       * it, which is a different test than the one being written.
       */
      name: "wallet",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testMatch: /wallet-auth\.spec\.ts$/,
    },

    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup", "reseed"],
      // Every write-path spec must also be listed here, or it runs twice —
      // once in this project and again in `mutations`.
      testIgnore: /(mobile-nav|auth|landing|create-task|edit-delete)\.spec\.ts/,
    },

    {
      /**
       * The write-path specs insert real rows, which moves the counts the
       * read-only specs assert. They therefore run *after* those finish rather
       * than alongside them — one shared database means ordering, not
       * isolation, is what keeps both honest.
       */
      name: "mutations",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["chromium"],
      testMatch: /create-task\.spec\.ts/,
    },

    {
      /**
       * A second write project rather than another file inside `mutations`.
       *
       * `fullyParallel` runs separate *files* on separate workers even when
       * each is internally serial, so two write specs sharing one database
       * would interleave — and `create-task` asserts an exact dashboard total,
       * which a task inserted by another worker moves underneath it. A project
       * dependency is the only ordering guarantee Playwright offers across
       * files.
       */
      name: "edits",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["mutations"],
      testMatch: /edit-delete\.spec\.ts/,
    },

    {
      name: "mobile",
      use: { ...devices["Pixel 7"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
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
      // Real values, loaded above. The app now talks to Supabase on every
      // request, so dummy credentials would fail the whole suite at the proxy.
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
      NEXT_PUBLIC_SITE_URL: BASE_URL,
      NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
      // Server-only; used by cleanup.teardown.ts, never sent to the browser.
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? "",
      // Signs SEP-10 challenges. Without it the challenge route answers 500 and
      // `wallet-auth.spec.ts` cannot get as far as a signature — the wallet
      // specs were the first thing here to need it.
      STELLAR_AUTH_SERVER_SECRET: process.env.STELLAR_AUTH_SERVER_SECRET ?? "",
    },
  },
});
