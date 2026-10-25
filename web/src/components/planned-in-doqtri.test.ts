import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlannedInDoqtri } from "@/components/planned-in-doqtri";
import type { DocSourceCheck, NodeAttestation } from "@/lib/chain/doqtri-registry";
import type { PublicDocSource } from "@/lib/queries";

/**
 * What the public page's "Planned in doqtri" block renders in each
 * verification state (WP-3.2, contract section 12). Server-rendered to
 * markup, like the doc card's tests, since the block is a server component
 * and the unit tests run in Node without a DOM.
 */

const REGISTRY = "CCCIDUCFQMTMAGESMPTB3MFW4TURS62ORSZNICFOE6MNQZO3MI7F6QRJ";

const SOURCE: PublicDocSource = {
  docId: "c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
  nodeId: "h4",
  nodeLabel: "Escrow contract",
  docVersion: 3,
  docLink: "https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
  projectId: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34",
};

const VERIFIED: DocSourceCheck = {
  state: "verified",
  network: "testnet",
  registryId: REGISTRY,
  chainVersion: 3,
  docUpdatedAt: 1792843200,
  node: { state: "current", status: "Verified", signedVersion: 2, milestoneStatus: "Approved" },
  nodeUpdatedAt: 1792843200,
};

const block = (check: DocSourceCheck, source: PublicDocSource = SOURCE) =>
  renderToStaticMarkup(createElement(PlannedInDoqtri, { source, check }));

/** The words a reader sees: tags stripped, quotes unescaped. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

/** The verdict on top: its classes and words. */
function verdictOf(html: string) {
  const match = /<p role="status" class="([^"]*)">([\s\S]*?)<\/p>/.exec(html);
  return { className: match?.[1] ?? "", text: words(match?.[2] ?? "").trim() };
}

/** The "Node record" row: its state attribute, classes and words. */
function nodeRow(node: NodeAttestation) {
  const html = block({ ...VERIFIED, node });
  const row = /<dd data-node-state="([^"]+)" class="([^"]*)">([\s\S]*?)<\/dd>/.exec(html);
  return { state: row?.[1], className: row?.[2] ?? "", text: words(row?.[3] ?? "").trim() };
}

/** The "Doc anchor" row's words and markup. */
function anchorRow(html: string) {
  const row = /<dd data-anchor-state="[^"]+" class="[^"]*">([\s\S]*?)<\/dd>/.exec(html);
  return { html: row?.[1] ?? "", text: words(row?.[1] ?? "").trim() };
}

/** Node records that do not name this project and milestone. */
const NO_EVIDENCE: [string, NodeAttestation | null][] = [
  ["never signed", { state: "none" }],
  ["signed with another tool", { state: "other", status: "Built", tool: "rollup" }],
  ["signed for another milestone", { state: "elsewhere", status: "Verified" }],
  [
    "signed for the milestone of a project not on chain",
    { state: "inconsistent", status: "Verified", signedVersion: 2, reason: "no-chain", chainVersion: null },
  ],
];

describe("PlannedInDoqtri, verified (both checks hold)", () => {
  it("names the node and the on-chain plan version, with both links", () => {
    const html = block(VERIFIED);
    const text = words(html);
    const verdict = verdictOf(html);

    expect(html).toContain('data-slot="planned-in-doqtri"');
    expect(html).toContain('data-state="verified"');
    expect(html).toContain('data-verdict="verified"');
    expect(text).toContain("Planned in doqtri");
    expect(text).toContain("doqtri signed node h4 of a doqtri plan for this milestone.");
    expect(verdict.text).toBe("Verified: planned in node h4, plan at v3");
    expect(verdict.className).toContain("text-success");
    expect(text).toContain("Escrow contract (h4)");
    expect(text).toContain(SOURCE.docId);
    expect(anchorRow(html).text).toBe("Doc anchored at version ≥ v3 Now v3 on Testnet.");
    expect(html).toContain(`href="${SOURCE.docLink}"`);
    expect(html).toContain('rel="noreferrer noopener"');
    expect(text).toContain("Open in doqtri");
    // Stellar Expert, on the registry's network.
    expect(html).toContain(`href="https://stellar.expert/explorer/testnet/contract/${REGISTRY}"`);
    // The project id is for the check, not for the page.
    expect(html).not.toContain(SOURCE.projectId);
  });

  it("names the on-chain version, not the link's, when the plan changed since", () => {
    const html = block({ ...VERIFIED, chainVersion: 5 });

    expect(verdictOf(html).text).toBe("Verified: planned in node h4, plan at v5");
    expect(anchorRow(html).text).toBe("Doc anchored at version ≥ v3 Now v5 on Testnet: the plan changed since v3.");
  });

  it("names the registry on stellar.expert's mainnet path for a mainnet registry", () => {
    const html = block({ ...VERIFIED, network: "mainnet" });

    expect(html).toContain(`href="https://stellar.expert/explorer/public/contract/${REGISTRY}"`);
    expect(words(html)).toContain("anchored on Mainnet");
  });

  it("counts a resubmitted milestone's node as evidence: it still names this milestone", () => {
    const html = block({
      ...VERIFIED,
      node: { state: "resubmitted", status: "Built", signedVersion: 2, chainVersion: 3, milestoneStatus: "Submitted" },
    });

    expect(html).toContain('data-verdict="verified"');
    expect(words(html)).toContain("(h4)");
  });
});

describe("PlannedInDoqtri, no node evidence (contract section 12)", () => {
  it.each(NO_EVIDENCE)("%s: linked to the doc only, no node id, never success-toned", (_, node) => {
    const html = block({ ...VERIFIED, node });
    const text = words(html);
    const verdict = verdictOf(html);

    expect(text).toContain(`Linked to doqtri doc ${SOURCE.docId}`);
    expect(text).toContain("Not signed in doqtri for this milestone yet.");
    expect(text).not.toContain("h4");
    expect(text).not.toContain("signed node");
    expect(text).not.toContain("came from a heading");
    expect(text).not.toContain("Node record");
    expect(html).not.toContain("data-node-state");
    // No node version either: the node's record is not shown at all.
    expect(text).not.toContain("v2");
    expect(verdict.text).toBe("Not verified");
    expect(verdict.className).not.toContain("text-success");
    expect(html).not.toContain("text-success");
    // The doc check still runs and is labelled for the doc alone.
    expect(anchorRow(html).text).toContain("Doc anchored at version ≥ v3");
    // The milestone title is public already; it is just not shown as a node.
    expect(text).not.toContain("Escrow contract");
  });

  it("says why for a project not on chain", () => {
    const html = block({ ...VERIFIED, node: NO_EVIDENCE[3][1] });

    expect(html).toContain('data-verdict="no-chain"');
    expect(words(html)).toContain("This project is not registered on chain");
  });

  it("says the link alone is not evidence", () => {
    const html = block({ ...VERIFIED, node: { state: "none" } });

    expect(html).toContain('data-verdict="unsigned"');
    expect(words(html)).toContain("qdit's link alone is not evidence of what doqtri planned.");
  });
});

describe("PlannedInDoqtri, the doc anchor alone is never a verdict", () => {
  it("not-anchored: a link with no version is unverified, even with the doc on chain now", () => {
    const html = block({ ...VERIFIED, state: "not-anchored", chainVersion: 1 }, { ...SOURCE, docVersion: null });
    const anchor = anchorRow(html);

    expect(html).toContain('data-state="not-anchored"');
    expect(html).toContain('data-verdict="doc"');
    expect(verdictOf(html).text).toBe("Not verified");
    expect(anchor.text).toContain("No linked version");
    expect(anchor.text).toContain("there is no linked version to check. DoqtriRegistry has it at v1 now.");
    expect(html).not.toMatch(/<p role="status" class="[^"]*text-success/);

    const never = anchorRow(
      block({ ...VERIFIED, state: "not-anchored", chainVersion: null, node: { state: "none" } }, { ...SOURCE, docVersion: null }),
    );
    expect(never.text).toContain("not anchored when this milestone was linked, and has no version on Testnet yet");
  });

  it("mismatch and not-found: says so, in the warning tone, never verified", () => {
    const mismatch = block({ ...VERIFIED, state: "mismatch", chainVersion: 2 });
    expect(anchorRow(mismatch).text).toContain("Doc not anchored at version ≥ v3");
    expect(anchorRow(mismatch).text).toContain("DoqtriRegistry has it at v2.");
    expect(anchorRow(mismatch).html).toContain("text-warning");

    const missing = block({ ...VERIFIED, state: "not-found", chainVersion: null });
    expect(anchorRow(missing).text).toContain("Doc not found on DoqtriRegistry");
    expect(anchorRow(missing).text).toContain("No doc with this id is anchored on Testnet");

    for (const html of [mismatch, missing]) {
      expect(verdictOf(html).text).toBe("Not verified");
      expect(verdictOf(html).className).toContain("text-warning");
    }
  });

  it("doc verified with any node record but evidence: muted anchor line, no success anywhere", () => {
    for (const [, node] of NO_EVIDENCE) {
      const html = block({ ...VERIFIED, node });
      expect(anchorRow(html).html).not.toContain("text-success");
      expect(anchorRow(html).html).toContain("text-muted-foreground");
    }
  });

  it("doc verified with an inconsistent node: not verified, naming the mismatch", () => {
    const html = block({
      ...VERIFIED,
      node: { state: "inconsistent", status: "Verified", signedVersion: 2, reason: "contract", chainVersion: null },
    });

    expect(html).toContain('data-verdict="inconsistent"');
    expect(verdictOf(html).text).toBe("Not verified");
    expect(verdictOf(html).className).toContain("text-warning");
    expect(words(html)).toContain("its record names another contract than this project's");
  });

  it("doc verified with the milestone record unread: could not check, never verified", () => {
    const html = block({ ...VERIFIED, node: { state: "unchecked", status: "Verified", signedVersion: 2 } });

    expect(html).toContain('data-verdict="unchecked"');
    expect(verdictOf(html).text).toBe("Could not check");
    expect(words(html)).toContain("This is not a pass");
    expect(html).not.toContain("text-success");
  });
});

describe("PlannedInDoqtri, the registry was not read", () => {
  it("unreachable: an explicit could-not-check, with no node id and no anchor line", () => {
    const html = block({ ...VERIFIED, state: "unreachable", chainVersion: null, node: null });
    const text = words(html);

    expect(html).toContain('data-state="unreachable"');
    expect(verdictOf(html).text).toBe("Could not check");
    expect(text).toContain("This is not a pass");
    expect(text).toContain(`Linked to doqtri doc ${SOURCE.docId}`);
    expect(text).toContain("Whether doqtri signed it for this milestone could not be checked.");
    expect(text).not.toContain("h4");
    expect(text).not.toContain("Doc anchor");
    expect(html).not.toContain("text-success");
    // The registry is still named, so a reader can check it themselves.
    expect(html).toContain(`/contract/${REGISTRY}"`);
  });

  it("unconfigured: could not check, and no registry link to a contract it does not know", () => {
    const html = block({
      state: "unconfigured",
      network: null,
      registryId: null,
      chainVersion: null,
      docUpdatedAt: null,
      node: null,
      nodeUpdatedAt: null,
    });
    const text = words(html);

    expect(verdictOf(html).text).toBe("Could not check");
    expect(text).toContain("does not read a DoqtriRegistry");
    expect(text).toContain("its version is anchored in the DoqtriRegistry contract");
    expect(text).not.toContain("h4");
    expect(html).not.toContain("stellar.expert");
    expect(html).not.toContain("text-success");
  });
});

describe("PlannedInDoqtri, the doqtri link", () => {
  it("links only the link built from the doc id", () => {
    const html = block(VERIFIED);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

    expect(hrefs.filter((href) => href.includes("doqtri"))).toEqual([SOURCE.docLink]);
  });

  it("offers no Open in doqtri link without one (DOQTRI_ORIGIN unset)", () => {
    const html = block(VERIFIED, { ...SOURCE, docLink: null });

    expect(words(html)).not.toContain("Open in doqtri");
    expect(html).not.toContain("doqtri.xyz");
  });
});

describe("PlannedInDoqtri, the node's record (fact 4), on evidence", () => {
  it("Verified with the milestone Approved at the same version: verified, in the success tone", () => {
    const row = nodeRow(VERIFIED.node!);
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
});
