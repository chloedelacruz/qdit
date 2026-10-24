import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DoqtriDocCard, FromDoqtriBadge } from "@/components/doqtri-doc-card";
import type { DocCardData } from "@/lib/doqtri-doc-card";

/**
 * What each of the doc card's three states renders (WP-2.6). Server-rendered
 * to markup, since the card is a server component and the unit tests run in
 * Node without a DOM.
 */

const LOADED: DocCardData = {
  state: "loaded",
  title: "Payroll v1 plan",
  url: "https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
  host: "www.doqtri.xyz",
  node: { id: "h4", label: "Escrow contract" },
  docVersion: 7,
  proof: {
    kind: "milestone",
    anchor: {
      action: "approve",
      version: 2,
      txHash: "5e1f0c3a9b7d2e4f6a8c0b1d3e5f7a9c2b4d6e8f0a1c3e5b7d9f1a3c5e7b9d0f",
      network: "testnet",
    },
    stale: false,
  },
  loss: null,
};

const card = (data: DocCardData) => renderToStaticMarkup(createElement(DoqtriDocCard, { card: data }));

describe("DoqtriDocCard", () => {
  it("loaded: title, heading, version, proof and an Open in doqtri link", () => {
    const html = card(LOADED);

    expect(html).toContain('data-state="loaded"');
    expect(html).toContain("Payroll v1 plan");
    expect(html).toContain("Escrow contract");
    expect(html).toContain("(h4)");
    expect(html).toContain("v7");
    expect(html).toContain("Approved on chain, v2");
    expect(html).toContain('href="https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f"');
    expect(html).toContain("Open in doqtri");
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).not.toContain("Connection to doqtri lost");
  });

  it("offers no link when the stored URL is not on doqtri (D-45)", () => {
    const html = card({ ...LOADED, url: null, host: "" });

    expect(html).not.toContain("Open in doqtri");
    // The only link left is the anchor's explorer link.
    expect(html).not.toContain("doqtri.xyz");
    expect(html).toContain("not on doqtri");
  });

  it("not-connected: says the connection is lost and still shows the stored copy", () => {
    const html = card({ ...LOADED, state: "not-connected", loss: "left_project" });

    expect(html).toContain('data-state="not-connected"');
    expect(html).toContain("Connection to doqtri lost");
    expect(html).toContain("left the project");
    expect(html).toContain("read-only");
    expect(html).toContain("Payroll v1 plan");
    expect(html).toContain("Escrow contract");
    expect(html).toContain("v7");
  });

  it("no-access: says so, and nothing about the plan", () => {
    const html = card({ state: "no-access" });

    expect(html).toContain('data-state="no-access"');
    expect(html).toContain("don&#x27;t have access");
    expect(html).not.toContain("Payroll");
    expect(html).not.toContain("Escrow");
    expect(html).not.toContain("href=");
  });

  it("the Plan docs variant counts anchored milestones instead of naming a heading", () => {
    const html = card({
      ...LOADED,
      node: null,
      docVersion: null,
      proof: { kind: "doc", anchored: 1, total: 3 },
    });

    expect(html).not.toContain("Heading");
    expect(html).toContain("1 of 3 linked milestones anchored");
    expect(html).toContain("Not anchored");
  });
});

describe("FromDoqtriBadge", () => {
  const badge = (data: DocCardData) => renderToStaticMarkup(createElement(FromDoqtriBadge, { card: data }));

  it("names the plan in its label when the viewer can read it", () => {
    expect(badge(LOADED)).toContain('aria-label="From doqtri: &quot;Payroll v1 plan&quot;. The title is managed by doqtri."');
  });

  it("marks a lost connection on the badge itself", () => {
    expect(badge({ ...LOADED, state: "not-connected", loss: "revoked" })).toContain("connection to doqtri lost");
  });

  it("does not name the plan when the viewer cannot read it", () => {
    const html = badge({ state: "no-access" });
    expect(html).toContain("a plan you don&#x27;t have access to");
    expect(html).not.toContain("Payroll");
  });
});
