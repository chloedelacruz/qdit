import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DisabledReason, IconAction, InfoBubble } from "@/components/hint";
import { CreateGate } from "@/components/create-gate";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ICON } from "@/lib/icons";

/**
 * The accessible shape of the QDIT-34 primitives, server-rendered like the
 * other component tests (Node, no DOM). What opens on hover, focus or tap is
 * the e2e suite's job; this pins what a screen reader and the Tab key get
 * before anything is opened:
 *
 * - `DisabledReason` is focusable, says it is disabled, and carries its reason
 *   as text — a tooltip alone would be invisible to a screen reader.
 * - `InfoBubble` and `IconAction` are icon-only, so their names come from
 *   `aria-label`, and the icon itself stays out of the accessibility tree.
 */

// Children go in createElement's third argument (react/no-children-prop), so
// the props object is cast to the full prop type it is about to become.
const inProvider = (node: React.ReactElement) =>
  renderToStaticMarkup(createElement(TooltipProvider, null, node));

/** The words a reader sees: tags stripped. */
const text = (markup: string) => markup.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

describe("DisabledReason", () => {
  const REASON = "Anchor this milestone first.";
  const markup = inProvider(
    createElement(
      DisabledReason,
      { reason: REASON } as ComponentProps<typeof DisabledReason>,
      createElement("button", { disabled: true, type: "button" }, "Certificate"),
    ),
  );
  const wrapper = markup.match(/<span[^>]*data-slot="disabled-reason"[^>]*>/)?.[0] ?? "";

  it("renders a wrapper that takes keyboard focus", () => {
    expect(wrapper).not.toBe("");
    expect(wrapper).toContain('tabindex="0"');
  });

  it("marks the wrapper aria-disabled", () => {
    expect(wrapper).toContain('aria-disabled="true"');
  });

  it("carries the reason as screen-reader text, not only in a tooltip", () => {
    expect(markup).toMatch(new RegExp(`<span class="sr-only">${REASON}</span>`));
  });

  it("keeps the control itself, still disabled, inside", () => {
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Certificate<\/button>/);
    expect(text(markup)).toContain("Certificate");
  });

  it("does not render the tooltip until it is asked for", () => {
    expect(markup).not.toContain('role="tooltip"');
  });
});

describe("CreateGate", () => {
  it("passes the real control through for someone who may create", () => {
    const markup = inProvider(
      createElement(
        CreateGate,
        { allowed: true, label: "New task" } as ComponentProps<typeof CreateGate>,
        createElement("button", null, "live"),
      ),
    );

    expect(markup).toBe("<button>live</button>");
  });

  it("shows a viewer the same label, disabled, with the reason", () => {
    const markup = inProvider(createElement(CreateGate, { allowed: false, label: "New task" } as ComponentProps<typeof CreateGate>));

    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toMatch(/<button[^>]*disabled=""/);
    expect(text(markup)).toContain("New task");
    expect(markup).toMatch(/<span class="sr-only">[^<]*[Vv]iewer[^<]*<\/span>/);
  });
});

describe("InfoBubble", () => {
  const markup = renderToStaticMarkup(
    createElement(
      InfoBubble,
      { label: "Milestones" } as ComponentProps<typeof InfoBubble>,
      createElement("p", null, "Explainer"),
    ),
  );
  const trigger = markup.match(/<button[^>]*>/)?.[0] ?? "";

  it("is a button named for what it explains", () => {
    expect(trigger).toContain('aria-label="About Milestones"');
    expect(trigger).toContain('type="button"');
  });

  it("announces that it opens a popup, closed until used", () => {
    expect(trigger).toContain('aria-haspopup="dialog"');
    expect(trigger).toContain('aria-expanded="false"');
  });

  it("hides its glyph and keeps the explainer out of the page until opened", () => {
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(markup).not.toContain("Explainer");
  });
});

describe("IconAction", () => {
  it.each([
    ["a button", {}],
    ["a download link", { href: "/api/export/certificate", download: true }],
    ["an external link", { href: "https://example.com", external: true }],
  ])("names %s for assistive tech with a hidden glyph", (_kind, props) => {
    const markup = inProvider(
      createElement(IconAction, { label: "Copy public link", icon: ICON.share, ...props }),
    );

    expect(markup).toMatch(/<(button|a)\b[^>]*aria-label="Copy public link"/);
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
    // Icon-only: no visible word that could disagree with the label.
    expect(text(markup)).toBe("");
  });

  it("opens an external link in a new tab without the opener", () => {
    const markup = inProvider(
      createElement(IconAction, {
        label: "Open public page",
        icon: ICON.external,
        href: "https://example.com",
        external: true,
      }),
    );

    expect(markup).toContain('target="_blank"');
    expect(markup).toMatch(/rel="[^"]*noopener/);
  });
});
