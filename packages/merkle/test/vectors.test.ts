// @qdit/merkle against docs/merkle/vectors.json, the same file the
// milestone_proof_v2 tests load. If these pass on both sides, the TypeScript
// and Rust implementations agree byte for byte.

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_BATCH_LEAVES,
  MerkleTree,
  TAG,
  fromHex,
  leafHash,
  nodeHash,
  toHex,
  verifyInclusion,
  verifyPath,
} from "../src/index.ts";

interface VectorLeaf {
  milestone_id: string;
  proof_hash: string;
  leaf: string;
}
interface VectorBatch {
  name: string;
  project_id: string;
  leaves: VectorLeaf[];
  root: string;
  proofs: { index: number; path: string[] }[];
}
interface Vectors {
  scheme: string;
  primitives: {
    tag_hex: string;
    leaf: { project_id: string; milestone_id: string; proof_hash: string; hash: string }[];
    node: { left: string; right: string; hash: string }[];
  };
  batches: VectorBatch[];
  invalid_proofs: {
    name: string;
    batch: string;
    project_id?: string;
    milestone_id: string;
    proof_hash: string;
    index: number;
    path: string[];
    expected: false;
  }[];
}

const vectors: Vectors = JSON.parse(
  readFileSync(new URL("../../../docs/merkle/vectors.json", import.meta.url), "utf8"),
);

const tree = (b: VectorBatch) =>
  MerkleTree.build(
    b.project_id,
    b.leaves.map((l) => ({ milestoneId: l.milestone_id, proofHash: fromHex(l.proof_hash, 32) })),
  );

test("the scheme and tag match", () => {
  assert.equal(vectors.scheme, "qdit/merkle/v1");
  assert.equal(toHex(TAG), vectors.primitives.tag_hex);
});

test("leaf hashes match", () => {
  for (const v of vectors.primitives.leaf) {
    assert.equal(toHex(leafHash(v.project_id, v.milestone_id, fromHex(v.proof_hash, 32))), v.hash);
  }
});

test("node hashes match", () => {
  for (const v of vectors.primitives.node) {
    assert.equal(toHex(nodeHash(fromHex(v.left, 32), fromHex(v.right, 32))), v.hash);
  }
});

for (const b of vectors.batches) {
  test(`batch "${b.name}": leaves, root and every proof match`, () => {
    const t = tree(b);
    assert.equal(t.leafCount, b.leaves.length);
    b.leaves.forEach((l, i) => assert.equal(toHex(t.leaf(i)), l.leaf, `leaf ${i}`));
    assert.equal(toHex(t.root), b.root);

    for (const p of b.proofs) {
      assert.deepEqual(t.proof(p.index).map(toHex), p.path, `proof ${p.index}`);
      const leaf = b.leaves[p.index]!;
      assert.ok(
        verifyInclusion(fromHex(b.root, 32), b.leaves.length, {
          projectId: b.project_id,
          milestoneId: leaf.milestone_id,
          proofHash: fromHex(leaf.proof_hash, 32),
          index: p.index,
          path: p.path.map((h) => fromHex(h, 32)),
        }),
        `verify ${p.index}`,
      );
    }
  });
}

for (const bad of vectors.invalid_proofs) {
  test(`invalid proof "${bad.name}" is false`, () => {
    const b = vectors.batches.find((x) => x.name === bad.batch)!;
    assert.equal(
      verifyInclusion(fromHex(b.root, 32), b.leaves.length, {
        projectId: bad.project_id ?? b.project_id,
        milestoneId: bad.milestone_id,
        proofHash: fromHex(bad.proof_hash, 32),
        index: bad.index,
        path: bad.path.map((h) => fromHex(h, 32)),
      }),
      bad.expected,
    );
  });
}

test("an empty batch is refused", () => {
  assert.throws(() => MerkleTree.build("p", []), RangeError);
});

test("a repeated milestone id is refused", () => {
  const proofHash = new Uint8Array(32);
  assert.throws(
    () =>
      MerkleTree.build("p", [
        { milestoneId: "m", proofHash },
        { milestoneId: "m", proofHash },
      ]),
    /appears twice/,
  );
});

test("a proof hash that isn't 32 bytes is refused", () => {
  assert.throws(() => leafHash("p", "m", new Uint8Array(31)), TypeError);
});

test("out-of-range input to verifyPath is false, not a throw", () => {
  const h = new Uint8Array(32);
  assert.equal(verifyPath(h, 0, 0, h, []), false);
  assert.equal(verifyPath(h, MAX_BATCH_LEAVES + 1, 0, h, []), false);
  assert.equal(verifyPath(h, 2, -1, h, [h]), false);
  assert.equal(verifyPath(h, 2, 0.5, h, [h]), false);
  assert.equal(verifyPath(h, 2, 0, h, [new Uint8Array(31)]), false);
});

test("a 100-leaf tree proves every leaf with at most 7 hashes", () => {
  const leaves = Array.from({ length: 100 }, (_, i) => ({
    milestoneId: `m-${i}`,
    proofHash: leafHash("seed", String(i), new Uint8Array(32)),
  }));
  const t = MerkleTree.build("p", leaves);
  for (let i = 0; i < 100; i++) {
    const path = t.proof(i);
    assert.ok(path.length <= 7);
    assert.ok(verifyPath(t.root, 100, i, t.leaf(i), path), `leaf ${i}`);
    assert.equal(t.indexOf(`m-${i}`), i);
  }
});

test("fromHex checks length and alphabet", () => {
  assert.equal(toHex(fromHex("0xAbCd")), "abcd");
  assert.throws(() => fromHex("abc"), TypeError);
  assert.throws(() => fromHex("zz"), TypeError);
  assert.throws(() => fromHex("00", 32), TypeError);
});
