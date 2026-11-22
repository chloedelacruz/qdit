// A certificate written by `qdit-batch certificates` carries its proof file;
// @qdit/verify checks what it carries. docs/evidence/qdit-batch-2026-11-19.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractCertificateProof } from "@qdit/merkle";
import { verifyInclusion } from "../src/index.ts";

const EVIDENCE = "../../../docs/evidence/qdit-batch-2026-11-19";
const CERT = readFileSync(new URL(`${EVIDENCE}/certificates/00119-week3-sample-119.html`, import.meta.url), "utf8");
const PROOF = readFileSync(new URL(`${EVIDENCE}/proofs/00119-week3-sample-119.json`, import.meta.url), "utf8");

test("the sample certificate carries the committed proof file", () => {
  assert.deepEqual(extractCertificateProof(CERT), JSON.parse(PROOF));
});

test("the sample certificate verifies offline", async () => {
  const r = await verifyInclusion(extractCertificateProof(CERT));
  assert.equal(r.ok, true, r.reasons.join("; "));
  assert.equal(r.rootConfirmed, false);
});

test("a certificate with a tampered proof hash fails offline", async () => {
  const file = extractCertificateProof(CERT);
  const forged = CERT.replace(`"proof_hash": "${file.proof_hash}"`, `"proof_hash": "${"00".repeat(32)}"`);
  assert.notEqual(forged, CERT);
  const r = await verifyInclusion(extractCertificateProof(forged));
  assert.equal(r.ok, false);
  assert.equal(r.leafMatches, false);
});
