import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest covers the pure logic in src/lib — state machines, URL round-tripping,
 * strkey validation, schema shapes. None of it touches React, the DOM or a
 * database, which is why the `node` environment is enough and why, unlike the
 * Playwright suite, this runs in CI (see the comment at the top of ci.yml).
 *
 * `include` is deliberately narrow. Vitest's default glob would also collect
 * web/e2e/*.spec.ts — Playwright specs, which import `@playwright/test` and
 * would fail the moment Vitest tried to run them. Unit tests are `*.test.ts`
 * under src/; Playwright owns `*.spec.ts` under e2e/. The two never overlap.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json. Stated by hand rather than via
    // vite-tsconfig-paths so the test setup adds exactly one devDependency.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // See src/test/server-only.stub.ts — the real package throws unless the
      // bundler sets the `react-server` export condition, which Vitest does not.
      "server-only": fileURLToPath(
        new URL("./src/test/server-only.stub.ts", import.meta.url),
      ),
    },
  },
});
