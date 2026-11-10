#!/usr/bin/env node
// Testnet benchmark: anchor N milestone proofs one transaction each
// (submit_milestone_proof) against one anchor_batch for all N, at
// N = 1, 10, 50, 100. Every number comes from a real transaction.
//
//   node src/bench.ts --contract C... [--sizes 1,10,50,100] [--out results.json]
//
// It funds a fresh account through friendbot unless QDIT_SECRET_KEY is set,
// creates its own project and makes itself the Submitter, so it never touches
// anyone else's records.

import { randomUUID, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { Keypair } from "@stellar/stellar-sdk";
import { MerkleTree, toHex } from "@qdit/merkle";

import { Client, TESTNET, fund, sc, type Sent } from "./soroban.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    contract: { type: "string" },
    sizes: { type: "string", default: "1,10,50,100" },
    out: { type: "string", default: "bench-results.json" },
  },
});
if (!values.contract) {
  console.error("bench: --contract <milestone_proof_v2 id> is required");
  process.exit(2);
}
const sizes = values.sizes.split(",").map((s) => Number.parseInt(s, 10));

const client = new Client(TESTNET, values.contract);
const key = process.env.QDIT_SECRET_KEY ? Keypair.fromSecret(process.env.QDIT_SECRET_KEY.trim()) : Keypair.random();
if (!process.env.QDIT_SECRET_KEY) {
  await fund(TESTNET, key.publicKey());
}
const me = key.publicKey();

const projectId = randomUUID();
await client.invoke(key, "create_project", [sc.string(projectId), sc.address(me), sc.u32(1)]);
await client.invoke(key, "add_member", [
  sc.string(projectId),
  sc.address(me),
  sc.address(me),
  // Role is a unit enum: a vec holding its name.
  sc.vec([sc.symbol("Submitter")]),
]);
console.error(`bench: project ${projectId}, submitter ${me}`);

const proofHash = (label: string) => new Uint8Array(createHash("sha256").update(label).digest());

interface Totals {
  transactions: number;
  fee_charged_stroops: string;
  resource_fee_stroops: string;
  instructions: number;
  write_bytes: number;
  tx_bytes: number;
  ledgers_spanned: number;
  wall_seconds: number;
  tx_hashes: string[];
}

function totals(sent: Sent[], startedAt: number): Totals {
  const ledgers = sent.map((s) => s.ledger);
  return {
    transactions: sent.length,
    fee_charged_stroops: sent.reduce((a, s) => a + s.feeCharged, 0n).toString(),
    resource_fee_stroops: sent.reduce((a, s) => a + s.resourceFee, 0n).toString(),
    instructions: sent.reduce((a, s) => a + s.instructions, 0),
    write_bytes: sent.reduce((a, s) => a + s.writeBytes, 0),
    tx_bytes: sent.reduce((a, s) => a + s.txBytes, 0),
    ledgers_spanned: Math.max(...ledgers) - Math.min(...ledgers) + 1,
    wall_seconds: Math.round((Date.now() - startedAt) / 100) / 10,
    tx_hashes: sent.map((s) => s.txHash),
  };
}

const rows = [];
for (const n of sizes) {
  const milestones = Array.from({ length: n }, (_, i) => ({
    milestoneId: randomUUID(),
    proofHash: proofHash(`bench ${n} milestone ${i}`),
  }));

  // One transaction per milestone, sent one after another.
  const individualStart = Date.now();
  const individual: Sent[] = [];
  for (const m of milestones) {
    individual.push(
      await client.invoke(key, "submit_milestone_proof", [
        sc.string(projectId),
        sc.string(m.milestoneId),
        sc.address(me),
        sc.bytes(m.proofHash),
      ]),
    );
    process.stderr.write(".");
  }
  process.stderr.write("\n");

  // The same milestones as one batch.
  const tree = MerkleTree.build(projectId, milestones);
  const batchId = `bench-${n}-${Date.now()}`;
  const batchStart = Date.now();
  const batch = await client.invoke(key, "anchor_batch", [
    sc.string(projectId),
    sc.string(batchId),
    sc.address(me),
    sc.bytes(tree.root),
    sc.u32(n),
  ]);

  // Checking the last leaf, which has the longest path, by simulation.
  const last = n - 1;
  const check = await client.read("verify_inclusion", [
    sc.string(projectId),
    sc.string(batchId),
    sc.string(milestones[last]!.milestoneId),
    sc.bytes(milestones[last]!.proofHash),
    sc.u32(last),
    sc.vec(tree.proof(last).map((h) => sc.bytes(h))),
  ]);
  if (check.value !== true) throw new Error(`verify_inclusion returned ${String(check.value)} for N=${n}`);

  const row = {
    milestones: n,
    individual: totals(individual, individualStart),
    batch: { ...totals([batch], batchStart), batch_id: batchId, root: toHex(tree.root) },
    verify_inclusion: {
      proof_hashes: tree.proof(last).length,
      instructions: check.instructions,
      resource_fee_stroops: check.resourceFee.toString(),
    },
  };
  rows.push(row);
  console.error(
    `N=${n}: individual ${row.individual.transactions} tx, ${row.individual.fee_charged_stroops} stroops, ` +
      `${row.individual.ledgers_spanned} ledgers | batch 1 tx, ${row.batch.fee_charged_stroops} stroops`,
  );
}

const report = {
  network: TESTNET.name,
  rpc: TESTNET.rpcUrl,
  contract_id: client.contractId,
  project_id: projectId,
  submitter: me,
  run_at: new Date().toISOString(),
  inclusion_fee_bid_stroops: 100,
  rows,
};
writeFileSync(values.out, JSON.stringify(report, null, 2) + "\n");
console.error(`bench: wrote ${values.out}`);
