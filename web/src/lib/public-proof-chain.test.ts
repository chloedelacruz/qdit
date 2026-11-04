import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChainStep } from "@/lib/proof-chain";
import type { PublicProof } from "@/lib/queries";

/**
 * The chain reads and the step builder are stood in for; what is under test
 * is the orchestration: who is read, with which project, and the D-97 rule
 * that a contradiction is only shown when a fresh read still has it.
 * `contradictsQditRecord` stays real, so the rule is the shipped one.
 */
const checkDocSource = vi.fn();
const checkMilestoneRecord = vi.fn();
vi.mock("@/lib/chain/doqtri-registry", () => ({
  checkDocSource: (...args: unknown[]) => checkDocSource(...args),
  checkMilestoneRecord: (...args: unknown[]) => checkMilestoneRecord(...args),
}));

const proofChain = vi.fn();
vi.mock("@/lib/proof-chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proof-chain")>()),
  proofChain: (...args: unknown[]) => proofChain(...args),
}));

const { readPublicChain } = await import("./public-proof-chain");

const CONTRACT = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";
const SOURCE = { docId: "doc-1", nodeId: "node-1", docVersion: 3, projectId: "proj-chain-id", nodeLabel: "Ship" };

function proof(overrides: Partial<PublicProof> = {}): PublicProof {
  return {
    milestoneId: "m-1",
    network: "testnet",
    contractId: CONTRACT,
    anchors: [],
    docSource: SOURCE,
    ...overrides,
  } as unknown as PublicProof;
}

const steps = (submitted: ChainStep["state"], approved: ChainStep["state"]): ChainStep[] =>
  [
    { key: "plan", state: "done" },
    { key: "submitted", state: submitted },
    { key: "approved", state: approved },
    { key: "verified", state: "pending" },
  ] as ChainStep[];

afterEach(() => {
  vi.clearAllMocks();
});

describe("readPublicChain", () => {
  it("is null when the milestone has no doc source: nothing to check", async () => {
    await expect(readPublicChain(proof({ docSource: undefined }))).resolves.toBeNull();
    expect(checkDocSource).not.toHaveBeenCalled();
  });

  it("reads the doc source and the milestone record against the project's registration", async () => {
    checkDocSource.mockResolvedValue({ state: "verified" });
    checkMilestoneRecord.mockResolvedValue({ ok: true, record: null });
    proofChain.mockReturnValue(steps("done", "done"));

    const chain = await readPublicChain(proof());

    const project = { id: "proj-chain-id", network: "testnet", contractId: CONTRACT };
    expect(checkDocSource).toHaveBeenCalledTimes(1);
    expect(checkDocSource.mock.calls[0][0]).toBe(SOURCE);
    expect(checkDocSource.mock.calls[0][1]).toEqual({ milestoneId: "m-1", project });
    expect(checkDocSource.mock.calls[0][2]).toMatchObject({ freshMilestone: false });
    expect(checkMilestoneRecord).toHaveBeenCalledWith(project, "m-1", { now: undefined, fresh: false });
    expect(proofChain.mock.calls[0][0]).toMatchObject({
      network: "testnet",
      contractId: CONTRACT,
      source: SOURCE,
      check: { state: "verified" },
      milestone: { ok: true, record: null },
    });
    expect(chain).toEqual({ check: { state: "verified" }, steps: steps("done", "done") });
  });

  it("without a registration (no contract, or no chain project id), reads no milestone record", async () => {
    checkDocSource.mockResolvedValue({ state: "verified" });
    proofChain.mockReturnValue(steps("pending", "pending"));

    for (const p of [proof({ contractId: null }), proof({ network: null }), proof({ docSource: { ...SOURCE, projectId: null } } as never)]) {
      await readPublicChain(p);
    }

    expect(checkMilestoneRecord).not.toHaveBeenCalled();
    for (const call of checkDocSource.mock.calls) expect(call[1].project).toBeNull();
    for (const call of proofChain.mock.calls) expect(call[0].milestone).toBeNull();
  });

  it("D-97: a contradiction on the cached read triggers one fresh read, whose chain is shown", async () => {
    checkDocSource.mockResolvedValue({ state: "verified" });
    checkMilestoneRecord.mockResolvedValue({ ok: true, record: null });
    proofChain.mockReturnValueOnce(steps("done", "mismatch")).mockReturnValueOnce(steps("done", "done"));

    const chain = await readPublicChain(proof());

    expect(checkMilestoneRecord).toHaveBeenCalledTimes(2);
    expect(checkMilestoneRecord.mock.calls[1][2]).toMatchObject({ fresh: true });
    expect(checkDocSource.mock.calls[1][2]).toMatchObject({ freshMilestone: true });
    expect(chain?.steps).toEqual(steps("done", "done"));
  });

  it("D-97: a contradiction that survives the fresh read is shown", async () => {
    checkDocSource.mockResolvedValue({ state: "verified" });
    checkMilestoneRecord.mockResolvedValue({ ok: true, record: null });
    proofChain.mockReturnValue(steps("mismatch", "pending"));

    const chain = await readPublicChain(proof());

    expect(checkMilestoneRecord).toHaveBeenCalledTimes(2);
    expect(chain?.steps[1].state).toBe("mismatch");
  });

  it("a mismatch on the plan or verified step alone does not re-read", async () => {
    checkDocSource.mockResolvedValue({ state: "mismatch" });
    checkMilestoneRecord.mockResolvedValue({ ok: true, record: null });
    proofChain.mockReturnValue([
      { key: "plan", state: "mismatch" },
      { key: "submitted", state: "done" },
      { key: "approved", state: "done" },
      { key: "verified", state: "mismatch" },
    ]);

    await readPublicChain(proof());
    expect(checkMilestoneRecord).toHaveBeenCalledTimes(1);
  });

  it("passes the clock and env through to the chain reads", async () => {
    checkDocSource.mockResolvedValue({ state: "verified" });
    checkMilestoneRecord.mockResolvedValue({ ok: true, record: null });
    proofChain.mockReturnValue(steps("done", "done"));
    const now = () => 42;
    const env = { DOQTRI_REGISTRY_NETWORK: "testnet" };

    await readPublicChain(proof(), { now, env });

    expect(checkDocSource.mock.calls[0][2]).toMatchObject({ now, env });
    expect(checkMilestoneRecord.mock.calls[0][2]).toMatchObject({ now });
  });
});
