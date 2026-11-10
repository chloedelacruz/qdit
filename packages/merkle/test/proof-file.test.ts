import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MerkleTree,
  PROOF_FORMAT,
  checkProofFile,
  leafHash,
  parseProofFile,
  proofFiles,
} from "../src/index.ts";

const PROJECT = "8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2";

function sample(n: number) {
  const tree = MerkleTree.build(
    PROJECT,
    Array.from({ length: n }, (_, i) => ({
      milestoneId: `m-${i}`,
      proofHash: leafHash("seed", String(i), new Uint8Array(32)),
    })),
  );
  const files = proofFiles(tree, {
    network: "testnet",
    contractId: "CTEST",
    batchId: "sprint-12",
    anchor: { tx_hash: "ab".repeat(32), ledger: 100, timestamp: 1_700_000_000 },
  });
  return { tree, files };
}

test("one file per leaf, each self-consistent and round-tripping through JSON", () => {
  const { tree, files } = sample(10);
  assert.equal(files.length, 10);
  files.forEach((f, i) => {
    assert.equal(f.format, PROOF_FORMAT);
    assert.equal(f.index, i);
    assert.equal(f.leaf_count, 10);
    const parsed = parseProofFile(JSON.stringify(f));
    const check = checkProofFile(parsed, { root: tree.root, leafCount: tree.leafCount });
    assert.deepEqual([check.leafMatches, check.pathValid], [true, true], `file ${i}`);
  });
});

test("a file checked against another batch's root fails", () => {
  const { files } = sample(10);
  const other = sample(11).tree;
  const check = checkProofFile(files[3]!, { root: other.root, leafCount: other.leafCount });
  assert.equal(check.pathValid, false);
});

test("an edited proof_hash fails both checks", () => {
  const { tree, files } = sample(4);
  const forged = { ...files[1]!, proof_hash: "00".repeat(32) };
  const check = checkProofFile(forged, { root: tree.root, leafCount: 4 });
  assert.deepEqual([check.leafMatches, check.pathValid], [false, false]);
});

test("the anchor block is optional", () => {
  const tree = sample(2).tree;
  const [file] = proofFiles(tree, { network: "testnet", contractId: "C", batchId: "b" });
  assert.equal(file!.anchor, undefined);
  assert.ok(parseProofFile(file));
});

test("malformed files are refused", () => {
  const { files } = sample(2);
  const good = files[0]!;
  assert.throws(() => parseProofFile({ ...good, format: "v0" }), /format/);
  assert.throws(() => parseProofFile({ ...good, root: "abcd" }), /32 bytes/);
  assert.throws(() => parseProofFile({ ...good, index: -1 }), /index/);
  assert.throws(() => parseProofFile({ ...good, path: Array(17).fill(good.root) }), /path/);
  assert.throws(() => parseProofFile({ ...good, anchor: { tx_hash: "x" } }), /anchor/);
});
