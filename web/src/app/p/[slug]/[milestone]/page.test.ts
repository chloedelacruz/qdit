import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DocSourceCheck } from "@/lib/chain/doqtri-registry";
import type { PublicProof } from "@/lib/queries";

/**
 * The public milestone page, rendered to markup with its data mocked (WP-3.2).
 *
 * The page is an async server component, so it is called as a function and
 * the element it returns is rendered the way the unit tests render every
 * server component here: to static markup, in Node, without a DOM.
 *
 * The golden file is the markup the page produced for an unlinked milestone
 * before WP-3.2 touched it. A milestone with no doqtri link must render
 * exactly that, byte for byte, and must not ask the registry anything.
 */

const stub = vi.hoisted(() => ({
  proof: null as unknown,
  check: vi.fn(),
}));

vi.mock("@/lib/queries", () => ({
  getPublicProof: async () => stub.proof,
}));

// Only the chain read is stubbed; the pure helpers the block uses stay real.
vi.mock("@/lib/chain/doqtri-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chain/doqtri-registry")>()),
  checkDocSource: stub.check,
}));

const { default: PublicProofPage } = await import("@/app/p/[slug]/[milestone]/page");

const UNLINKED: PublicProof = {
  projectName: "Soroban payroll",
  projectSlug: "soroban-payroll",
  milestoneId: "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61",
  title: "Escrow contract",
  status: "approved",
  dueDate: "2026-11-15",
  network: "testnet",
  contractId: "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG",
  registeredTx: "1f0c3a9b7d2e4f6a8c0b1d3e5f7a9c2b4d6e8f0a1c3e5b7d9f1a3c5e7b9d0f5e",
  ownerAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
  anchors: [
    {
      action: "submit",
      proofHash: "9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab",
      version: 1,
      txHash: "5e1f0c3a9b7d2e4f6a8c0b1d3e5f7a9c2b4d6e8f0a1c3e5b7d9f1a3c5e7b9d0f",
      network: "testnet",
      signerAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
      ledger: 123456,
      createdAt: "2026-10-22T08:11:40.000Z",
    },
    {
      action: "approve",
      proofHash: null,
      version: 2,
      txHash: "6f2a1d4bac8e3f5a7b9d1c2e4f6a8b0c3d5e7f9a1b2c4d6e8f0a2b4c6d8e0f1a",
      network: "testnet",
      signerAddress: "GA6HCMBLTZS5VYYBCATRBRZ3BZJMAFUDKYYF6AH6MVCMGWMRDNSWJPIH",
      ledger: 123999,
      createdAt: "2026-10-23T10:00:00.000Z",
    },
  ],
  reviews: [
    {
      fromStatus: "submitted",
      toStatus: "approved",
      reason: "Escrow audited and deployed.",
      createdAt: "2026-10-23T10:00:05.000Z",
    },
  ],
};

const GOLDEN = new URL("./page.unlinked.golden.html", import.meta.url);

async function render(proof: PublicProof): Promise<string> {
  stub.proof = proof;
  const element = await PublicProofPage({
    params: Promise.resolve({ slug: proof.projectSlug, milestone: proof.milestoneId }),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  stub.check.mockReset();
});

afterEach(() => {
  stub.proof = null;
});

describe("public milestone page, unlinked", () => {
  it("renders exactly the pre-WP-3.2 markup and reads no registry", async () => {
    const html = await render(UNLINKED);

    expect(html).toBe(readFileSync(GOLDEN, "utf8"));
    expect(html).not.toContain("doqtri");
    expect(stub.check).not.toHaveBeenCalled();
  });
});

describe("public milestone page, linked to a doqtri heading", () => {
  const LINKED: PublicProof = {
    ...UNLINKED,
    docSource: {
      docId: "c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
      nodeId: "h4",
      nodeLabel: "Escrow contract",
      docVersion: 3,
      docUrl: "https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
      projectId: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34",
    },
  };

  const VERIFIED: DocSourceCheck = {
    state: "verified",
    network: "testnet",
    registryId: "CCCIDUCFQMTMAGESMPTB3MFW4TURS62ORSZNICFOE6MNQZO3MI7F6QRJ",
    chainVersion: 3,
    node: { state: "current", status: "Verified", signedVersion: 2, milestoneStatus: "Approved" },
  };

  it("checks the heading's record against the project's own registration", async () => {
    stub.check.mockResolvedValue(VERIFIED);

    await render(LINKED);

    expect(stub.check).toHaveBeenCalledTimes(1);
    expect(stub.check).toHaveBeenCalledWith(LINKED.docSource, {
      milestoneId: LINKED.milestoneId,
      project: { id: LINKED.docSource?.projectId, network: "testnet", contractId: LINKED.contractId },
    });
  });

  it("adds the Planned in doqtri block and changes nothing else", async () => {
    stub.check.mockResolvedValue(VERIFIED);

    const html = await render(LINKED);
    const block = /<section data-slot="planned-in-doqtri"[\s\S]*?<\/section>/.exec(html);

    expect(block?.[0]).toContain("Planned in doqtri");
    expect(block?.[0]).toContain("Verified on DoqtriRegistry at v3");
    expect(html.replace(block?.[0] ?? "", "")).toBe(readFileSync(GOLDEN, "utf8"));
  });

  it("checks a project that never registered with no registration to hold the node to", async () => {
    stub.check.mockResolvedValue({ ...VERIFIED, state: "unreachable", chainVersion: null, node: null });
    const unregistered = { ...LINKED.docSource!, projectId: null };

    const html = await render({ ...LINKED, network: null, contractId: null, docSource: unregistered });

    expect(stub.check).toHaveBeenCalledWith(unregistered, {
      milestoneId: LINKED.milestoneId,
      project: null,
    });
    expect(html).toContain('data-state="unreachable"');
    expect(html).toContain("Could not check");
  });
});
