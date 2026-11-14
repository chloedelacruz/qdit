// Renders one harness run as the Markdown evidence log in docs/evidence/.
// Pure: no network, no clock, so the format is tested on its own.

const EXPERT = "https://stellar.expert/explorer/testnet";

/** A call that landed on the ledger. */
export interface SentStep {
  kind: "sent";
  title: string;
  signer: string;
  /** What the step showed, e.g. "status Submitted". */
  outcome: string;
  txHash: string;
  ledger: number;
}

/** A read, simulated only: it costs nothing and leaves no transaction. */
export interface ReadStep {
  kind: "read";
  title: string;
  signer: string;
  outcome: string;
}

/** A call the contract refused: checked by simulation, then sent and failed on chain. */
export interface RefusedStep {
  kind: "refused";
  title: string;
  signer: string;
  expected: string;
  code: number;
  /** The host error the simulation returned, e.g. `Error(Contract, #7)`. */
  hostError: string;
  /** The failed transaction, whose diagnostic events carry the same code. */
  txHash: string;
  ledger: number;
}

export type Step = SentStep | ReadStep | RefusedStep;

export interface Run {
  /** UTC date of the run, `YYYY-MM-DD`. */
  date: string;
  /** ISO timestamps of the run's start and end. */
  startedAt: string;
  finishedAt: string;
  contractId: string;
  /** sha256 of the wasm the contract runs, fetched from chain. */
  wasmHash: string;
  rpcUrl: string;
  projectId: string;
  /** Role name to the throwaway account that played it. */
  accounts: readonly { role: string; address: string }[];
  steps: readonly Step[];
}

export const evidencePath = (date: string): string => `docs/evidence/v2-harness-${date}.md`;

const short = (s: string): string => `${s.slice(0, 8)}…${s.slice(-6)}`;
const txLink = (hash: string): string => `[\`${short(hash)}\`](${EXPERT}/tx/${hash})`;
const accountLink = (address: string): string =>
  `[\`${short(address)}\`](${EXPERT}/account/${address})`;

/** Each step gets the step number it has in the log, counting from 1. */
function numbered(steps: readonly Step[]): { n: number; step: Step }[] {
  return steps.map((step, i) => ({ n: i + 1, step }));
}

export function renderEvidence(run: Run): string {
  const all = numbered(run.steps);
  const sent = all.filter(({ step }) => step.kind === "sent").length;
  const refused = all.filter(({ step }) => step.kind === "refused");

  const lines: string[] = [
    `# milestone_proof_v2 testnet harness: ${run.date}`,
    "",
    "Written by `packages/v2-harness` (`cd packages && npm run harness`). Every write and",
    "every refusal below links its testnet transaction on Stellar Expert. Every check the",
    "harness logs is also asserted: a run that wrote this file passed all of them. Nothing",
    "here was edited by hand.",
    "",
    "| | |",
    "| --- | --- |",
    `| Contract | [\`${run.contractId}\`](${EXPERT}/contract/${run.contractId}) |`,
    `| WASM hash (fetched from chain) | \`${run.wasmHash}\` |`,
    `| RPC | ${run.rpcUrl} |`,
    `| Project id | \`${run.projectId}\` |`,
    `| Started | ${run.startedAt} |`,
    `| Finished | ${run.finishedAt} |`,
    `| Steps | ${run.steps.length}: ${sent} sent, ${refused.length} refused as expected (also on chain), ${run.steps.length - sent - refused.length} simulated reads |`,
    "",
    "## Accounts",
    "",
    "Throwaway keys, made and funded by Friendbot for this run only. Their secrets were",
    "never written down.",
    "",
    "| Role | Address |",
    "| --- | --- |",
    ...run.accounts.map((a) => `| ${a.role} | ${accountLink(a.address)} |`),
    "",
    "## Steps",
    "",
    "| # | Step | Signer | Result | Transaction |",
    "| ---: | --- | --- | --- | --- |",
    ...all.map(({ n, step }) => {
      switch (step.kind) {
        case "sent":
          return `| ${n} | ${step.title} | ${step.signer} | ${step.outcome} | ${txLink(step.txHash)} (ledger ${step.ledger}) |`;
        case "read":
          return `| ${n} | ${step.title} | ${step.signer} | ${step.outcome} | simulated read, no transaction |`;
        case "refused":
          return `| ${n} | ${step.title} | ${step.signer} | refused: \`${step.expected}\` (#${step.code}) | ${txLink(step.txHash)} (ledger ${step.ledger}), failed as expected |`;
      }
    }),
    "",
    "## Refusals",
    "",
    "Each refusal is checked twice. Its simulation has to fail with the expected contract",
    "error. Then it is signed and sent anyway, borrowing the footprint of the same call made",
    "valid, so it lands on the ledger as a failed transaction; the harness reads that",
    "transaction's diagnostic events and checks they carry the same code.",
    "",
    "| # | Call | Signer | Expected | Simulation | Failed transaction |",
    "| ---: | --- | --- | --- | --- | --- |",
    ...refused.map(({ n, step }) => {
      const r = step as RefusedStep;
      return `| ${n} | ${r.title} | ${r.signer} | \`${r.expected}\` (#${r.code}) | \`${r.hostError}\` | ${txLink(r.txHash)} |`;
    }),
    "",
  ];
  return lines.join("\n");
}
