import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ICON } from "@/lib/icons";

/**
 * qdit's glyph set and the lucide controls behind `ICON` (QDIT-34).
 *
 * Every entry has to be drop-in interchangeable: a 24px grid, `currentColor`
 * so it follows the theme, and silent to a screen reader unless the caller
 * names it — the label belongs on the control, and an unlabelled `<svg>` that
 * is not hidden reads as "image" with nothing after it.
 */

const entries = Object.entries(ICON);
const render = (Icon: (typeof ICON)[keyof typeof ICON], props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(Icon, props));

/** The svg's opening tag, so attribute checks cannot match a child element. */
const svgTag = (markup: string) => markup.match(/^<svg\b[^>]*>/)?.[0] ?? "";

/** qdit's own glyphs mark themselves; lucide's do not. */
const glyphEntries = entries.filter(([, Icon]) => render(Icon).includes("data-glyph="));

describe("every ICON entry", () => {
  it.each(entries)("%s renders one svg on the 24px grid", (_name, Icon) => {
    const markup = render(Icon);

    expect(markup.startsWith("<svg")).toBe(true);
    expect(markup.match(/<svg\b/g)).toHaveLength(1);
    expect(svgTag(markup)).toContain('viewBox="0 0 24 24"');
    expect(svgTag(markup)).toContain('stroke="currentColor"');
  });

  it.each(entries)("%s is hidden from assistive tech when unlabelled", (_name, Icon) => {
    expect(svgTag(render(Icon))).toContain('aria-hidden="true"');
  });

  it.each(entries)("%s draws something", (_name, Icon) => {
    expect(render(Icon)).toMatch(/<(path|rect|circle|line|polyline|polygon|ellipse)\b/);
  });

  it.each(entries)("%s keeps the caller's className", (_name, Icon) => {
    expect(svgTag(render(Icon, { className: "size-4 text-primary" }))).toMatch(
      /class="[^"]*size-4 text-primary/,
    );
  });
});

describe("qdit glyphs", () => {
  it("cover the concepts, not just the controls", () => {
    // A guard against the set quietly collapsing back to the library.
    expect(glyphEntries.length).toBeGreaterThanOrEqual(30);
    for (const concept of ["milestone", "proof", "anchor", "anchorStale", "info", "share", "history", "certificate"] as const) {
      expect(render(ICON[concept])).toContain("data-glyph=");
    }
  });

  it.each(glyphEntries)("%s becomes an img with its name once labelled", (_name, Icon) => {
    const tag = svgTag(render(Icon, { "aria-label": "Anchored" }));

    expect(tag).not.toContain("aria-hidden");
    expect(tag).toContain('role="img"');
    expect(tag).toContain('aria-label="Anchored"');
  });

  it.each(glyphEntries)("%s takes aria-labelledby as a label too", (_name, Icon) => {
    const tag = svgTag(render(Icon, { "aria-labelledby": "x" }));

    expect(tag).not.toContain("aria-hidden");
    expect(tag).toContain('role="img"');
  });

  it.each(glyphEntries)("%s is a round-capped 2px stroke by default", (_name, Icon) => {
    const tag = svgTag(render(Icon));

    expect(tag).toContain('stroke-width="2"');
    expect(tag).toContain('stroke-linecap="round"');
    expect(tag).toContain('stroke-linejoin="round"');
    expect(tag).toContain('fill="none"');
  });

  it.each(glyphEntries)("%s honours size like a lucide icon", (_name, Icon) => {
    const tag = svgTag(render(Icon, { size: 16 }));

    expect(tag).toContain('width="16"');
    expect(tag).toContain('height="16"');
  });

  it("names each glyph component once", () => {
    // Two ICON keys may share a glyph on purpose; two different components
    // may not share a name, or `data-glyph` stops identifying anything.
    const byName = new Map<string, unknown>();
    for (const [, Icon] of glyphEntries) {
      const name = render(Icon).match(/data-glyph="([^"]+)"/)![1];
      if (byName.has(name)) expect(byName.get(name)).toBe(Icon);
      byName.set(name, Icon);
    }
  });
});
