#!/usr/bin/env node
// Reference implementation of docs/merkle/SPEC.md, used only to produce
// vectors.json. It shares no code with the Rust contract or @qdit/merkle, so
// the vectors check both of them against the spec, not against each other.
//
//   node docs/merkle/gen-vectors.mjs > docs/merkle/vectors.json

import { createHash } from "node:crypto";

const TAG = Buffer.from("qdit/merkle/v1", "ascii");

const sha256 = (...parts) => createHash("sha256").update(Buffer.concat(parts)).digest();

function str(s) {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(bytes.length);
  return Buffer.concat([len, bytes]);
}

const leafHash = (projectId, milestoneId, proofHash) =>
  sha256(Buffer.from([0x00]), TAG, str(projectId), str(milestoneId), proofHash);

const nodeHash = (left, right) => sha256(Buffer.from([0x01]), TAG, left, right);

/** Every level, leaves first. */
function levels(leaves) {
  const out = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
    }
    out.push(next);
    level = next;
  }
  return out;
}

function proofFor(lv, index) {
  const path = [];
  let i = index;
  for (const level of lv.slice(0, -1)) {
    const sibling = i % 2 === 1 ? i - 1 : i + 1;
    if (sibling < level.length) path.push(level[sibling]);
    i = Math.floor(i / 2);
  }
  return path;
}

function verify(root, leafCount, index, leaf, path) {
  if (leafCount === 0 || index >= leafCount || path.length > 16) return false;
  let h = leaf;
  let i = index;
  let size = leafCount;
  let p = 0;
  while (size > 1) {
    if (i % 2 === 1) {
      if (p === path.length) return false;
      h = nodeHash(path[p++], h);
    } else if (i + 1 < size) {
      if (p === path.length) return false;
      h = nodeHash(h, path[p++]);
    }
    i = Math.floor(i / 2);
    size = Math.floor((size + 1) / 2);
  }
  return p === path.length && h.equals(root);
}

const hex = (b) => b.toString("hex");
const proofHash = (n) => sha256(Buffer.from(`qdit test proof ${n}`, "utf8"));

const PROJECT = "8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2";

function batch(name, projectId, milestoneIds) {
  const leaves = milestoneIds.map((m, n) => ({
    milestone_id: m,
    proof_hash: proofHash(n),
  }));
  const hashes = leaves.map((l) => leafHash(projectId, l.milestone_id, l.proof_hash));
  const lv = levels(hashes);
  const root = lv.at(-1)[0];
  const proofs = hashes.map((leaf, index) => {
    const path = proofFor(lv, index);
    if (!verify(root, hashes.length, index, leaf, path)) throw new Error(`${name}: self-check ${index}`);
    return { index, path: path.map(hex) };
  });
  return {
    name,
    project_id: projectId,
    leaves: leaves.map((l, n) => ({
      milestone_id: l.milestone_id,
      proof_hash: hex(l.proof_hash),
      leaf: hex(hashes[n]),
    })),
    root: hex(root),
    proofs,
    _lv: lv,
    _hashes: hashes,
  };
}

const ids = (n) => Array.from({ length: n }, (_, i) => `m-${String(i).padStart(3, "0")}`);

const batches = [
  batch("one leaf", PROJECT, ids(1)),
  batch("two leaves", PROJECT, ids(2)),
  batch("three leaves, last promoted", PROJECT, ids(3)),
  batch("four leaves", PROJECT, ids(4)),
  batch("five leaves, promoted twice", PROJECT, ids(5)),
  batch("seven leaves", PROJECT, ids(7)),
  batch("ten leaves", PROJECT, ids(10)),
  batch("uuid and non-ascii ids", PROJECT, [
    "c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7",
    "hito-ñ",
    "",
  ]),
];

// Proofs that must be refused, built against "ten leaves".
const ten = batches.find((b) => b.name === "ten leaves");
const good = ten.proofs[4];
const leaf4 = ten.leaves[4];
const negatives = [
  { name: "right path, wrong index", index: 5, path: good.path },
  { name: "index past the last leaf", index: 10, path: good.path },
  { name: "siblings swapped", index: 4, path: [good.path[1], good.path[0], ...good.path.slice(2)] },
  { name: "one hash missing", index: 4, path: good.path.slice(0, -1) },
  { name: "extra trailing hash", index: 4, path: [...good.path, good.path[0]] },
  { name: "empty path", index: 4, path: [] },
  {
    name: "17 hashes",
    index: 4,
    path: Array.from({ length: 17 }, () => good.path[0]),
  },
].map((n) => ({
  ...n,
  batch: ten.name,
  milestone_id: leaf4.milestone_id,
  proof_hash: leaf4.proof_hash,
  expected: false,
}));

// Same leaf fields, but claimed under a different project: the leaf changes.
negatives.push({
  name: "proof from another project",
  batch: ten.name,
  project_id: "00000000-0000-4000-8000-000000000000",
  index: 4,
  path: good.path,
  milestone_id: leaf4.milestone_id,
  proof_hash: leaf4.proof_hash,
  expected: false,
});

// An inner node offered as a leaf: node(l0, l1) is in the tree, but no
// (project, milestone, proof_hash) leaf preimage can hash to it.
const inner = ten._lv[1][0];
negatives.push({
  name: "inner node hash used as proof_hash",
  batch: ten.name,
  index: 0,
  path: proofFor(ten._lv, 0).slice(1).map(hex),
  milestone_id: ten.leaves[0].milestone_id,
  proof_hash: hex(inner),
  expected: false,
});

for (const n of negatives) {
  const b = batches.find((x) => x.name === n.batch);
  const leaf = leafHash(n.project_id ?? b.project_id, n.milestone_id, Buffer.from(n.proof_hash, "hex"));
  const ok = verify(
    Buffer.from(b.root, "hex"),
    b.leaves.length,
    n.index,
    leaf,
    n.path.map((h) => Buffer.from(h, "hex")),
  );
  if (ok !== n.expected) throw new Error(`negative "${n.name}" verified`);
}

const zero = Buffer.alloc(32, 0);
const ff = Buffer.alloc(32, 0xff);

const out = {
  scheme: "qdit/merkle/v1",
  spec: "docs/merkle/SPEC.md",
  primitives: {
    tag_hex: hex(TAG),
    leaf: [
      {
        project_id: PROJECT,
        milestone_id: "c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7",
        proof_hash: hex(zero),
        hash: hex(leafHash(PROJECT, "c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7", zero)),
      },
      { project_id: "ab", milestone_id: "c", proof_hash: hex(ff), hash: hex(leafHash("ab", "c", ff)) },
      { project_id: "a", milestone_id: "bc", proof_hash: hex(ff), hash: hex(leafHash("a", "bc", ff)) },
    ],
    node: [{ left: hex(zero), right: hex(ff), hash: hex(nodeHash(zero, ff)) }],
  },
  batches: batches.map(({ _lv, _hashes, ...b }) => b),
  invalid_proofs: negatives,
};

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
