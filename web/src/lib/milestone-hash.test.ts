import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalMilestone,
  canonicalMilestoneV1,
  isMilestoneAnchorStale,
  milestoneProofHash,
  proofHashBytes,
  type MilestoneDigestInput,
  type ProofDigestInput,
} from "@/lib/milestone-hash";

/**
 * The digest is a cross-system contract, and the expensive failure is silent.
 *
 * A change to the canonical form does not break a build or fail a type check —
 * it just means every hash already on the ledger stops matching the milestone
 * it was taken from, and every anchor in the app quietly reads "stale" with no
 * explanation. So these tests pin the encoding itself, not only its properties.
 */

function proof(overrides: Partial<ProofDigestInput> = {}): ProofDigestInput {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    contractId: null,
    txHash: null,
    network: "testnet",
    walletAddress: null,
    proofUrl: null,
    ...overrides,
  };
}

function milestone(overrides: Partial<MilestoneDigestInput> = {}): MilestoneDigestInput {
  return {
    id: "8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2",
    projectId: "c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7",
    title: "Ship the contract",
    description: null,
    dueDate: null,
    proofs: [],
    ...overrides,
  };
}

describe("canonicalMilestone", () => {
  it("length-prefixes every field and marks nulls", () => {
    expect(canonicalMilestone(milestone())).toBe(
      "17:qdit/milestone/v2" +
        "|36:8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2" +
        "|36:c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7" +
        "|17:Ship the contract" +
        "|~" +
        "|~" +
        "|1:0",
    );
  });

  /** v1 anchors are on the ledger for good, so its form stays pinned too. */
  it("keeps v1's form, with the status, for anchors taken under it", () => {
    expect(canonicalMilestoneV1(milestone(), "submitted")).toBe(
      "17:qdit/milestone/v1" +
        "|36:8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2" +
        "|36:c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7" +
        "|17:Ship the contract" +
        "|~" +
        "|9:submitted" +
        "|~" +
        "|1:0",
    );
  });

  it("tells an empty string apart from an absent value", () => {
    const empty = canonicalMilestone(milestone({ description: "" }));
    const absent = canonicalMilestone(milestone({ description: null }));

    expect(empty).toContain("|0:|");
    expect(absent).not.toBe(empty);
  });

  /**
   * The reason for length prefixes rather than a separator. With naive
   * concatenation these two milestones produce the same string, so one could be
   * anchored under the other's hash.
   */
  it("cannot be confused by content that looks like a boundary", () => {
    const a = milestone({ title: "ab", description: "c" });
    const b = milestone({ title: "a", description: "bc" });

    expect(canonicalMilestone(a)).not.toBe(canonicalMilestone(b));
  });

  it("does not depend on the order proofs came back in", () => {
    const first = proof({ id: "aaaa1111-1111-4111-8111-111111111111" });
    const second = proof({ id: "bbbb2222-2222-4222-8222-222222222222" });

    expect(canonicalMilestone(milestone({ proofs: [first, second] }))).toBe(
      canonicalMilestone(milestone({ proofs: [second, first] })),
    );
  });

  it("does not mutate the caller's array while sorting", () => {
    const first = proof({ id: "bbbb2222-2222-4222-8222-222222222222" });
    const second = proof({ id: "aaaa1111-1111-4111-8111-111111111111" });
    const proofs = [first, second];

    canonicalMilestone(milestone({ proofs }));

    expect(proofs[0]).toBe(first);
  });
});

describe("milestoneProofHash", () => {
  it("is 64 lowercase hex characters, matching the column's CHECK", () => {
    expect(milestoneProofHash(milestone())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls", () => {
    expect(milestoneProofHash(milestone())).toBe(milestoneProofHash(milestone()));
  });

  it.each([
    ["title", { title: "Ship the contract " }],
    ["description", { description: "" }],
    ["due date", { dueDate: "2026-08-09" }],
  ])("changes when the %s changes", (_label, overrides) => {
    expect(milestoneProofHash(milestone(overrides))).not.toBe(
      milestoneProofHash(milestone()),
    );
  });

  /** Attaching a proof is a change to what the milestone claims. */
  it("changes when a proof is attached", () => {
    expect(milestoneProofHash(milestone({ proofs: [proof()] }))).not.toBe(
      milestoneProofHash(milestone()),
    );
  });

  it("changes when a proof's own fields change", () => {
    const before = milestone({ proofs: [proof()] });
    const after = milestone({ proofs: [proof({ txHash: "a".repeat(64) })] });

    expect(milestoneProofHash(after)).not.toBe(milestoneProofHash(before));
  });

  /**
   * The encoding is pinned to utf8 in the implementation. If that ever became
   * implicit, a non-ASCII title is where it would show up first.
   */
  it("handles non-ASCII content without collapsing it", () => {
    const ascii = milestone({ title: "Deploy" });
    const accented = milestone({ title: "Déploy" });

    expect(milestoneProofHash(accented)).not.toBe(milestoneProofHash(ascii));
    expect(milestoneProofHash(accented)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("proofHashBytes", () => {
  it("produces the 32 bytes the contract's BytesN<32> wants", () => {
    expect(proofHashBytes(milestoneProofHash(milestone()))).toHaveLength(32);
  });
});

describe("isMilestoneAnchorStale", () => {
  it("is false when the hash still matches", () => {
    const input = milestone();
    expect(isMilestoneAnchorStale(input, milestoneProofHash(input))).toBe(false);
  });

  it("is true once the milestone changes", () => {
    const anchored = milestoneProofHash(milestone());
    expect(isMilestoneAnchorStale(milestone({ title: "Ship the contract v2" }), anchored)).toBe(true);
  });

  /**
   * A v1 hash covered the status, so approving a milestone anchored while it
   * was proposed used to read as an edit. It matches under whichever status
   * it was taken with.
   */
  it.each([["proposed"], ["submitted"], ["approved"], ["rejected"]])(
    "matches a v1 anchor taken while %s",
    (status) => {
      const anchored = createHash("sha256").update(canonicalMilestoneV1(milestone(), status), "utf8").digest("hex");
      expect(isMilestoneAnchorStale(milestone(), anchored)).toBe(false);
    },
  );

  it("is true for a v1 anchor once the content changes", () => {
    const anchored = createHash("sha256").update(canonicalMilestoneV1(milestone(), "proposed"), "utf8").digest("hex");
    expect(isMilestoneAnchorStale(milestone({ dueDate: "2026-08-09" }), anchored)).toBe(true);
  });

  /** Fail toward "re-anchor". No hash is not evidence that one would match. */
  it.each([[null], [undefined], [""]])("treats %s as stale", (anchored) => {
    expect(isMilestoneAnchorStale(milestone(), anchored)).toBe(true);
  });
});
