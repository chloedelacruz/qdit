import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated verbatim by `stellar contract bindings typescript` from the
    // deployed contract. Regenerate it, never edit it — see chain/client.ts.
    "src/lib/chain/bindings.ts",
  ]),
]);

export default eslintConfig;
