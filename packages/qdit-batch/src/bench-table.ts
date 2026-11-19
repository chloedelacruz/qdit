#!/usr/bin/env node
// Print the markdown tables in docs/merkle/BENCHMARK.md from a bench.ts
// results file, so the published numbers can be regenerated, not retyped.
//
//   node src/bench-table.ts ../../docs/merkle/benchmark/testnet-2026-11-19.json
//   node src/bench-table.ts --tx-list ../../docs/merkle/benchmark/testnet-2026-11-19.json
//
// The second form prints the list of every transaction, which the first
// form's transactions table links to as benchmark/<results>-transactions.md.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";

interface Side {
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
interface Row {
  milestones: number;
  individual: Side;
  batch: Side;
  verify_inclusion: { proof_hashes: number; instructions: number; resource_fee_stroops: string };
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: { "tx-list": { type: "boolean", default: false } },
  allowPositionals: true,
});
const path = positionals[0];
if (!path) {
  console.error("usage: bench-table.ts [--tx-list] <results.json>");
  process.exit(2);
}
const report = JSON.parse(readFileSync(path, "utf8")) as { contract_id: string; run_at: string; rows: Row[] };
const txListFile = `benchmark/${basename(path, ".json")}-transactions.md`;
const txUrl = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
const txLink = (hash: string) => `[\`${hash.slice(0, 8)}…\`](${txUrl(hash)})`;

if (values["tx-list"]) {
  const out: string[] = [];
  out.push(`# Benchmark transactions, ${report.run_at.slice(0, 10)}`);
  out.push("");
  out.push(`Every transaction from \`${basename(path)}\`, on Stellar testnet contract \`${report.contract_id}\`.`);
  for (const r of report.rows) {
    out.push("");
    out.push(`## N = ${r.milestones}`);
    out.push("");
    out.push(`Batch (\`anchor_batch\`): [\`${r.batch.tx_hashes[0]}\`](${txUrl(r.batch.tx_hashes[0]!)})`);
    out.push("");
    out.push(`Individual (\`submit_milestone_proof\`), in the order sent:`);
    out.push("");
    r.individual.tx_hashes.forEach((h, i) => out.push(`${i + 1}. [\`${h}\`](${txUrl(h)})`));
  }
  console.log(out.join("\n"));
  process.exit(0);
}

const STROOPS_PER_XLM = 10_000_000;
const xlm = (stroops: string | number) => (Number(stroops) / STROOPS_PER_XLM).toFixed(4);
const n = (v: number) => v.toLocaleString("en-US");
const ratio = (a: number, b: number) => (b === 0 ? "–" : `${(a / b).toFixed(1)}×`);

const lines: string[] = [];
lines.push("| Milestones | Individual: tx | Individual: fee (XLM) | Batch: tx | Batch: fee (XLM) | Individual: fee per milestone (XLM) | Batch: fee per milestone (XLM) | Fee saved | Individual: ledgers | Batch: ledgers |");
lines.push("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const r of report.rows) {
  const ind = Number(r.individual.fee_charged_stroops);
  const bat = Number(r.batch.fee_charged_stroops);
  lines.push(
    `| ${r.milestones} | ${r.individual.transactions} | ${xlm(ind)} | ${r.batch.transactions} | ${xlm(bat)} | ` +
      `${xlm(ind / r.milestones)} | ${xlm(bat / r.milestones)} | ` +
      `${ratio(ind, bat)} | ${r.individual.ledgers_spanned} | ${r.batch.ledgers_spanned} |`,
  );
}
lines.push("");
lines.push("| Milestones | Individual: CPU instructions | Batch: CPU instructions | Individual: bytes written | Batch: bytes written | Individual: wall time (s) | Batch: wall time (s) |");
lines.push("| ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const r of report.rows) {
  lines.push(
    `| ${r.milestones} | ${n(r.individual.instructions)} | ${n(r.batch.instructions)} | ` +
      `${n(r.individual.write_bytes)} | ${n(r.batch.write_bytes)} | ${r.individual.wall_seconds} | ${r.batch.wall_seconds} |`,
  );
}
lines.push("");
lines.push("| Milestones | Proof length (hashes) | `verify_inclusion` CPU instructions | Resource fee if sent (XLM) |");
lines.push("| ---: | ---: | ---: | ---: |");
for (const r of report.rows) {
  lines.push(
    `| ${r.milestones} | ${r.verify_inclusion.proof_hashes} | ${n(r.verify_inclusion.instructions)} | ${xlm(r.verify_inclusion.resource_fee_stroops)} |`,
  );
}
lines.push("");
lines.push("| Milestones | Batch tx | Individual txs |");
lines.push("| ---: | --- | --- |");
for (const r of report.rows) {
  const all = `[all ${r.individual.transactions}](./${txListFile}#n--${r.milestones})`;
  const first = txLink(r.individual.tx_hashes[0]!);
  lines.push(
    `| ${r.milestones} | ${txLink(r.batch.tx_hashes[0]!)} | ` +
      (r.individual.transactions === 1 ? `${first} |` : `first ${first}, ${all} |`),
  );
}
console.log(lines.join("\n"));
