import { describe, expect, it } from "vitest";

import { buildAnchorCsv, buildCertificateHtml } from "@/lib/export";
import type { AnchorExport, MilestoneCertificate } from "@/lib/queries";

/**
 * The export builders are pure string templates, which is exactly the part
 * worth pinning: a CSV that mis-escapes a field silently corrupts a spreadsheet,
 * and a certificate that interpolates a title without escaping it is an
 * injection into a file someone else will open.
 */

const PROJECT: AnchorExport["project"] = {
  name: "Rainforest Registry",
  slug: "rainforest-registry",
  contractId: "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG",
  ownerAddress: "GA6HCMBLTZS5VYYBCATRBRZ3BZJMAFUDKYYF6AH6MVCMGWMRDNSWJPIH",
  network: "testnet",
  registeredTx: "a".repeat(64),
};

const ANCHOR: AnchorExport["rows"][number] = {
  milestoneId: "m1",
  milestoneTitle: "Batch 12 shipped",
  status: "approved",
  action: "submit",
  version: 1,
  proofHash: "b".repeat(64),
  txHash: "c".repeat(64),
  ledger: 55_123,
  network: "testnet",
  signerAddress: PROJECT.ownerAddress!,
  createdAt: "2026-08-30T12:34:56.000Z",
};

describe("buildAnchorCsv", () => {
  it("emits a header and one row per anchor, CRLF-terminated", () => {
    const csv = buildAnchorCsv({ project: PROJECT, rows: [ANCHOR] });
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe(
      "milestone,status,action,version,digest,tx_hash,ledger,network,signer,timestamp_utc",
    );
    expect(lines[1]).toContain("Batch 12 shipped");
    expect(lines[1]).toContain("b".repeat(64));
    expect(lines[1]).toContain("55123");
    // Trailing CRLF leaves an empty final element.
    expect(lines.at(-1)).toBe("");
  });

  it("quotes and escapes a field containing a comma or a quote", () => {
    const csv = buildAnchorCsv({
      project: PROJECT,
      rows: [{ ...ANCHOR, milestoneTitle: 'Phase 2, "final"' }],
    });

    // Comma forces quoting; the inner quotes are doubled.
    expect(csv).toContain('"Phase 2, ""final"""');
  });

  it("renders a null digest or ledger as an empty field, not the word null", () => {
    const csv = buildAnchorCsv({
      project: PROJECT,
      rows: [{ ...ANCHOR, action: "approve", proofHash: null, ledger: null }],
    });
    const row = csv.split("\r\n")[1];

    expect(row).not.toContain("null");
    // digest and ledger positions are empty: two adjacent commas each.
    expect(row).toContain(",,"); // digest between action/version… at least one empty run
  });
});

describe("buildCertificateHtml", () => {
  const CERT: MilestoneCertificate = {
    project: PROJECT,
    milestone: { id: "m1", title: "Batch 12 shipped", status: "approved" },
    currentDigest: "b".repeat(64),
    anchors: [ANCHOR],
    reviews: [
      {
        fromStatus: "submitted",
        toStatus: "approved",
        reason: "Lab results matched the declared batch.",
        createdAt: "2026-08-30T13:00:00.000Z",
      },
    ],
    generatedAt: "2026-08-31T00:00:00.000Z",
  };

  it("is one self-contained document that links the transaction to the ledger", () => {
    const html = buildCertificateHtml(CERT);

    expect(html.startsWith("<!doctype html>")).toBe(true);
    // No external stylesheet or script — it must open offline.
    expect(html).not.toMatch(/<link[^>]+href=|<script/i);
    // The verification link points at the explorer, not at qdit.
    expect(html).toContain(`stellar.expert`);
    expect(html).toContain("c".repeat(12)); // truncated tx hash in the link text
    expect(html).toContain("Lab results matched the declared batch.");
  });

  it("escapes a hostile milestone title rather than emitting it as markup", () => {
    const html = buildCertificateHtml({
      ...CERT,
      milestone: { ...CERT.milestone, title: '<img src=x onerror=alert(1)>' },
    });

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});
