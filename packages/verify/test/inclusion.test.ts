import assert from "node:assert/strict";
import { test } from "node:test";
import { Networks } from "@stellar/stellar-sdk";
import { MerkleTree, proofFiles, toHex, type InclusionProofFile, type Leaf } from "@qdit/merkle";
import { verifyInclusion } from "../src/index.ts";
import { CLONE_ID, CONTRACT_ID, FakeChain, addr } from "./fake-rpc.ts";

const PROJECT = "proj-1";
const BATCH = "sprint-12";
const LEDGER = 5728172;

const leaves: Leaf[] = Array.from({ length: 5 }, (_, i) => ({
  milestoneId: `m-${i}`,
  version: i + 1,
  proofHash: new Uint8Array(32).fill(i + 1),
}));
const tree = MerkleTree.build(PROJECT, leaves);
const files = proofFiles(tree, {
  network: "testnet",
  contractId: CONTRACT_ID,
  batchId: BATCH,
  anchor: { tx_hash: "ab".repeat(32), ledger: LEDGER, timestamp: 1763128600 },
});
const file = files[3]!;

function chain(): FakeChain {
  const c = new FakeChain();
  c.projects.set(PROJECT, { owner: addr(1), threshold: 1 });
  c.batches.set(`${PROJECT}/${BATCH}`, {
    root: tree.root,
    leafCount: tree.leafCount,
    submitter: addr(2),
    ledger: LEDGER,
    timestamp: 1763128600,
  });
  return c;
}

const edit = (patch: Partial<InclusionProofFile>): InclusionProofFile => ({ ...file, ...patch });

test("offline: an untouched file is consistent, and the chain is not consulted", async () => {
  const c = chain();
  const r = await verifyInclusion(JSON.stringify(file), { server: c.rpc() });
  assert.equal(r.ok, true);
  assert.equal(r.onChain, false);
  assert.equal(r.rootConfirmed, false);
  assert.equal(r.leafMatches, true);
  assert.equal(r.pathValid, true);
  assert.equal(r.root, file.root);
  assert.equal(r.batch, undefined);
  assert.deepEqual(c.calls, []);
});

test("on chain: an untouched file verifies against the stored root and the contract agrees", async () => {
  const c = chain();
  const r = await verifyInclusion(file, { onChain: true, server: c.rpc() });
  assert.deepEqual(r, {
    ok: true,
    onChain: true,
    rootConfirmed: true,
    network: "testnet",
    contractId: CONTRACT_ID,
    projectId: PROJECT,
    batchId: BATCH,
    milestoneId: "m-3",
    version: 4,
    proofHash: toHex(new Uint8Array(32).fill(4)),
    leafMatches: true,
    pathValid: true,
    root: toHex(tree.root),
    batch: {
      root: toHex(tree.root),
      leafCount: 5,
      submitter: addr(2),
      ledger: LEDGER,
      timestamp: 1763128600,
      contractSays: true,
    },
    submission: { recorded: false },
    projectOwner: addr(1),
    reasons: [],
  });
  assert.deepEqual([...c.calls].sort(), ["get_batch", "get_milestone_status", "get_project", "verify_inclusion"]);
});

test("every leaf of the batch verifies on chain", async () => {
  const server = chain().rpc();
  for (const f of files) {
    assert.equal((await verifyInclusion(f, { onChain: true, server })).ok, true, f.milestone_id);
  }
});

test("a tampered proof hash fails offline and on chain", async () => {
  const tampered = edit({ proof_hash: toHex(new Uint8Array(32).fill(0xee)) });
  const off = await verifyInclusion(tampered);
  assert.equal(off.ok, false);
  assert.equal(off.leafMatches, false);

  const on = await verifyInclusion(tampered, { onChain: true, server: chain().rpc() });
  assert.equal(on.ok, false);
  assert.equal(on.pathValid, false);
  assert.equal(on.batch?.contractSays, false);
  assert.deepEqual(on.reasons, [
    "leaf does not match the file's project, milestone, version and proof hash",
    "path does not lead to the root stored on chain",
    "the contract's verify_inclusion returned false",
  ]);
});

test("a claimed version other than the anchored one fails", async () => {
  const r = await verifyInclusion(edit({ version: 1 }), { onChain: true, server: chain().rpc() });
  assert.equal(r.ok, false);
  assert.equal(r.leafMatches, false);
  assert.equal(r.batch?.contractSays, false);
});

test("a tampered path fails offline and on chain", async () => {
  const path = [...file.path];
  path[0] = "00".repeat(32);
  const off = await verifyInclusion(edit({ path }));
  assert.equal(off.ok, false);
  assert.equal(off.pathValid, false);
  assert.deepEqual(off.reasons, ["path does not lead to the file's root"]);

  const on = await verifyInclusion(edit({ path }), { onChain: true, server: chain().rpc() });
  assert.equal(on.ok, false);
  assert.equal(on.pathValid, false);
  assert.equal(on.batch?.contractSays, false);
});

test("a forged file with its own root passes offline but never on chain", async () => {
  // Someone builds a fresh tree holding a milestone that was never anchored and
  // writes a proof file whose root field is that tree's root.
  const forgedTree = MerkleTree.build(PROJECT, [
    ...leaves.slice(0, 4),
    { milestoneId: "never-anchored", version: 1, proofHash: new Uint8Array(32).fill(0x99) },
  ]);
  const forged = proofFiles(forgedTree, { network: "testnet", contractId: CONTRACT_ID, batchId: BATCH })[4]!;

  const off = await verifyInclusion(forged);
  assert.equal(off.ok, true, "offline only proves the file agrees with itself");
  assert.equal(off.rootConfirmed, false);

  const on = await verifyInclusion(forged, { onChain: true, server: chain().rpc() });
  assert.equal(on.ok, false);
  assert.equal(on.pathValid, false);
  assert.equal(on.root, toHex(tree.root), "the root checked is the stored one, not the file's");
  assert.deepEqual(on.reasons, [
    "path does not lead to the root stored on chain",
    "the contract's verify_inclusion returned false",
    `file's root ${forged.root} differs from the stored root ${toHex(tree.root)}`,
  ]);
});

test("a file whose root, leaf count or anchor disagree with the chain fails on chain", async () => {
  const r = await verifyInclusion(edit({ anchor: { ...file.anchor!, ledger: LEDGER + 1 } }), {
    onChain: true,
    server: chain().rpc(),
  });
  assert.equal(r.ok, false);
  assert.equal(r.pathValid, true);
  assert.deepEqual(r.reasons, [`file's anchor ledger ${LEDGER + 1} differs from the stored ${LEDGER}`]);
});

test("a batch that was never anchored fails on chain", async () => {
  const r = await verifyInclusion(edit({ batch_id: "ghost" }), { onChain: true, server: chain().rpc() });
  assert.equal(r.ok, false);
  assert.equal(r.pathValid, false);
  assert.deepEqual(r.reasons, ['batch "ghost": BatchNotFound']);
});

test("a proof for another network is refused, offline too", async () => {
  await assert.rejects(verifyInclusion(edit({ network: "public" })), {
    name: "VerifyError",
    code: "WRONG_NETWORK",
  });
});

test("an RPC on another network is refused for the on-chain check", async () => {
  const c = chain();
  c.passphrase = Networks.PUBLIC;
  await assert.rejects(verifyInclusion(file, { onChain: true, server: c.rpc() }), { code: "WRONG_NETWORK" });
  assert.deepEqual(c.calls, []);
});

test("a malformed file is refused", async () => {
  for (const bad of ["not json", "{}", { ...file, format: "qdit-inclusion-proof/v1" }, { ...file, leaf: "zz" }]) {
    await assert.rejects(verifyInclusion(bad), { code: "BAD_INPUT" });
  }
});

test("a forged file pointing at a copy of the contract is refused before any read", async () => {
  // A forger deploys the same WASM, registers this project id on it and
  // anchors their own root there, then names that contract in the file.
  const forgedTree = MerkleTree.build(PROJECT, [
    { milestoneId: "never-anchored", version: 1, proofHash: new Uint8Array(32).fill(0x99) },
  ]);
  const forged = proofFiles(forgedTree, { network: "testnet", contractId: CLONE_ID, batchId: BATCH })[0]!;
  const c = chain();
  c.batches.set(`${PROJECT}/${BATCH}`, {
    root: forgedTree.root,
    leafCount: 1,
    submitter: addr(9),
    ledger: LEDGER,
    timestamp: 1763128600,
  });
  await assert.rejects(verifyInclusion(forged, { onChain: true, server: c.rpc() }), {
    name: "VerifyError",
    code: "WRONG_CONTRACT",
  });
  assert.deepEqual(c.calls, []);
});

test("a file whose leaf_count alone disagrees with the chain fails on chain", async () => {
  const r = await verifyInclusion(edit({ leaf_count: 6 }), { onChain: true, server: chain().rpc() });
  assert.equal(r.ok, false);
  assert.equal(r.pathValid, true);
  assert.equal(r.batch?.contractSays, true);
  assert.deepEqual(r.reasons, ["file's leaf_count 6 differs from the stored 5"]);
});

test("a file whose anchor timestamp disagrees with the chain fails on chain", async () => {
  const r = await verifyInclusion(edit({ anchor: { ...file.anchor!, timestamp: 1 } }), {
    onChain: true,
    server: chain().rpc(),
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ["file's anchor timestamp 1 differs from the stored 1763128600"]);
});

test("a refusal from verify_inclusion is a failed check, not an error", async () => {
  const c = chain();
  c.refuse.set("verify_inclusion", 6);
  const r = await verifyInclusion(file, { onChain: true, server: c.rpc() });
  assert.equal(r.ok, false);
  assert.equal(r.batch?.contractSays, false);
  assert.deepEqual(r.reasons, ["the contract's verify_inclusion refused the proof: IdTooLong"]);
});

test("ids over the contract's 64-byte limit are refused as bad input", async () => {
  await assert.rejects(verifyInclusion(edit({ batch_id: "b".repeat(65) })), { code: "BAD_INPUT" });
});

test("an index beyond u32 is refused as bad input", async () => {
  await assert.rejects(verifyInclusion(edit({ index: 2 ** 32 })), { code: "BAD_INPUT" });
});

const submitted = (version: number, proofHash: Uint8Array) => ({
  status: "Submitted" as const,
  version,
  proofHash,
  submitter: addr(2),
  timestamp: 1763128000,
  approvers: [],
});

test("on chain: a file agreeing with the milestone's own record passes and reports it", async () => {
  const c = chain();
  c.milestones.set(`${PROJECT}/m-3`, submitted(4, new Uint8Array(32).fill(4)));
  const r = await verifyInclusion(file, { onChain: true, server: c.rpc() });
  assert.equal(r.ok, true, r.reasons.join("; "));
  assert.deepEqual(r.submission, {
    recorded: true,
    status: "Submitted",
    version: 4,
    proofHash: toHex(new Uint8Array(32).fill(4)),
  });
});

test("on chain: an older version than the milestone's current one still passes", async () => {
  const c = chain();
  c.milestones.set(`${PROJECT}/m-3`, submitted(7, new Uint8Array(32).fill(0x77)));
  assert.equal((await verifyInclusion(file, { onChain: true, server: c.rpc() })).ok, true);
});

test("on chain: a version the milestone never reached fails", async () => {
  const c = chain();
  c.milestones.set(`${PROJECT}/m-3`, submitted(2, new Uint8Array(32).fill(4)));
  const r = await verifyInclusion(file, { onChain: true, server: c.rpc() });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ["version 4 was never submitted: the milestone's record is at version 2"]);
});

test("on chain: another proof hash at the milestone's current version fails", async () => {
  const c = chain();
  c.milestones.set(`${PROJECT}/m-3`, submitted(4, new Uint8Array(32).fill(0xee)));
  const r = await verifyInclusion(file, { onChain: true, server: c.rpc() });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, [
    `proof hash differs from the one submitted at version 4 (${toHex(new Uint8Array(32).fill(0xee))})`,
  ]);
});
