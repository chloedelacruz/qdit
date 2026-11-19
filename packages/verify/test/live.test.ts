// Against the real testnet RPC and the deployed contract. Skipped unless
// QDIT_LIVE=1, so CI and offline runs never depend on the network.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyInclusion, verifyMilestone } from "../src/index.ts";

const skip = process.env.QDIT_LIVE === "1" ? false : "set QDIT_LIVE=1 to run against testnet";

const CONTRACT = "CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB";
// docs/evidence/v2-harness-2026-11-14.md
const HARNESS_PROJECT = "817745fb-e68a-497b-bd7a-b7d3fc1e4556";
// docs/evidence/qdit-batch-2026-11-19
const PROOF = new URL(
  "../../../docs/evidence/qdit-batch-2026-11-19/proofs/00119-week3-sample-119.json",
  import.meta.url,
);

test("live: the harness's 2-of-3 milestone verifies", { skip }, async () => {
  const r = await verifyMilestone({
    contractId: CONTRACT,
    projectId: HARNESS_PROJECT,
    milestoneId: "milestone-1",
    expected: { version: 1 },
  });
  assert.equal(r.ok, true, r.reasons.join("; "));
  assert.equal(r.status, "Approved");
  assert.deepEqual(r.approvers, [
    "GDOLRV23WSKETDK2GS7X7FUN3BSNYPPVSIOH4DFJXJ2W4FZ56B4GZB2E",
    "GAWJCSDYPBDUI7EBJZASFFRVPHY37CITJTUQNPQZZKYKZZQ7A77GDGRM",
  ]);
});

test("live: the harness's rejected-then-resubmitted milestone verifies at version 2 only", { skip }, async () => {
  const base = { contractId: CONTRACT, projectId: HARNESS_PROJECT, milestoneId: "milestone-2" };
  assert.equal((await verifyMilestone({ ...base, expected: { version: 2 } })).ok, true);
  const stale = await verifyMilestone({ ...base, expected: { version: 1 } });
  assert.equal(stale.ok, false);
  assert.deepEqual(stale.reasons, ["version on chain is 2, expected 1"]);
});

test("live: the committed qdit-batch proof verifies offline and on chain", { skip }, async () => {
  const text = readFileSync(PROOF, "utf8");
  const off = await verifyInclusion(text);
  assert.equal(off.ok, true, off.reasons.join("; "));

  const on = await verifyInclusion(text, { onChain: true });
  assert.equal(on.ok, true, on.reasons.join("; "));
  assert.equal(on.batch?.contractSays, true);
  assert.equal(on.batch?.leafCount, 120);
});

test("live: a tampered copy of that proof fails on chain", { skip }, async () => {
  const file = JSON.parse(readFileSync(PROOF, "utf8"));
  file.proof_hash = "00".repeat(32);
  const on = await verifyInclusion(file, { onChain: true });
  assert.equal(on.ok, false);
  assert.equal(on.batch?.contractSays, false);
});
