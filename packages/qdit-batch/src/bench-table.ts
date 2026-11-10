#!/usr/bin/env node
// Print the markdown tables in docs/merkle/BENCHMARK.md from a bench.ts
// results file, so the published numbers can be regenerated, not retyped.
//
//   node src/bench-table.ts ../../docs/merkle/benchmark/testnet-2026-11-10.json

import { readFileSync } from "node:fs";

interface Side {
  transactions: number;
  fee_charged_stroops: string;
  resource_fee_stroops: string;
  instructions: number;
  write_bytes: number;
  tx_bytes: number;
  ledgers_spanned: number;
  wall_seconds: number;
}
interface Row {
  milestones: number;
  individual: Side;
  batch: Side;
  verify_inclusion: { proof_hashes: number; instructions: number; resource_fee_stroops: string };
}

const path = process.argv[2];
if (!path) {
  console.error("usage: bench-table.ts <results.json>");
  process.exit(2);
}
const report = JSON.parse(readFileSync(path, "utf8")) as { rows: Row[] };

const STROOPS_PER_XLM = 10_000_000;
const xlm = (stroops: string | number) => (Number(stroops) / STROOPS_PER_XLM).toFixed(4);
const n = (v: number) => v.toLocaleString("en-US");
const ratio = (a: number, b: number) => (b === 0 ? "–" : `${(a / b).toFixed(1)}×`);

const lines: string[] = [];
lines.push("| Milestones | Individual: tx | Individual: fee (XLM) | Batch: tx | Batch: fee (XLM) | Fee saved | Individual: ledgers | Batch: ledgers |");
lines.push("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const r of report.rows) {
  const ind = Number(r.individual.fee_charged_stroops);
  const bat = Number(r.batch.fee_charged_stroops);
  lines.push(
    `| ${r.milestones} | ${r.individual.transactions} | ${xlm(ind)} | ${r.batch.transactions} | ${xlm(bat)} | ` +
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
console.log(lines.join("\n"));
