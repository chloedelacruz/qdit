import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StaffPlainText } from "@/components/hackathon/staff-plain-text";

/**
 * Team content is printed, never interpreted (WP-4.7, QDIT-48): a note that
 * carries HTML or markdown renders as its characters, escaped, inside one
 * <pre>, with no element of its own.
 */
describe("StaffPlainText", () => {
  it("escapes HTML a team wrote", () => {
    const html = renderToStaticMarkup(
      createElement(StaffPlainText, {
        value: '<img src=x onerror="alert(1)"><script>steal()</script>\n**bold** [link](javascript:x)',
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;steal()&lt;/script&gt;");
    // Markdown stays markdown: no <strong>, no <a>.
    expect(html).toContain("**bold** [link](javascript:x)");
    expect(html).not.toMatch(/<(strong|a)\b/);
    expect(html.match(/<[a-z]+/g)).toEqual(["<pre"]);
  });

  it("says (empty) for nothing", () => {
    expect(renderToStaticMarkup(createElement(StaffPlainText, { value: null }))).toContain("(empty)");
  });
});
