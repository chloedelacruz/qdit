import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

/**
 * qdit against a real doqtri (QDIT-1). Run with `npm run test:doqtri`.
 *
 * Not part of `npm test` (Vitest only collects src/**) or `npm run test:e2e`
 * (that config's testDir is ./e2e). It drives two deployed apps and writes
 * to both of their databases, so it runs only when someone asks for it; see
 * README.md next to this file.
 *
 * One worker, in file order: the specs share two accounts and one OAuth
 * grant, and a revoke in one spec must not land in the middle of another.
 */
loadEnvConfig(path.resolve(__dirname, "../.."));

export default defineConfig({
  testDir: __dirname,
  testMatch: /\d\d-.*\.spec\.ts$/,
  outputDir: path.join(__dirname, ".results"),
  globalSetup: path.join(__dirname, "global-setup.ts"),
  globalTeardown: path.join(__dirname, "global-teardown.ts"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: path.join(__dirname, ".results/report.json") }]],
  // Real round trips to two hosted apps, two Supabase projects and Soroban RPC.
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 45_000,
  },
});
