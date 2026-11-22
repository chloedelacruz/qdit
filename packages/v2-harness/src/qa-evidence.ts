// Renders a QA seed run (seed.ts) as the Markdown evidence in docs/evidence/.
// Pure: no network, no clock, so the format is tested on its own.

import type { Step } from "./evidence.ts";

const EXPERT = "https://stellar.expert/explorer/testnet";

export interface QaBatch {
  batchId: string;
  leafCount: number;
  /** Lowercase hex. */
  root: string;
  tx_hash: string;
  ledger: number;
  timestamp: number;
  /** Proofs that passed @qdit/verify both offline and on chain. */
  proofsVerified: number;
  proofsFailed: string[];
}

export interface QaProject {
  name: string;
  projectId: string;
  threshold: number;
  approvers: number;
  accounts: { role: string; address: string }[];
  steps: Step[];
  approvedMilestones: { milestoneId: string; version: number; proofHash: string; verified: boolean; approvers: string[] }[];
  batches: QaBatch[];
}

export interface QaRun {
  date: string;
  startedAt: string;
  finishedAt: string;
  contractId: string;
  wasmHash: string;
  projects: QaProject[];
  /** Anything a reader should know about the run, added after it. */
  notes?: string[];
}

export interface QaTotals {
  projectsAtThreshold2: number;
  milestonesThroughThreshold: number;
  refusals: { expected: string; txHash: string; title: string }[];
  batches: number;
  largestBatch: number;
  proofsVerified: number;
  proofsFailed: number;
  transactions: number;
}

export function qaTotals(run: QaRun): QaTotals {
  const batches = run.projects.flatMap((p) => p.batches);
  const steps = run.projects.flatMap((p) => p.steps);
  return {
    projectsAtThreshold2: run.projects.filter((p) => p.threshold >= 2).length,
    milestonesThroughThreshold: run.projects
      .filter((p) => p.threshold >= 2)
      .reduce((n, p) => n + p.approvedMilestones.filter((m) => m.verified && m.approvers.length >= p.threshold).length, 0),
    refusals: steps.flatMap((s) => (s.kind === "refused" ? [{ expected: s.expected, txHash: s.txHash, title: s.title }] : [])),
    batches: batches.length,
    largestBatch: Math.max(0, ...batches.map((b) => b.leafCount)),
    proofsVerified: batches.reduce((n, b) => n + b.proofsVerified, 0),
    proofsFailed: batches.reduce((n, b) => n + b.proofsFailed.length, 0),
    transactions: steps.filter((s) => s.kind !== "read").length,
  };
}

const short = (s: string): string => `${s.slice(0, 8)}…${s.slice(-6)}`;
const tx = (hash: string): string => `[\`${short(hash)}\`](${EXPERT}/tx/${hash})`;
const account = (a: string): string => `[\`${short(a)}\`](${EXPERT}/account/${a})`;
const cell = (s: string): string => s.replace(/\|/g, "\\|");

function stepRow(s: Step, i: number): string {
  switch (s.kind) {
    case "sent":
      return `| ${i + 1} | ${cell(s.title)} | ${s.signer} | ${cell(s.outcome)} | ${tx(s.txHash)} (ledger ${s.ledger}) |`;
    case "read":
      return `| ${i + 1} | ${cell(s.title)} | ${s.signer} | ${cell(s.outcome)} | simulated |`;
    case "refused":
      return `| ${i + 1} | ${cell(s.title)} | ${s.signer} | refused: \`${s.expected}\` (#${s.code}) | ${tx(s.txHash)} (ledger ${s.ledger}), failed as expected |`;
  }
}

export function renderQa(run: QaRun): string {
  const t = qaTotals(run);
  const out: string[] = [];
  out.push(`# QA seed on testnet, ${run.date}`, "");
  out.push(
    "Five projects on the current `milestone_proof_v2` contract, driven by `packages/v2-harness/src/seed.ts` from",
    "throwaway Friendbot accounts. Every approved milestone and every inclusion proof was then checked with",
    "`@qdit/verify`: milestones with `verifyMilestone`, proofs with `verifyInclusion` offline and on chain.",
    "",
    "| | |",
    "| --- | --- |",
    `| Contract | [\`${run.contractId}\`](${EXPERT}/contract/${run.contractId}) |`,
    `| WASM hash | \`${run.wasmHash}\` |`,
    `| Run | ${run.startedAt} to ${run.finishedAt} |`,
    `| Transactions | ${t.transactions} |`,
    "",
    "## Against the SOW 3.6 targets",
    "",
    "| Target | This run |",
    "| --- | --- |",
    `| At least 5 projects with a threshold of 2 or more | ${t.projectsAtThreshold2} |`,
    `| At least 20 milestones approved through the threshold | ${t.milestonesThroughThreshold}, each verified with \`verifyMilestone\` |`,
    `| The 3 refusals on chain (non-member submit, removed approver, duplicate approval) | ${t.refusals.length}: ${t.refusals.map((r) => `\`${r.expected}\` ${tx(r.txHash)}`).join(", ")} |`,
    `| At least 10 batches, one of at least 100 milestones | ${t.batches}, the largest ${t.largestBatch} leaves |`,
    `| At least 100 inclusion proofs verified on chain and offline | ${t.proofsVerified} (${t.proofsFailed} failed) |`,
    "",
    "## Check it yourself",
    "",
    "```sh",
    "cd packages && npm ci && npm run build",
    `node verify/dist/cli.js proof ../docs/evidence/qa-${run.date}/batches/qa-1/records/proofs/00127-record-127.json`,
    `node verify/dist/cli.js milestone --project ${run.projects[0]?.projectId ?? "<project>"} --milestone milestone-1`,
    "```",
    "",
    "Every proof file is under `batches/<project>/<batch>/proofs/`; `run.json` holds every step and check.",
    "",
  );

  if (run.notes?.length) out.push("## Notes", "", ...run.notes.map((n) => `- ${n}`), "");

  for (const p of run.projects) {
    out.push(`## ${p.name}: ${p.threshold} of ${p.approvers} approvers`, "");
    out.push(`Project id \`${p.projectId}\`.`, "");
    out.push("| Role | Account |", "| --- | --- |", ...p.accounts.map((a) => `| ${a.role} | ${account(a.address)} |`), "");
    out.push("| # | Step | Signer | Outcome | Transaction |", "| ---: | --- | --- | --- | --- |", ...p.steps.map(stepRow), "");
    out.push(
      "| Approved milestone | Version | Approvers | `verifyMilestone` |",
      "| --- | ---: | ---: | --- |",
      ...p.approvedMilestones.map((m) => `| ${m.milestoneId} | ${m.version} | ${m.approvers.length} | ${m.verified ? "ok" : "FAILED"} |`),
      "",
    );
    out.push(
      "| Batch | Leaves | Root | Anchor | Proofs verified |",
      "| --- | ---: | --- | --- | --- |",
      ...p.batches.map(
        (b) =>
          `| ${b.batchId} | ${b.leafCount} | \`${b.root.slice(0, 16)}…\` | ${tx(b.tx_hash)} (ledger ${b.ledger}) | ${b.proofsVerified} of ${b.leafCount} |`,
      ),
      "",
    );
  }
  return out.join("\n");
}
