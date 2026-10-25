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
  projectId: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34",
};

const VERIFIED: DocSourceCheck = {
  state: "verified",
  network: "testnet",
  registryId: REGISTRY,
  chainVersion: 3,
  node: { state: "current", status: "Verified", signedVersion: 2, milestoneStatus: "Approved" },
};

const block = (check: DocSourceCheck, source: PublicDocSource = SOURCE) =>
  renderToStaticMarkup(createElement(PlannedInDoqtri, { source, check }));

/** The words a reader sees: tags stripped, quotes unescaped. */
const words = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");

/** The "Heading on chain" row: its state attribute, classes and words. */
function nodeRow(node: DocSourceCheck["node"]) {
  const html = block({ ...VERIFIED, node });
  const row = /<dd data-node-state="([^"]+)" class="([^"]*)">([\s\S]*?)<\/dd>/.exec(html);
  return { state: row?.[1], className: row?.[2] ?? "", text: words(row?.[3] ?? "").trim() };
}

describe("PlannedInDoqtri, the plan version (fact 1)", () => {
  it("verified: heading, version, the check, the heading's record and both links", () => {
    const html = block(VERIFIED);
    const text = words(html);

    expect(html).toContain('data-slot="planned-in-doqtri"');
    expect(html).toContain('data-state="verified"');
    expect(text).toContain("Planned in doqtri");
    expect(text).toContain("Escrow contract (h4)");
    expect(text).toContain("v3");
    expect(text).toContain("Verified on DoqtriRegistry at v3");
    expect(text).toContain("The plan's current version on Testnet is the v3 this milestone was linked against.");
    expect(text).not.toContain("Plan changed since");
    expect(html).toContain(`href="${SOURCE.docUrl}"`);
    expect(html).toContain('rel="noreferrer noopener"');
    expect(text).toContain("Open in doqtri");
    // Stellar Expert, on the registry's network.
    expect(html).toContain(`href="https://stellar.expert/explorer/testnet/contract/${REGISTRY}"`);
    expect(html).toMatch(/<p role="status" class="[^"]*text-success/);
    // The project id is for the check, not for the page.
    expect(html).not.toContain(SOURCE.projectId);
  });

  it("names the registry on stellar.expert's mainnet path for a mainnet registry", () => {
    const html = block({ ...VERIFIED, network: "mainnet" });

    expect(html).toContain(`href="https://stellar.expert/explorer/public/contract/${REGISTRY}"`);
    expect(words(html)).toContain("anchored on Mainnet");
  });

  it("verified past the stored version, with a plan-changed-since note", () => {
    const html = block({ ...VERIFIED, chainVersion: 5 });
    const text = words(html);

    expect(html).toContain('data-state="verified"');
    expect(text).toContain("Verified on DoqtriRegistry at v5");
    expect(text).toContain("past the v3 this milestone was linked against");
    expect(text).toContain("Plan changed since v3 (now v5).");
  });

  it("not-anchored: a link with no version is unverified, even with the doc on chain now", () => {
    const anchoredSince = block({ ...VERIFIED, state: "not-anchored", chainVersion: 1 }, { ...SOURCE, docVersion: null });
    expect(anchoredSince).toContain('data-state="not-anchored"');
    expect(words(anchoredSince)).toContain("Not anchored when linked");
    expect(words(anchoredSince)).toContain("Not verified");
    expect(words(anchoredSince)).toContain("there is no linked version to check. DoqtriRegistry has it at v1 now.");
    expect(words(anchoredSince)).not.toContain("Plan changed since");
    expect(anchoredSince).not.toMatch(/<p role="status" class="[^"]*text-success/);

    const never = words(
      block({ ...VERIFIED, state: "not-anchored", chainVersion: null, node: { state: "none" } }, { ...SOURCE, docVersion: null }),
    );
    expect(never).toContain("not anchored when this milestone was linked, and has no version on Testnet yet");
  });

  it("mismatch and not-found: says so, never that it is verified", () => {
    const mismatch = words(block({ ...VERIFIED, state: "mismatch", chainVersion: 2 }));
    expect(mismatch).toContain("Does not match DoqtriRegistry");
    expect(mismatch).toContain("at v2, behind the v3 recorded here");

    const missing = words(block({ ...VERIFIED, state: "not-found", chainVersion: null, node: { state: "none" } }));
    expect(missing).toContain("Not found on DoqtriRegistry");
    expect(missing).toContain("No plan with this id is anchored on Testnet");

    for (const text of [mismatch, missing]) expect(text).not.toContain("Verified on DoqtriRegistry");
  });

  it("unreachable: an explicit could-not-check, with no verdict and no heading record", () => {
    const html = block({ ...VERIFIED, state: "unreachable", chainVersion: null, node: null });
    const text = words(html);

    expect(html).toContain('data-state="unreachable"');
    expect(text).toContain("Could not check");
    expect(text).toContain("This is not a pass");
    expect(text).not.toContain("Verified on");
    expect(text).not.toContain("Heading on chain");
    expect(html).not.toContain("text-success");
    // The registry is still named, so a reader can check it themselves.
    expect(html).toContain(`/contract/${REGISTRY}"`);
  });

  it("unconfigured: could not check, and no registry link to a contract it does not know", () => {
    const html = block({ state: "unconfigured", network: null, registryId: null, chainVersion: null, node: null });
    const text = words(html);

    expect(text).toContain("Could not check");
    expect(text).toContain("does not read a DoqtriRegistry");
    expect(text).toContain("its version is anchored in the DoqtriRegistry contract");
    expect(html).not.toContain("stellar.expert");
    expect(html).not.toContain("text-success");
  });

  it("offers no Open in doqtri link without a URL on doqtri's origin", () => {
    const html = block(VERIFIED, { ...SOURCE, docUrl: null });

    expect(words(html)).not.toContain("Open in doqtri");
    expect(html).not.toContain("doqtri.xyz");
  });
});

describe("PlannedInDoqtri, the heading's record (fact 4)", () => {
  it("Verified with the milestone Approved at the same version: verified, in the success tone", () => {
    const row = nodeRow(VERIFIED.node);
    expect(row.state).toBe("current");
    expect(row.text).toBe("Verified in doqtri at v2, and the milestone is Approved on chain at v2.");
    expect(row.className).toContain("text-success");
  });

  it("Verified while the chain says otherwise at that version: signed as Verified, never verified", () => {
    for (const milestoneStatus of ["Rejected", "Submitted"] as const) {
      const row = nodeRow({ state: "current", status: "Verified", signedVersion: 2, milestoneStatus });
      expect(row.text).toBe(`Signed as Verified; the chain now says ${milestoneStatus} (at v2).`);
      expect(row.className).toContain("text-warning");
      expect(row.text).not.toContain("Verified in doqtri");
    }
  });

  it("another status at the same version: the two side by side", () => {
    const row = nodeRow({ state: "current", status: "Built", signedVersion: 2, milestoneStatus: "Submitted" });
    expect(row.text).toBe("Signed Built at v2; the milestone is Submitted on chain at v2.");
    expect(row.className).toContain("text-muted-foreground");
  });

  it("resubmitted: says the signature refers to the version it names", () => {
    const verified = nodeRow({
      state: "resubmitted",
      status: "Verified",
      signedVersion: 2,
      chainVersion: 3,
      milestoneStatus: "Submitted",
    });
    expect(verified.text).toBe(
      "Signed as Verified; the chain now says Submitted at v3. The milestone was resubmitted after the heading was signed, so the signature refers to v2.",
    );
    expect(verified.className).toContain("text-warning");

    const built = nodeRow({ state: "resubmitted", status: "Built", signedVersion: 2, chainVersion: 3, milestoneStatus: "Submitted" });
    expect(built.text).toContain("the signature refers to v2");
  });

  it("inconsistent: names the mismatch and says not verified", () => {
    const cases = [
      [{ reason: "older", chainVersion: 1 }, "the milestone's record on chain is at v1, older than v2"],
      [{ reason: "not-found", chainVersion: null }, "the milestone has no record on chain"],
      [{ reason: "network", chainVersion: null }, "its record names another network than this project's"],
      [{ reason: "contract", chainVersion: null }, "its record names another contract than this project's"],
      [{ reason: "no-chain", chainVersion: null }, "this project is not registered on chain"],
    ] as const;
    for (const [fields, phrase] of cases) {
      const row = nodeRow({ state: "inconsistent", status: "Verified", signedVersion: 2, ...fields });
      expect(row.state).toBe("inconsistent");
      expect(row.text).toContain(`Signed as Verified for this milestone at v2, but ${phrase}`);
      expect(row.text).toContain("Not verified.");
      expect(row.className).toContain("text-warning");
    }
  });

  it("unchecked: the milestone's record could not be read, so it is not verified", () => {
    const row = nodeRow({ state: "unchecked", status: "Verified", signedVersion: 2 });
    expect(row.text).toContain("could not be read just now, so this is unchecked");
    expect(row.className).not.toContain("text-success");
  });

  it("not signed for this milestone: none, another milestone, another tool", () => {
    expect(nodeRow({ state: "none" }).text).toBe("Not signed in doqtri for this milestone yet.");
    expect(nodeRow({ state: "elsewhere", status: "Verified" }).text).toBe(
      "Not signed in doqtri for this milestone yet. The heading's current record names another qdit milestone.",
    );
    expect(nodeRow({ state: "other", status: "Built", tool: "rollup" }).text).toBe(
      'Not signed in doqtri for this milestone yet. The heading\'s current record is signed with tool "rollup".',
    );
  });
});
