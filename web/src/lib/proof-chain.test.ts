import { describe, expect, it } from "vitest";

import type { ChainMilestone, DocSourceCheck, MilestoneRead, NodeAttestation } from "@/lib/chain/doqtri-registry";
import { currentStep, proofChain, type ChainStep, type ProofChainInput } from "@/lib/proof-chain";
import type { PublicProof } from "@/lib/queries";

/**
 * The four steps of the public milestone page's proof chain (WP-3.3,
 * contract section 12), one state at a time. The reads are passed in, so
 * every state is a plain input here; the reads themselves are covered in
 * doqtri-registry.test.ts against real contract XDR.
 */

const PROOF_CONTRACT = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";
const REGISTRY = "CCCIDUCFQMTMAGESMPTB3MFW4TURS62ORSZNICFOE6MNQZO3MI7F6QRJ";
const OWNER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const HASH_V2 = "9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab";
const SUBMIT_TX = "5e1f0c3a9b7d2e4f6a8c0b1d3e5f7a9c2b4d6e8f0a1c3e5b7d9f1a3c5e7b9d0f";
const APPROVE_TX = "6f2a1d4bac8e3f5a7b9d1c2e4f6a8b0c3d5e7f9a1b2c4d6e8f0a2b4c6d8e0f1a";
const REJECT_TX = "7a3b2e5cbd9f4a6b8c0e2d3f5a7b9c1d4e6f8a0b2c3d5e7f9a1b3c5d7e9f0a2b";

/** 2026-10-22T08:11:40Z and 2026-10-24T12:00:00Z, in ledger seconds. */
const SUBMITTED_AT = 1792656700;
const SIGNED_AT = 1792843200;

const anchor = (
  action: PublicProof["anchors"][number]["action"],
  version: number,
  txHash: string,
  extra: Partial<PublicProof["anchors"][number]> = {},
): PublicProof["anchors"][number] => ({
  action,
  proofHash: action === "submit" ? HASH_V2 : null,
  version,
  txHash,
  network: "testnet",
  signerAddress: OWNER,
  ledger: 123456 + version,
  createdAt: `2026-10-2${version}T10:00:00.000Z`,
  ...extra,
});

const record = (status: ChainMilestone["status"], version = 2, extra: Partial<ChainMilestone> = {}): MilestoneRead => ({
  ok: true,
  record: { status, version, proofHash: HASH_V2, submitter: OWNER, timestamp: SUBMITTED_AT, ...extra },
});

const VERIFIED_CHECK: DocSourceCheck = {
  state: "verified",
  network: "testnet",
  registryId: REGISTRY,
  chainVersion: 3,
  docUpdatedAt: SIGNED_AT,
  node: { state: "current", status: "Verified", signedVersion: 2, milestoneStatus: "Approved" },
  nodeUpdatedAt: SIGNED_AT,
};

/** A milestone planned, submitted at v2, approved at v2, and signed Verified in doqtri. */
const DONE: ProofChainInput = {
  network: "testnet",
  contractId: PROOF_CONTRACT,
  anchors: [anchor("submit", 2, SUBMIT_TX), anchor("approve", 2, APPROVE_TX)],
  source: {
    docId: "c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
    nodeId: "h4",
    nodeLabel: "Escrow contract",
    docVersion: 3,
    docLink: "https://www.doqtri.xyz/d/c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f",
    projectId: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34",
  },
  check: VERIFIED_CHECK,
  milestone: record("Approved"),
};

const steps = (input: Partial<ProofChainInput>) => proofChain({ ...DONE, ...input });
const stepOf = (input: Partial<ProofChainInput>, key: ChainStep["key"]) =>
  steps(input).find((s) => s.key === key) as ChainStep;
const withNode = (node: NodeAttestation | null, check: Partial<DocSourceCheck> = {}) => ({
  check: { ...VERIFIED_CHECK, node, ...check },
});

describe("proofChain, every step done", () => {
  it("is four steps in order, each done, with nothing current", () => {
    const chain = proofChain(DONE);
    expect(chain.map((s) => [s.key, s.title, s.state])).toEqual([
      ["plan", "Plan version", "done"],
      ["submitted", "Submitted", "done"],
      ["approved", "Approved", "done"],
      ["verified", "Verified in doqtri", "done"],
    ]);
    expect(currentStep(chain)).toBeNull();
  });

  it("plan version names the node and the on-chain version, with the registry's ledger time and contract", () => {
    const plan = stepOf({}, "plan");
    expect(plan.summary).toBe(
      "Planned in node h4 of a doqtri plan anchored at v3 on Testnet, and the node is signed for this milestone.",
    );
    expect(plan.at).toEqual({ iso: "2026-10-24T12:00:00.000Z", source: "ledger" });
    expect(plan.link).toMatchObject({ kind: "contract", contractId: REGISTRY, network: "testnet" });
    expect(plan.link?.kind === "contract" && plan.link.note).toMatch(/does not keep doqtri's transactions/);
  });

  it("submitted shows the chain's hash, submitter and time, and qdit's transaction for that version", () => {
    const submitted = stepOf({}, "submitted");
    expect(submitted.summary).toBe("Proof v2 submitted on Testnet.");
    expect(submitted.proofHash).toBe(HASH_V2);
    expect(submitted.signer).toEqual({ address: OWNER, network: "testnet" });
    expect(submitted.at).toEqual({ iso: "2026-10-22T08:11:40.000Z", source: "ledger" });
    expect(submitted.link).toEqual({ kind: "tx", hash: SUBMIT_TX, network: "testnet", ledger: 123458, unconfirmed: false });
  });

  it("approved links the approve transaction at the record's version, with qdit's record time", () => {
    const approved = stepOf({}, "approved");
    expect(approved.summary).toBe("v2 approved on Testnet by the project's registered owner.");
    expect(approved.at).toEqual({ iso: "2026-10-22T10:00:00.000Z", source: "qdit" });
    expect(approved.link).toMatchObject({ kind: "tx", hash: APPROVE_TX, ledger: 123458 });
  });

  it("verified names the heading and the approved version, with the record's ledger time", () => {
    const verified = stepOf({}, "verified");
    expect(verified.summary).toBe("Heading h4 is signed Verified in doqtri for v2, the version approved on chain.");
    expect(verified.at).toEqual({ iso: "2026-10-24T12:00:00.000Z", source: "ledger" });
    expect(verified.link).toMatchObject({ kind: "contract", contractId: REGISTRY });
  });
});

describe("proofChain, transactions qdit has no record of", () => {
  it("links the contract and says why there is no transaction, never nothing", () => {
    const chain = steps({ anchors: [] });
    for (const key of ["submitted", "approved"] as const) {
      const s = chain.find((c) => c.key === key) as ChainStep;
      expect(s.state).toBe("done");
      expect(s.link).toMatchObject({ kind: "contract", contractId: PROOF_CONTRACT, network: "testnet" });
      expect(s.link?.kind === "contract" && s.link.note).toMatch(/about 7 days/);
      expect(s.link?.kind === "contract" && s.link.note).toMatch(/older than that cannot be looked up/);
    }
    // The record still speaks: hash, submitter and ledger time come from the chain.
    expect(chain[1].proofHash).toBe(HASH_V2);
    expect(chain[1].at?.source).toBe("ledger");
    expect(chain[2].at).toBeNull();
  });

  it("only uses a transaction for the record's version and the project's network", () => {
    const anchors = [
      anchor("submit", 1, "aa".repeat(32)),
      anchor("approve", 2, APPROVE_TX, { network: "mainnet" }),
      anchor("submit", 2, SUBMIT_TX, { network: "mainnet" }),
    ];
    const chain = steps({ anchors, milestone: record("Approved", 2) });
    expect(chain[1].link?.kind).toBe("contract");
    expect(chain[2].link?.kind).toBe("contract");
  });
});

describe("proofChain, plan version (step 1)", () => {
  it("pending while no heading is signed for this milestone, saying where the doc is", () => {
    const plan = stepOf(withNode({ state: "none" }), "plan");
    expect(plan.state).toBe("pending");
    expect(plan.summary).toMatch(/no heading of it is signed for this milestone yet/);
    expect(plan.summary).toMatch(/The doc is at v3 on DoqtriRegistry now\./);
    expect(plan.summary).not.toContain("h4");
  });

  it("pending, not a mismatch, when the doc was not anchored when it was linked", () => {
    const plan = stepOf(withNode(VERIFIED_CHECK.node, { state: "not-anchored" }), "plan");
    expect(plan.state).toBe("pending");
    expect(plan.summary).toMatch(/not anchored when this milestone was linked/);
  });

  it("pending for a project that is not on chain", () => {
    const node: NodeAttestation = { state: "inconsistent", status: "Verified", signedVersion: 2, reason: "no-chain", chainVersion: null };
    const plan = stepOf(withNode(node), "plan");
    expect(plan.state).toBe("pending");
    expect(plan.summary).toMatch(/not registered on chain/);
  });

  it("a mismatch when the registry is behind the link or has no such doc", () => {
    const behind = stepOf(withNode(VERIFIED_CHECK.node, { state: "mismatch", chainVersion: 2 }), "plan");
    expect(behind.state).toBe("mismatch");
    expect(behind.summary).toMatch(/link records v3, but DoqtriRegistry on Testnet has the doc at v2/);

    const missing = stepOf(withNode(VERIFIED_CHECK.node, { state: "not-found", chainVersion: null }), "plan");
    expect(missing.state).toBe("mismatch");
    expect(missing.summary).toMatch(/has no doc with this id/);
  });

  it("a mismatch when the heading's record does not line up with the milestone's", () => {
    const node: NodeAttestation = { state: "inconsistent", status: "Verified", signedVersion: 2, reason: "contract", chainVersion: null };
    expect(stepOf(withNode(node), "plan").state).toBe("mismatch");
  });

  it("could not check when a read failed or no registry is configured, never done", () => {
    const unchecked = stepOf(withNode({ state: "unchecked", status: "Verified", signedVersion: 2 }), "plan");
    expect(unchecked.state).toBe("unchecked");

    const down = stepOf(withNode(null, { state: "unreachable", chainVersion: null }), "plan");
    expect(down.state).toBe("unchecked");
    expect(down.summary).toBe("DoqtriRegistry on Testnet did not answer just now.");
    expect(down.link).toMatchObject({ kind: "contract", contractId: REGISTRY });

    const none = stepOf({ check: { ...VERIFIED_CHECK, state: "unconfigured", network: null, registryId: null, node: null } }, "plan");
    expect(none.state).toBe("unchecked");
    expect(none.link).toBeNull();
  });
});

describe("proofChain, submitted (step 2)", () => {
  it("pending for a project that is not registered, which reads nothing", () => {
    const chain = steps({ network: null, contractId: null, milestone: null, anchors: [] });
    expect(chain[1]).toMatchObject({ state: "pending", link: null });
    expect(chain[1].summary).toMatch(/not registered on chain yet/);
    expect(chain[2]).toMatchObject({ state: "pending", link: null });
  });

  it("pending, with the contract, when the chain has no record and qdit recorded none", () => {
    const submitted = stepOf({ milestone: { ok: true, record: null }, anchors: [] }, "submitted");
    expect(submitted).toMatchObject({ state: "pending", summary: "Not submitted on Testnet yet." });
    expect(submitted.link).toMatchObject({ kind: "contract", contractId: PROOF_CONTRACT });
  });

  it("a mismatch when qdit recorded a submission the chain does not have", () => {
    const none = stepOf({ milestone: { ok: true, record: null } }, "submitted");
    expect(none.state).toBe("mismatch");
    expect(none.summary).toMatch(/qdit recorded a submission \(v2\), but milestone_proof on Testnet has none/);
    expect(none.link).toMatchObject({ kind: "tx", hash: SUBMIT_TX, unconfirmed: true });

    const ahead = stepOf({ anchors: [...DONE.anchors, anchor("submit", 3, "bb".repeat(32))] }, "submitted");
    expect(ahead.state).toBe("mismatch");
    expect(ahead.summary).toMatch(/qdit recorded a submission at v3, which the chain does not have/);
    // The chain's version is what is shown and linked.
    expect(ahead.link).toMatchObject({ kind: "tx", hash: SUBMIT_TX });
  });

  it("a mismatch when qdit's record of the version names another hash; the chain's is shown", () => {
    const submitted = stepOf({ milestone: record("Approved", 2, { proofHash: "cd".repeat(32) }) }, "submitted");
    expect(submitted.state).toBe("mismatch");
    expect(submitted.proofHash).toBe("cd".repeat(32));
    expect(submitted.summary).toMatch(/names another proof hash/);
  });

  it("could not check when milestone_proof did not answer, with qdit's transaction marked unconfirmed", () => {
    const chain = steps({ milestone: { ok: false, reason: "timeout" } });
    expect(chain[1].state).toBe("unchecked");
    expect(chain[1].summary).toMatch(/could not be read just now\. qdit recorded v2 in the transaction linked here, unconfirmed\./);
    expect(chain[1].link).toMatchObject({ kind: "tx", hash: SUBMIT_TX, unconfirmed: true });
    expect(chain[1].proofHash).toBeNull();
    expect(chain[2].state).toBe("unchecked");
    expect(chain[2].link).toMatchObject({ kind: "tx", hash: APPROVE_TX, unconfirmed: true });
  });
});

describe("proofChain, approved (step 3)", () => {
  it("pending while the submission awaits a decision, and current", () => {
    const chain = steps({
      milestone: record("Submitted"),
      anchors: [anchor("submit", 2, SUBMIT_TX)],
      ...withNode({ state: "current", status: "Built", signedVersion: 2, milestoneStatus: "Submitted" }),
    });
    expect(chain.map((s) => s.state)).toEqual(["done", "done", "pending", "pending"]);
    expect(chain[2].summary).toBe("v2 awaits the project owner's decision on Testnet.");
    expect(currentStep(chain)).toBe("approved");
  });

  it("pending, saying so, after a rejection, with the reject transaction", () => {
    const approved = stepOf(
      { milestone: record("Rejected"), anchors: [anchor("submit", 2, SUBMIT_TX), anchor("reject", 2, REJECT_TX)] },
      "approved",
    );
    expect(approved.state).toBe("pending");
    expect(approved.summary).toBe("Not approved: v2 was rejected on Testnet. A new submission would be v3.");
    expect(approved.link).toMatchObject({ kind: "tx", hash: REJECT_TX });
  });

  it("pending when nothing is on chain to approve", () => {
    expect(stepOf({ milestone: { ok: true, record: null }, anchors: [] }, "approved")).toMatchObject({
      state: "pending",
      summary: "Nothing is submitted on chain to approve yet.",
    });
  });
});

describe("proofChain, verified in doqtri (step 4)", () => {
  it("pending while no heading is signed for this milestone, never naming a node", () => {
    for (const node of [
      { state: "none" },
      { state: "other", status: "Built", tool: "rollup" },
      { state: "elsewhere", status: "Verified" },
    ] as NodeAttestation[]) {
      const verified = stepOf(withNode(node), "verified");
      expect(verified.state).toBe("pending");
      expect(verified.summary).toBe("Not yet verified in doqtri: no heading is signed for this milestone.");
      expect(verified.at).toBeNull();
    }
  });

  it("pending while the heading is signed with another status", () => {
    const verified = stepOf(
      withNode({ state: "current", status: "Built", signedVersion: 2, milestoneStatus: "Approved" }),
      "verified",
    );
    expect(verified.state).toBe("pending");
    expect(verified.summary).toBe("Not yet verified in doqtri: heading h4 is signed Built for v2.");
  });

  it("a mismatch when signed Verified but the chain does not say Approved at that version", () => {
    const rejected = stepOf(
      withNode({ state: "current", status: "Verified", signedVersion: 2, milestoneStatus: "Rejected" }),
      "verified",
    );
    expect(rejected.state).toBe("mismatch");
    expect(rejected.summary).toBe("Heading h4 is signed as Verified for v2; the chain now says Rejected. Not verified.");

    const resubmitted = stepOf(
      withNode({ state: "resubmitted", status: "Verified", signedVersion: 2, chainVersion: 3, milestoneStatus: "Submitted" }),
      "verified",
    );
    expect(resubmitted.state).toBe("mismatch");
    expect(resubmitted.summary).toMatch(/resubmitted since and is Submitted at v3\. The signature refers to v2\./);
  });

  it("pending after a resubmission when the heading was not signed Verified", () => {
    const verified = stepOf(
      withNode({ state: "resubmitted", status: "Built", signedVersion: 2, chainVersion: 3, milestoneStatus: "Submitted" }),
      "verified",
    );
    expect(verified.state).toBe("pending");
    expect(verified.summary).toMatch(/signed Built for v2, and the milestone was resubmitted since \(now v3\)/);
  });

  it("a mismatch, with the reason, when the record names another network or contract or a version the chain lacks", () => {
    const older: NodeAttestation = { state: "inconsistent", status: "Verified", signedVersion: 3, reason: "older", chainVersion: 2 };
    const verified = stepOf(withNode(older), "verified");
    expect(verified.state).toBe("mismatch");
    expect(verified.summary).toBe(
      "Heading h4 is signed as Verified for v3, but the milestone's record on chain is at v2, older than v3. Not verified.",
    );
    // D-74: another network or contract is no node evidence, so the step names
    // neither the node nor its version.
    for (const reason of ["network", "contract"] as const) {
      const other: NodeAttestation = { state: "inconsistent", status: "Verified", signedVersion: 2, reason, chainVersion: null };
      const step = stepOf(withNode(other), "verified");
      expect(step.state).toBe("mismatch");
      expect(step.summary).toBe(
        `A heading of this doc is signed for this milestone, but its record names another ${reason} than this project's registration. Not verified.`,
      );
      expect(step.summary).not.toContain("h4");
      expect(stepOf(withNode(other), "plan").state).toBe("mismatch");
    }
  });

  it("could not check when a read failed or no registry is configured", () => {
    expect(stepOf(withNode({ state: "unchecked", status: "Verified", signedVersion: 2 }), "verified").state).toBe("unchecked");
    expect(stepOf(withNode(null, { state: "unreachable" }), "verified")).toMatchObject({
      state: "unchecked",
      summary: "DoqtriRegistry on Testnet did not answer just now.",
    });
    expect(
      stepOf({ check: { ...VERIFIED_CHECK, state: "unconfigured", network: null, registryId: null, node: null } }, "verified"),
    ).toMatchObject({ state: "unchecked", link: null });
  });
});

describe("proofChain, step 3 against qdit's own decisions (WP-2.12)", () => {
  it.each([
    ["Submitted", "awaits a decision"],
    ["Rejected", "was rejected"],
  ] as const)("a mismatch when qdit recorded an approval the chain does not have (%s)", (status, says) => {
    const approved = stepOf(
      { milestone: record(status), anchors: [anchor("submit", 2, SUBMIT_TX), anchor("approve", 2, APPROVE_TX)] },
      "approved",
    );
    expect(approved.state).toBe("mismatch");
    expect(approved.summary).toBe(`qdit recorded an approval of v2, but milestone_proof on Testnet says v2 ${says}.`);
    expect(approved.link).toEqual({ kind: "tx", hash: APPROVE_TX, network: "testnet", ledger: 123458, unconfirmed: true });
  });

  it("a mismatch when qdit recorded a rejection while the chain says Approved", () => {
    const approved = stepOf(
      {
        anchors: [anchor("submit", 2, SUBMIT_TX), anchor("reject", 2, REJECT_TX), anchor("approve", 2, APPROVE_TX)],
      },
      "approved",
    );
    expect(approved.state).toBe("mismatch");
    expect(approved.summary).toBe("qdit recorded a rejection of v2, but milestone_proof on Testnet says v2 is approved.");
    expect(approved.link).toMatchObject({ kind: "tx", hash: REJECT_TX, unconfirmed: true });
  });

  it("only qdit's decisions at the record's version count", () => {
    // A v1 approval recorded before a resubmission says nothing about v2.
    const approved = stepOf(
      { milestone: record("Submitted"), anchors: [anchor("approve", 1, APPROVE_TX), anchor("submit", 2, SUBMIT_TX)] },
      "approved",
    );
    expect(approved.state).toBe("pending");
  });

  it("keyed on the current record, noting a heading signed for another version (D-78)", () => {
    const approved = stepOf(
      withNode({ state: "resubmitted", status: "Built", signedVersion: 1, chainVersion: 2, milestoneStatus: "Approved" }),
      "approved",
    );
    expect(approved.state).toBe("done");
    expect(approved.summary).toBe(
      "v2 approved on Testnet by the project's registered owner. The doqtri heading was signed for v1, an older version of this milestone.",
    );
    // No note when the versions agree, for a reference ahead of the record
    // (inconsistent, step 4's to say), or without node evidence to name one.
    expect(stepOf({}, "approved").summary).toBe("v2 approved on Testnet by the project's registered owner.");
    expect(
      stepOf(
        withNode({ state: "inconsistent", status: "Verified", signedVersion: 3, reason: "older", chainVersion: 2 }),
        "approved",
      ).summary,
    ).toBe("v2 approved on Testnet by the project's registered owner.");
    expect(
      stepOf(
        withNode({ state: "inconsistent", status: "Verified", signedVersion: 1, reason: "contract", chainVersion: null }),
        "approved",
      ).summary,
    ).toBe("v2 approved on Testnet by the project's registered owner.");
  });
});

describe("proofChain, the node id could not be looked up (D-77)", () => {
  it("steps 1 and 4 could not check, with the registry linked; steps 2 and 3 still read", () => {
    const chain = steps({
      source: { ...DONE.source, nodeId: null },
      check: { ...VERIFIED_CHECK, state: "unavailable", chainVersion: null, docUpdatedAt: null, node: null, nodeUpdatedAt: null },
    });
    expect(chain.map((s) => s.state)).toEqual(["unchecked", "done", "done", "unchecked"]);
    expect(chain[0].summary).toMatch(/could not look up which doqtri heading/);
    expect(chain[0].link).toMatchObject({ kind: "contract", contractId: REGISTRY });
    expect(chain[3].link).toMatchObject({ kind: "contract", contractId: REGISTRY });
  });
});

describe("proofChain, the registry's facts are read from current state", () => {
  it("steps 1 and 4 say where the history is", () => {
    for (const key of ["plan", "verified"] as const) {
      const link = stepOf({}, key).link;
      expect(link?.kind === "contract" && link.note).toContain(
        "Read from current state; see the contract's history on Stellar Expert for the transaction.",
      );
    }
  });
});
