import { describe, expect, it, vi } from "vitest";

import { sha256Hex } from "@/lib/api/hackathon-snapshot-body";
import type {
  ChainMilestone,
  DocumentRead,
  MilestoneRead,
  MilestoneTarget,
  RegistryConfig,
} from "@/lib/chain/doqtri-registry";
import type { DoqtriSnapshotNote, QditSnapshotMilestoneAnchor, QditSnapshotV1 } from "@/lib/hackathon/types";
import { DURING, doqtriSnapshot, note, qditSnapshot, WINDOW } from "@/test/hackathon-fixtures";

import {
  CHAIN_FACTS_CONCURRENCY,
  ChainUnavailableError,
  milestoneCandidates,
  milestoneVerdict,
  noteVerdict,
  readChainFacts,
  type ChainFactsDeps,
} from "./chain-facts";

/**
 * The chain reads behind `notes_on_chain` and `milestones_on_chain`
 * (QDIT-54). The registry and milestone reads are stubs here; their XDR is
 * covered in `lib/chain/doqtri-registry.test.ts`.
 */

const REGISTRY: RegistryConfig = {
  network: "testnet",
  contractId: "CCCIDUCFQMTMAGESMPTB3MFW4TURS62ORSZNICFOE6MNQZO3MI7F6QRJ",
  rpcUrl: "https://rpc.example.test",
};
const CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const PROOF = "ab".repeat(32);
const BEFORE = "2026-11-19T12:00:00.000Z";
const secs = (iso: string) => Date.parse(iso) / 1000;
const WINDOW_MS = { opens: Date.parse(WINDOW.opens_at), closes: Date.parse(WINDOW.closes_at) };

const doc = (markdown: string, version = 1): DocumentRead => ({
  ok: true,
  document: { owner: "G", contentHash: sha256Hex(markdown).toUpperCase(), version, nodeCount: 1, updatedAt: 0 },
});
const record = (overrides: Partial<ChainMilestone> = {}): MilestoneRead => ({
  ok: true,
  record: { status: "Submitted", version: 1, proofHash: PROOF, submitter: "G", timestamp: secs(DURING), ...overrides },
});

function anchor(overrides: Partial<QditSnapshotMilestoneAnchor> = {}): QditSnapshotMilestoneAnchor {
  return {
    id: "a1",
    milestone_id: "m1",
    action: "submit",
    proof_hash: PROOF,
    version: 1,
    contract_id: CONTRACT,
    network: "testnet",
    tx_hash: "f".repeat(64),
    signer_address: "G",
    ledger: 1,
    created_at: DURING,
    ...overrides,
  };
}

function registered(overrides: Partial<QditSnapshotV1> = {}): QditSnapshotV1 {
  const base = qditSnapshot();
  return qditSnapshot({
    project: { ...base.project, chain_contract_id: CONTRACT },
    milestone_anchors: [anchor()],
    ...overrides,
  });
}

/** Every read answers from the maps; a missing key is a test bug. */
function deps(
  notes: Record<string, DocumentRead>,
  milestones: Record<string, MilestoneRead> = { m1: record() },
  extra: ChainFactsDeps = {},
) {
  const readDocument = vi.fn(async (_c: RegistryConfig, docId: string) => {
    const read = notes[docId];
    if (!read) throw new Error(`unexpected read of ${docId}`);
    return read;
  });
  const readMilestone = vi.fn(async (_t: MilestoneTarget, _p: string, milestoneId: string) => {
    const read = milestones[milestoneId];
    if (!read) throw new Error(`unexpected read of ${milestoneId}`);
    return read;
  });
  return { registry: REGISTRY, ...extra, readDocument, readMilestone };
}

const FIVE = ["n1", "n2", "n3", "n4", "n5"];
const allNotes = (notes: DoqtriSnapshotNote[]) => Object.fromEntries(notes.map((n) => [n.doc_id, doc(n.markdown)]));

describe("noteVerdict", () => {
  const n = note("n1", { version: 2 });

  it("matches the pushed text at the same version, hash case aside", () => {
    expect(noteVerdict(doc(n.markdown, 2), n)).toBe("yes");
  });
  it("accepts a registry version past the snapshot's, whatever its hash", () => {
    expect(noteVerdict(doc("edited later", 3), n)).toBe("yes");
  });
  it("refuses a registry version behind the snapshot's", () => {
    expect(noteVerdict(doc(n.markdown, 1), n)).toBe("no");
  });
  it("compares the hash when the snapshot has no version", () => {
    const unversioned = note("n1", { version: null });
    expect(noteVerdict(doc(unversioned.markdown, 7), unversioned)).toBe("yes");
    expect(noteVerdict(doc("other", 7), unversioned)).toBe("no");
  });
  it("is no for a missing document and the failure reason for a failed read", () => {
    expect(noteVerdict({ ok: true, document: null }, n)).toBe("no");
    expect(noteVerdict({ ok: false, reason: "timeout" }, n)).toBe("timeout");
  });
});

describe("milestoneVerdict", () => {
  it("accepts a record submitted in the window with the anchor's proof", () => {
    expect(milestoneVerdict(record(), anchor(), WINDOW_MS)).toBe("yes");
  });
  it("refuses a record submitted before the event opened", () => {
    expect(milestoneVerdict(record({ timestamp: secs(BEFORE) }), anchor(), WINDOW_MS)).toBe("no");
  });
  it("refuses a record submitted after the event closed", () => {
    expect(milestoneVerdict(record({ timestamp: secs("2026-11-22T00:00:00.000Z") }), anchor(), WINDOW_MS)).toBe("no");
  });
  it("refuses another proof at the same version, accepts a later version", () => {
    expect(milestoneVerdict(record({ proofHash: "cd".repeat(32) }), anchor(), WINDOW_MS)).toBe("no");
    expect(milestoneVerdict(record({ version: 2, proofHash: "cd".repeat(32) }), anchor(), WINDOW_MS)).toBe("yes");
  });
  it("refuses a record behind the anchor row (a forged row)", () => {
    expect(milestoneVerdict(record(), anchor({ version: 2 }), WINDOW_MS)).toBe("no");
  });
  it("is no for MilestoneNotFound and the reason for a failed read", () => {
    expect(milestoneVerdict({ ok: true, record: null }, anchor(), WINDOW_MS)).toBe("no");
    expect(milestoneVerdict({ ok: false, reason: "rpc" }, anchor(), WINDOW_MS)).toBe("rpc");
  });
});

describe("milestoneCandidates", () => {
  it("is empty for an unregistered project", () => {
    expect(milestoneCandidates(qditSnapshot({ milestone_anchors: [anchor()] }))).toEqual([]);
  });
  it("keeps each milestone's latest submit on the project's contract", () => {
    const got = milestoneCandidates(
      registered({
        milestone_anchors: [
          anchor({ id: "a1", version: 1 }),
          anchor({ id: "a2", version: 2 }),
          anchor({ id: "a3", action: "approve", proof_hash: null, version: 3 }),
          anchor({ id: "a4", version: 9, contract_id: "COTHER" }),
          anchor({ id: "a5", milestone_id: "gone" }),
        ],
      }),
    );
    expect(got.map((a) => a.id)).toEqual(["a2"]);
  });
});

describe("readChainFacts", () => {
  it("confirms five notes and one milestone", async () => {
    const doqtri = doqtriSnapshot();
    const d = deps(allNotes(doqtri.notes));
    const facts = await readChainFacts({ window: WINDOW, snapshot: registered(), doqtri }, d);
    expect([...facts.anchoredNoteIds].sort()).toEqual(FIVE);
    expect(facts.anchoredMilestoneIds).toEqual(["m1"]);
    expect(d.readMilestone).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: CONTRACT, network: "testnet" }),
      "p1",
      "m1",
    );
  });

  it("stops reading notes once five are confirmed", async () => {
    // Readers already in flight finish, so at most one extra batch is read.
    const doqtri = doqtriSnapshot(Array.from({ length: 20 }, (_, i) => note(`n${i + 1}`)));
    const d = deps(allNotes(doqtri.notes));
    await readChainFacts({ window: WINDOW, snapshot: registered(), doqtri }, d);
    expect(d.readDocument.mock.calls.length).toBeLessThanOrEqual(2 * CHAIN_FACTS_CONCURRENCY);
  });

  it("reads no notes when fewer than five count, and needs no registry then", async () => {
    const doqtri = doqtriSnapshot(["n1", "n2"].map((id) => note(id)));
    const d = deps({}, { m1: record() }, { registry: null });
    const facts = await readChainFacts({ window: WINDOW, snapshot: registered(), doqtri }, d);
    expect(facts.anchoredNoteIds).toEqual([]);
    expect(d.readDocument).not.toHaveBeenCalled();
  });

  it("reads nothing for an unregistered project's milestones", async () => {
    const doqtri = doqtriSnapshot();
    const d = deps(allNotes(doqtri.notes));
    const facts = await readChainFacts({ window: WINDOW, snapshot: qditSnapshot(), doqtri }, d);
    expect(facts.anchoredMilestoneIds).toEqual([]);
    expect(d.readMilestone).not.toHaveBeenCalled();
  });

  it("reports an answered shortfall without throwing", async () => {
    const doqtri = doqtriSnapshot();
    const reads = allNotes(doqtri.notes);
    reads.n5 = { ok: true, document: null };
    const facts = await readChainFacts(
      { window: WINDOW, snapshot: registered(), doqtri },
      deps(reads, { m1: { ok: true, record: null } }),
    );
    expect(facts.anchoredNoteIds).toHaveLength(4);
    expect(facts.anchoredMilestoneIds).toEqual([]);
  });

  it("throws when a failed read leaves the bar unmet", async () => {
    const doqtri = doqtriSnapshot();
    const reads = allNotes(doqtri.notes);
    reads.n3 = { ok: false, reason: "timeout" };
    await expect(
      readChainFacts({ window: WINDOW, snapshot: registered(), doqtri }, deps(reads)),
    ).rejects.toMatchObject({ name: "ChainUnavailableError", reason: "timeout" });
  });

  it("does not throw when the bar is met despite a failed read", async () => {
    const doqtri = doqtriSnapshot(["n1", "n2", "n3", "n4", "n5", "n6"].map((id) => note(id)));
    const reads = allNotes(doqtri.notes);
    reads.n1 = { ok: false, reason: "rpc" };
    const facts = await readChainFacts({ window: WINDOW, snapshot: registered(), doqtri }, deps(reads));
    expect(facts.anchoredNoteIds).toHaveLength(5);
  });

  it("throws on a failed milestone read", async () => {
    const doqtri = doqtriSnapshot();
    await expect(
      readChainFacts(
        { window: WINDOW, snapshot: registered(), doqtri },
        deps(allNotes(doqtri.notes), { m1: { ok: false, reason: "decode" } }),
      ),
    ).rejects.toBeInstanceOf(ChainUnavailableError);
  });

  it("throws unconfigured when notes need checking and no registry is set", async () => {
    await expect(
      readChainFacts(
        { window: WINDOW, snapshot: registered(), doqtri: doqtriSnapshot() },
        deps({}, { m1: record() }, { registry: null }),
      ),
    ).rejects.toMatchObject({ reason: "unconfigured" });
  });

  it("throws budget when time runs out before the bar is met", async () => {
    let now = 0;
    // More notes than readers, none anchored: the first batch spends the budget.
    const doqtri = doqtriSnapshot(["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"].map((id) => note(id)));
    const d = deps(allNotes(doqtri.notes), { m1: record() }, { now: () => now, budgetMs: 10 });
    d.readDocument.mockImplementation(async () => {
      now += 20;
      return { ok: true, document: null };
    });
    await expect(readChainFacts({ window: WINDOW, snapshot: registered(), doqtri }, d)).rejects.toMatchObject({
      reason: "budget",
    });
  });
});
