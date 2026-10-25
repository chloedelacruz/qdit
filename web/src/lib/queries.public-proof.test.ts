import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `getPublicProof` passes the doqtri reference of a linked milestone through
 * (WP-3.2), but its `docUrl` only when the URL is on doqtri's origin (D-45,
 * D-72): the function sends `doc_url` as stored, and the table holds it only
 * to https. An unlinked milestone's answer is returned as the function sent
 * it, with no `docSource` added.
 */
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: async () => null,
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

const SOURCE = {
  docId: "c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
  nodeId: "h4",
  nodeLabel: "Escrow contract",
  docVersion: 7,
  docUrl: "https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
  projectId: null,
};

function answer(data: unknown) {
  const db = fakeDatabase({ rpc: { public_milestone_proof: [{ data, error: null }] } });
  createClient.mockResolvedValue(db.client);
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
  });

  it("keeps the doc reference and a doc URL on doqtri's origin", async () => {
    answer({ ...BASE, docSource: SOURCE });

    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toEqual({
      ...BASE,
      docSource: SOURCE,
    });
  });

  it.each([
    ["another host", "https://www.doqtri.xyz.evil.example/d/1"],
    ["user info", "https://www.doqtri.xyz@evil.example/d/1"],
    ["the bare origin", "https://www.doqtri.xyz"],
    ["a query straight after the origin", "https://www.doqtri.xyz?d=1"],
    ["a fragment straight after the origin", "https://www.doqtri.xyz#d"],
  ])("drops a doc URL on %s, keeping the rest", async (_, docUrl) => {
    answer({ ...BASE, docSource: { ...SOURCE, docUrl } });

    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toEqual({
      ...BASE,
      docSource: { ...SOURCE, docUrl: null },
    });
  });

  it("follows DOQTRI_ORIGIN, and drops the URL when it is misconfigured", async () => {
    process.env.DOQTRI_ORIGIN = "https://preview.doqtri.example";
    answer({ ...BASE, docSource: { ...SOURCE, docUrl: "https://preview.doqtri.example/d/1" } });
    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toMatchObject({
      docSource: { docUrl: "https://preview.doqtri.example/d/1" },
    });

    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DOQTRI_ORIGIN = "https://preview.doqtri.example/path";
    answer({ ...BASE, docSource: SOURCE });
    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toMatchObject({
      docSource: { docId: SOURCE.docId, docUrl: null },
    });
  });

  it("is null when the function answers null", async () => {
    answer(null);

    await expect(getPublicProof("soroban-payroll", BASE.milestoneId)).resolves.toBeNull();
  });
});
