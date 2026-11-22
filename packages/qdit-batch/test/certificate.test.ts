import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkProofFile, extractCertificateProof, fromHex } from "@qdit/merkle";

import { buildTree, parseInput, writeBatch, type BatchSummary } from "../src/batch.ts";
import { renderCertificate, writeCertificates } from "../src/certificate.ts";

const vectors = JSON.parse(
  readFileSync(new URL("../../../docs/merkle/vectors.json", import.meta.url), "utf8"),
) as { batches: { name: string; project_id: string; root: string; leaves: { milestone_id: string; version: number; proof_hash: string }[] }[] };

const ten = vectors.batches.find((b) => b.name === "ten leaves")!;
const ANCHOR = { tx_hash: "ab".repeat(32), ledger: 7, timestamp: 1_700_000_000 };
const NOW = new Date("2026-11-23T00:00:00Z");

function withBatch(milestones: object[], anchored: boolean, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "qdit-cert-"));
  try {
    const tree = buildTree(parseInput(JSON.stringify({ project_id: ten.project_id, milestones })));
    writeBatch(dir, tree, {
      network: "testnet",
      contractId: "CTEST",
      batchId: "sprint-12",
      ...(anchored ? { anchor: ANCHOR, submitter: "GTEST", feeCharged: 1n } : {}),
    });
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("one certificate per proof file, each carrying that exact proof file", () => {
  withBatch(ten.leaves, true, (dir) => {
    const written = writeCertificates(dir, join(dir, "certificates"), NOW);
    assert.equal(written.length, 10);
    const proofs = readdirSync(join(dir, "proofs")).sort();
    assert.deepEqual(readdirSync(join(dir, "certificates")).sort(), proofs.map((p) => p.replace(/\.json$/, ".html")));

    for (const name of proofs) {
      const original = readFileSync(join(dir, "proofs", name), "utf8");
      const html = readFileSync(join(dir, "certificates", name.replace(/\.json$/, ".html")), "utf8");
      const carried = extractCertificateProof(html);
      // Re-serialized the way writeBatch writes it, the carried file is the original byte for byte.
      assert.equal(JSON.stringify(carried, null, 2) + "\n", original, name);
      const check = checkProofFile(carried, { root: fromHex(ten.root, 32), leafCount: 10 });
      assert.ok(check.leafMatches && check.pathValid, name);
      assert.ok(html.includes(`https://stellar.expert/explorer/testnet/tx/${ANCHOR.tx_hash}`));
      assert.ok(!/<(link|img|iframe)\b|src=|@import/i.test(html), "no external requests");
    }
  });
});

test("an unanchored batch is refused and nothing is written", () => {
  withBatch(ten.leaves, false, (dir) => {
    assert.throws(() => writeCertificates(dir, join(dir, "certificates"), NOW), /never anchored/);
    assert.throws(() => readdirSync(join(dir, "certificates")), /ENOENT/);
  });
});

test("a proof file that disagrees with batch.json or with itself is refused", () => {
  withBatch(ten.leaves, true, (dir) => {
    const summary = JSON.parse(readFileSync(join(dir, "batch.json"), "utf8")) as BatchSummary;
    const path = join(dir, summary.milestones[3]!.proof_file);
    const file = JSON.parse(readFileSync(path, "utf8"));

    writeFileSync(path, JSON.stringify({ ...file, batch_id: "other" }));
    assert.throws(() => writeCertificates(dir, join(dir, "c1"), NOW), /does not belong/);

    writeFileSync(path, JSON.stringify({ ...file, proof_hash: "00".repeat(32) }));
    assert.throws(() => writeCertificates(dir, join(dir, "c2"), NOW), /does not agree with itself/);
  });
});

test("a milestone id cannot break out of the proof block or inject markup", () => {
  const evil = "</script><script>alert(1)</script><b>&";
  withBatch([{ milestone_id: evil, version: 1, proof_hash: "11".repeat(32) }], true, (dir) => {
    const [path] = writeCertificates(dir, join(dir, "certificates"), NOW);
    const html = readFileSync(path!, "utf8");
    assert.equal(html.match(/<script\b/g)?.length, 1, "only the proof block is a script");
    assert.ok(!html.includes("<b>"));
    assert.equal(extractCertificateProof(html).milestone_id, evil);
  });
});

test("a tampered certificate no longer checks", () => {
  withBatch(ten.leaves, true, (dir) => {
    const [path] = writeCertificates(dir, join(dir, "certificates"), NOW);
    const html = readFileSync(path!, "utf8");
    const file = extractCertificateProof(html);
    const forged = html.replace(`"proof_hash": "${file.proof_hash}"`, `"proof_hash": "${"ff".repeat(32)}"`);
    assert.notEqual(forged, html);
    const check = checkProofFile(extractCertificateProof(forged));
    assert.equal(check.leafMatches, false);
  });
});

test("renderCertificate refuses a file with no anchor", () => {
  withBatch(ten.leaves, false, (dir) => {
    const file = JSON.parse(readFileSync(join(dir, "proofs", readdirSync(join(dir, "proofs"))[0]!), "utf8"));
    assert.throws(() => renderCertificate(file, { generatedAt: NOW }), /never anchored/);
  });
});
