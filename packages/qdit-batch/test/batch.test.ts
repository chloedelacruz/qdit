import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkProofFile, fromHex, parseProofFile } from "@qdit/merkle";

import { buildTree, parseInput, proofFileName, writeBatch, type BatchSummary } from "../src/batch.ts";

const vectors = JSON.parse(
  readFileSync(new URL("../../../docs/merkle/vectors.json", import.meta.url), "utf8"),
) as { batches: { name: string; project_id: string; root: string; leaves: { milestone_id: string; proof_hash: string }[] }[] };

const ten = vectors.batches.find((b) => b.name === "ten leaves")!;
const input = JSON.stringify({ project_id: ten.project_id, milestones: ten.leaves });

test("the CLI's tree has the vector root", () => {
  assert.equal(Buffer.from(buildTree(parseInput(input)).root).toString("hex"), ten.root);
});

test("writeBatch lays out batch.json and one valid proof per milestone", () => {
  const dir = mkdtempSync(join(tmpdir(), "qdit-batch-"));
  try {
    const tree = buildTree(parseInput(input));
    writeBatch(dir, tree, {
      network: "testnet",
      contractId: "CTEST",
      batchId: "sprint-12",
      anchor: { tx_hash: "ab".repeat(32), ledger: 7, timestamp: 1_700_000_000 },
      submitter: "GTEST",
      feeCharged: 12345n,
    });

    const summary = JSON.parse(readFileSync(join(dir, "batch.json"), "utf8")) as BatchSummary;
    assert.equal(summary.root, ten.root);
    assert.equal(summary.leaf_count, 10);
    assert.equal(summary.anchor?.fee_charged_stroops, "12345");

    const names = readdirSync(join(dir, "proofs")).sort();
    assert.equal(names.length, 10);
    names.forEach((name, i) => {
      assert.equal(summary.milestones[i]!.proof_file, `proofs/${name}`);
      const file = parseProofFile(readFileSync(join(dir, "proofs", name), "utf8"));
      assert.equal(file.anchor?.ledger, 7);
      const check = checkProofFile(file, { root: fromHex(ten.root, 32), leafCount: 10 });
      assert.ok(check.leafMatches && check.pathValid, name);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("input checks", () => {
  const ok = { project_id: "p", milestones: [{ milestone_id: "m", proof_hash: "00".repeat(32) }] };
  assert.ok(parseInput(JSON.stringify(ok)));
  assert.throws(() => parseInput(JSON.stringify({ ...ok, project_id: 1 })), /project_id/);
  assert.throws(() => parseInput(JSON.stringify({ ...ok, project_id: "x".repeat(65) })), /64/);
  assert.throws(
    () => parseInput(JSON.stringify({ ...ok, milestones: [{ milestone_id: "m", proof_hash: "abc" }] })),
    /hex/,
  );
  assert.throws(() => buildTree(parseInput(JSON.stringify({ ...ok, milestones: [] }))), /at least one/);
  assert.throws(
    () => buildTree(parseInput(JSON.stringify({ ...ok, milestones: [ok.milestones[0], ok.milestones[0]] }))),
    /twice/,
  );
});

test("proof file names are filesystem-safe and sort by index", () => {
  const name = (index: number, milestone_id: string) =>
    proofFileName({ index, milestone_id } as Parameters<typeof proofFileName>[0]);
  assert.equal(name(3, "c9f0f895-fb98"), "00003-c9f0f895-fb98.json");
  assert.equal(name(12, "a/b:c d"), "00012-a_b_c_d.json");
  assert.equal(name(0, ""), "00000-milestone.json");
});
