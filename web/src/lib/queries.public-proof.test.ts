import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `getPublicProof` passes the doqtri reference of a linked milestone through
 * (WP-3.2), hand-listed, with the doqtri link built from `DOQTRI_ORIGIN` and
 * the doc id (contract section 12), never a stored `doc_url`: the function
 * sends one only on doqtri's origin (D-77), and it is dropped either way. An
 * unlinked milestone's answer is returned as the function sent it, with no
 * `docSource` added.
 *
 * The node id comes only from the service-role lookup (`readPublicNodeId`,
 * D-77), never from the anon answer.
 */
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: async () => null,
}));

const readPublicNodeId = vi.fn();
vi.mock("@/lib/public-node", () => ({
  readPublicNodeId: (...args: unknown[]) => readPublicNodeId(...args),
}));

const { getPublicProof } = await import("./queries");

const BASE = {
  projectName: "Soroban payroll",
  projectSlug: "soroban-payroll",
  milestoneId: "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61",
  title: "Escrow contract",
  status: "submitted",
  dueDate: null,
  network: "testnet",
  contractId: null,
  registeredTx: null,
  ownerAddress: null,
  anchors: [],
  reviews: [],
};

/** The anon answer's docSource (20261026100200): no node id. */
const SOURCE = {
  docId: "c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
  nodeLabel: "Escrow contract",
  docVersion: 7,
  projectId: null,
};

const LINK = "https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f";

function answer(data: unknown) {
  const db = fakeDatabase({ rpc: { public_milestone_proof: [{ data, error: null }] } });
  createClient.mockResolvedValue(db.client);
  readPublicNodeId.mockResolvedValue({ ok: true, nodeId: "h4" });
  return db;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete process.env.DOQTRI_ORIGIN;
});

describe("getPublicProof", () => {
  it("returns an unlinked milestone's answer as sent, with no docSource", async () => {
    const db = answer(BASE);

    const proof = await getPublicProof("soroban-payroll", BASE.milestoneId);

    expect(proof).toEqual(BASE);
    expect(proof && "docSource" in proof).toBe(false);
    expect(db.requests[0].args).toEqual({ p_slug: "soroban-payroll", p_milestone_id: BASE.milestoneId });
    // Nothing to look up for an unlinked milestone.
    expect(readPublicNodeId).not.toHaveBeenCalled();
  });

  it("keeps the doc reference and builds the doqtri link from DOQTRI_ORIGIN and the doc id", async () => {
    process.env.DOQTRI_ORIGIN = "https://www.doqtri.xyz";
    answer({ ...BASE, docSource: SOURCE });

    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toEqual({
      ...BASE,
      docSource: { ...SOURCE, nodeId: "h4", docLink: LINK },
    });
    expect(readPublicNodeId).toHaveBeenCalledWith("soroban-payroll", BASE.milestoneId);
  });

  it("takes the node id from the server-side lookup only, never from the anon answer (D-77)", async () => {
    answer({ ...BASE, docSource: { ...SOURCE, nodeId: "h9" } });
    readPublicNodeId.mockResolvedValue({ ok: true, nodeId: "h4" });

    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toMatchObject({
      docSource: { nodeId: "h4" },
    });
  });

  it("has no node id when the lookup fails, so the page says it could not check", async () => {
    answer({ ...BASE, docSource: SOURCE });
    readPublicNodeId.mockResolvedValue({ ok: false });

    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toMatchObject({
      docSource: { docId: SOURCE.docId, nodeId: null },
    });
  });

  it("never passes on a stored doc_url, even one naming another doqtri page", async () => {
    process.env.DOQTRI_ORIGIN = "https://www.doqtri.xyz";
    answer({ ...BASE, docSource: { ...SOURCE, docUrl: "https://www.doqtri.xyz/d/another-doc?x=1", docTitle: "Secret" } });

    const proof = await getPublicProof("soroban-payroll", BASE.milestoneId);

    expect(proof?.docSource).toEqual({ ...SOURCE, nodeId: "h4", docLink: LINK });
    expect(JSON.stringify(proof)).not.toContain("another-doc");
    expect(JSON.stringify(proof)).not.toContain("Secret");
  });

  it("encodes the doc id into the path", async () => {
    process.env.DOQTRI_ORIGIN = "https://www.doqtri.xyz";
    answer({ ...BASE, docSource: { ...SOURCE, docId: "a/../b?c" } });

    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toMatchObject({
      docSource: { docLink: "https://www.doqtri.xyz/d/a%2F..%2Fb%3Fc" },
    });
  });

  it("has no doqtri link with DOQTRI_ORIGIN unset", async () => {
    answer({ ...BASE, docSource: SOURCE });

    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toEqual({
      ...BASE,
      docSource: { ...SOURCE, nodeId: "h4", docLink: null },
    });
  });

  it("follows DOQTRI_ORIGIN, and has no link when it is misconfigured", async () => {
    process.env.DOQTRI_ORIGIN = "https://preview.doqtri.example";
    answer({ ...BASE, docSource: SOURCE });
    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toMatchObject({
      docSource: { docLink: `https://preview.doqtri.example/d/${SOURCE.docId}` },
    });

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DOQTRI_ORIGIN = "https://preview.doqtri.example/path";
    answer({ ...BASE, docSource: SOURCE });
    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toMatchObject({
      docSource: { docId: SOURCE.docId, docLink: null },
    });
    expect(error).toHaveBeenCalled();
  });

  it("is null when the function answers null", async () => {
    answer(null);

    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toBeNull();
  });
});
