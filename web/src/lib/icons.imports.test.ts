import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `@/lib/icons` is the only door to an icon (QDIT-34).
 *
 * A component that reaches for `lucide-react` directly gets a mark that is not
 * part of qdit's vocabulary, and the same concept drifts into three different
 * glyphs. `components/ui/*` is exempt: those are the vendored shadcn
 * primitives, whose chevrons and close buttons are mechanics, not concepts.
 * Likewise `components/icons/glyphs.tsx` is reached only through `lib/icons`.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry) ? [full] : [];
  });
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

/** Static imports, re-exports, `import()` and `require()` of a module. */
function importsOf(source: string, module: RegExp): boolean {
  const spec = module.source;
  return new RegExp(
    String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'](?:${spec})["']`,
    "m",
  ).test(source);
}

// This file names the modules it hunts for, so it would flag itself.
const files = sourceFiles(SRC).filter((file) => rel(file) !== "lib/icons.imports.test.ts");

describe("icon imports", () => {
  it("finds the source tree it is meant to guard", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.map(rel)).toContain("lib/icons.ts");
  });

  it("imports lucide-react only in lib/icons.ts and components/ui/", () => {
    const offenders = files
      .filter((file) => importsOf(readFileSync(file, "utf8"), /lucide-react(?:\/[^"']*)?/))
      .map(rel)
      .filter((file) => file !== "lib/icons.ts" && !file.startsWith("components/ui/"));

    expect(offenders).toEqual([]);
  });

  it("imports the glyph file only from lib/icons.ts", () => {
    const offenders = files
      .filter((file) =>
        importsOf(
          readFileSync(file, "utf8"),
          /(?:@\/components\/icons\/glyphs|\.{1,2}\/(?:[\w.-]+\/)*(?:icons\/)?glyphs)/,
        ),
      )
      .map(rel)
      .filter(
        (file) => file !== "lib/icons.ts" && !file.startsWith("components/icons/glyphs."),
      );

    expect(offenders).toEqual([]);
  });

  it("would catch an offender", () => {
    // The guard is only worth something if its pattern matches the real forms.
    expect(importsOf('import { Bell } from "lucide-react";', /lucide-react(?:\/[^"']*)?/)).toBe(true);
    expect(importsOf("import type { LucideIcon } from 'lucide-react'", /lucide-react(?:\/[^"']*)?/)).toBe(true);
    expect(importsOf('export { X } from "lucide-react";', /lucide-react(?:\/[^"']*)?/)).toBe(true);
    expect(importsOf('const m = await import("lucide-react/dynamic");', /lucide-react(?:\/[^"']*)?/)).toBe(true);
    expect(importsOf('// lucide-react is behind lib/icons', /lucide-react(?:\/[^"']*)?/)).toBe(false);
  });
});
