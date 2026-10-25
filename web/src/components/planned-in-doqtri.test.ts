import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlannedInDoqtri } from "@/components/planned-in-doqtri";
import type { DocSourceCheck } from "@/lib/chain/doqtri-registry";
import type { PublicDocSource } from "@/lib/queries";

/**
 * What the public page's "Planned in doqtri" block renders in each
 * verification state (WP-3.2). Server-rendered to markup, like the doc card's
 * tests, since the block is a server component and the unit tests run in Node
 * without a DOM.
 */

const REGISTRY = "CCCIDUCFQMTMAGESMPTB3MFW4TURS62ORSZNICFOE6MNQZO3MI7F6QRJ";

const SOURCE: PublicDocSource = {
  docId: "c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
  nodeId: "h4",
  nodeLabel: "Escrow contract",
  docVersion: 3,
  docUrl: "https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
};

const VERIFIED: DocSourceCheck = {
  state: "verified",
  network: "testnet",
  registryId: REGISTRY,
  chainVersion: 3,
  node: { state: "attests", status: "Verified", milestoneVersion: 2 },
};

const block = (check: DocSourceCheck, source: PublicDocSource = SOURCE) =>
  renderToStaticMarkup(createElement(PlannedInDoqtri, { source, check }));

/** The words a reader sees: tags stripped, quotes unescaped. */
const words = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("PlannedInDoqtri", () => {
  it("verified: heading, version, the match, the heading's record and both links", () => {
    const html = block(VERIFIED);
    const text = words(html);

    expect(html).toContain('data-slot="planned-in-doqtri"');
    expect(html).toContain('data-state="verified"');
    expect(text).toContain("Planned in doqtri");
    expect(text).toContain("Escrow contract (h4)");
    expect(text).toContain("v3");
    expect(text).toContain("Matches DoqtriRegistry at v3");
    expect(text).toContain("Signed Verified for this milestone, at its on-chain version 2.");
    expect(html).toContain(`href="${SOURCE.docUrl}"`);
    expect(html).toContain('rel="noreferrer noopener"');
    expect(text).toContain("Open in doqtri");
    // Stellar Expert, on the network checked.
    expect(html).toContain(`href="https://stellar.expert/explorer/testnet/contract/${REGISTRY}"`);
    expect(html).toMatch(/<p role="status" class="[^"]*text-success/);
  });

  it("names the registry on stellar.expert's mainnet path for a mainnet project", () => {
    const html = block({ ...VERIFIED, network: "mainnet" });

    expect(html).toContain(`href="https://stellar.expert/explorer/public/contract/${REGISTRY}"`);
    expect(words(html)).toContain("anchored on Mainnet");
  });

  it("newer: says the plan changed since, with both versions", () => {
    const text = words(block({ ...VERIFIED, state: "newer", chainVersion: 5 }));

    expect(text).toContain("Plan changed since");
    expect(text).toContain("DoqtriRegistry has the plan at v5; this milestone was linked against v3.");
    expect(text).not.toContain("Matches");
  });

  it("newer, for a link written before the plan was anchored", () => {
    const text = words(block({ ...VERIFIED, state: "newer", chainVersion: 1 }, { ...SOURCE, docVersion: null }));

    expect(text).toContain("Not anchored when linked");
    expect(text).toContain("Plan changed since");
    expect(text).toContain("DoqtriRegistry now has it at v1");
  });

  it("mismatch and not-found: says so, never that it matches", () => {
    const mismatch = words(block({ ...VERIFIED, state: "mismatch", chainVersion: 2 }));
    expect(mismatch).toContain("Does not match DoqtriRegistry");
    expect(mismatch).toContain("at v2, behind the v3 recorded here");

    const missing = words(block({ ...VERIFIED, state: "not-found", chainVersion: null, node: { state: "none" } }));
    expect(missing).toContain("Not found on DoqtriRegistry");
    expect(missing).toContain("No plan with this id is anchored on Testnet");
    expect(missing).toContain("Not signed on chain yet.");

    for (const text of [mismatch, missing]) expect(text).not.toContain("Matches");
  });

  it("not-anchored: nothing to check, said plainly", () => {
    const html = block(
      { ...VERIFIED, state: "not-anchored", chainVersion: null, node: { state: "none" } },
      { ...SOURCE, docVersion: null },
    );

    expect(html).toContain('data-state="not-anchored"');
    expect(words(html)).toContain("Not anchored");
    expect(words(html)).toContain("nothing on the ledger to check it against");
  });

  it("unreachable: an explicit could-not-check, with no verdict and no heading record", () => {
    const html = block({ ...VERIFIED, state: "unreachable", chainVersion: null, node: null });
    const text = words(html);

    expect(html).toContain('data-state="unreachable"');
    expect(text).toContain("Could not check");
    expect(text).toContain("This is not a pass");
    expect(text).not.toContain("Matches");
    expect(text).not.toContain("Heading on chain");
    expect(html).not.toContain("text-success");
    // The registry is still named, so a reader can check it themselves.
    expect(html).toContain(`/contract/${REGISTRY}"`);
  });

  it("unconfigured: could not check, and no registry link to a contract it does not know", () => {
    const html = block({ state: "unconfigured", network: "mainnet", registryId: null, chainVersion: null, node: null });
    const text = words(html);

    expect(text).toContain("Could not check");
    expect(text).toContain("does not read DoqtriRegistry on Mainnet");
    expect(html).not.toContain("stellar.expert");
    expect(html).not.toContain("text-success");
  });

  it("describes a heading record for another milestone, or another tool", () => {
    expect(words(block({ ...VERIFIED, node: { state: "elsewhere", status: "Built" } }))).toContain(
      "Signed Built, but its record points at a different qdit milestone or contract.",
    );
    expect(
      words(block({ ...VERIFIED, node: { state: "other", status: "Built", tool: "rollup" } })),
    ).toContain('Signed Built with tool "rollup", not as this milestone.');
  });

  it("offers no Open in doqtri link without a URL on doqtri's origin", () => {
    const html = block(VERIFIED, { ...SOURCE, docUrl: null });

    expect(words(html)).not.toContain("Open in doqtri");
    expect(html).not.toContain("doqtri.xyz");
  });
});
