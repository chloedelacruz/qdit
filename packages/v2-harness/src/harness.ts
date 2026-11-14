// Drives milestone_proof_v2 on testnet end to end, from throwaway Friendbot
// accounts, through the generated bindings, then writes the evidence log.
//
//   cd packages && npm run harness
//
// Each write is simulated, signed by the account the contract expects, sent and
// confirmed. Each refusal is checked by simulation: the contract must refuse
// with the expected error code, and the call is never sent.

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair, rpc } from "@stellar/stellar-sdk";
import { basicNodeSigner, type AssembledTransaction, type Result } from "@stellar/stellar-sdk/contract";
import { MerkleTree } from "@qdit/merkle";
import { Client, Errors, networks } from "@qdit/milestone-proof-v2-bindings";

import { evidencePath, renderEvidence, type Step } from "./evidence.ts";

const RPC_URL = process.env["QDIT_RPC_URL"] ?? "https://soroban-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
const { contractId, networkPassphrase } = networks.testnet;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

type ErrorName = (typeof Errors)[keyof typeof Errors]["message"];

const steps: Step[] = [];

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function codeOf(name: string): number {
  const hit = Object.entries(Errors).find(([, e]) => e.message === name);
  if (!hit) throw new Error(`unknown contract error ${name}`);
  return Number(hit[0]);
}

const sha256 = (data: string | Uint8Array): Buffer => createHash("sha256").update(data).digest();

async function fund(kp: Keypair): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
    if (res.ok) return;
    if (attempt === 3) throw new Error(`Friendbot refused ${kp.publicKey()}: ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

function clientFor(kp: Keypair): Client {
  const { signTransaction, signAuthEntry } = basicNodeSigner(kp, networkPassphrase);
  return new Client({
    contractId,
    networkPassphrase,
    rpcUrl: RPC_URL,
    publicKey: kp.publicKey(),
    signTransaction,
    signAuthEntry,
  });
}

/** Sign, send and confirm a write the simulation accepted. */
async function send<T>(
  title: string,
  signer: string,
  tx: AssembledTransaction<Result<T>>,
  outcome: (value: T) => string = () => "ok",
  force = false,
): Promise<T> {
  const simulated = tx.result;
  if (simulated.isErr()) {
    throw new Error(`${title}: simulation refused with ${simulated.unwrapErr().message}`);
  }
  const sent = await tx.signAndSend({ force });
  const txHash = sent.sendTransactionResponse?.hash;
  const done = sent.getTransactionResponse;
  if (!txHash || !done || done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`${title}: transaction did not succeed (${done?.status ?? "not sent"})`);
  }
  const value = sent.result.unwrap();
  const step: Step = { kind: "sent", title, signer, outcome: outcome(value), txHash, ledger: done.ledger };
  steps.push(step);
  log(`  ✓ ${title} — ${step.outcome} — ${txHash}`);
  return value;
}

/** A simulated read. */
function read<T>(title: string, signer: string, tx: AssembledTransaction<Result<T>>, outcome: (value: T) => string): T {
  const value = tx.result.unwrap();
  steps.push({ kind: "read", title, signer, outcome: outcome(value) });
  log(`  ✓ ${title} — ${outcome(value)} (simulated)`);
  return value;
}

/** The simulation must refuse with `expected`; nothing is sent. */
function refuse<T>(title: string, signer: string, tx: AssembledTransaction<Result<T>>, expected: ErrorName): void {
  const result = tx.result;
  if (!result.isErr()) throw new Error(`${title}: expected ${expected}, but the simulation accepted it`);
  // The SDK's Err carries the error's doc text, so the code is read from the
  // host error the simulation returned.
  const code = codeOf(expected);
  const sim = tx.simulation;
  const raw = sim && rpc.Api.isSimulationError(sim) ? sim.error : "";
  const hostError = /Error\(Contract, #\d+\)/.exec(raw)?.[0] ?? "";
  if (hostError !== `Error(Contract, #${code})`) {
    throw new Error(`${title}: expected ${expected} (#${code}), got ${hostError || raw}`);
  }
  steps.push({ kind: "refused", title, signer, expected, code, hostError });
  log(`  ✓ ${title} — refused ${expected} (#${code})`);
}

const status = (r: { status: { tag: string }; version: number; approvers: string[] }): string =>
  `status ${r.status.tag}, version ${r.version}, ${r.approvers.length} approval(s)`;

async function main(): Promise<void> {
  const startedAt = new Date();
  const server = new rpc.Server(RPC_URL);
  const wasmHash = sha256(await server.getContractWasmByContractId(contractId)).toString("hex");
  log(`milestone_proof_v2 ${contractId}`);
  log(`wasm ${wasmHash}`);

  const roles = {
    owner: Keypair.random(),
    submitter: Keypair.random(),
    approver1: Keypair.random(),
    approver2: Keypair.random(),
    approver3: Keypair.random(),
    outsider: Keypair.random(),
  };
  log("funding 6 throwaway accounts with Friendbot…");
  await Promise.all(Object.values(roles).map(fund));

  const c = Object.fromEntries(Object.entries(roles).map(([k, kp]) => [k, clientFor(kp)])) as Record<
    keyof typeof roles,
    Client
  >;
  const addr = Object.fromEntries(Object.entries(roles).map(([k, kp]) => [k, kp.publicKey()])) as Record<
    keyof typeof roles,
    string
  >;

  const project_id = randomUUID();
  const m1 = "milestone-1";
  const m2 = "milestone-2";
  const m3 = "milestone-3";
  const h1 = sha256(`${project_id}/${m1}/proof`);
  const h2 = sha256(`${project_id}/${m2}/proof`);
  const h3 = sha256(`${project_id}/${m3}/proof`);
  const approver = { tag: "Approver", values: undefined } as const;
  const submitter = { tag: "Submitter", values: undefined } as const;
  log(`project ${project_id}`);

  await send("create_project, threshold 1", "owner",
    await c.owner.create_project({ project_id, owner: addr.owner, threshold: 1 }));
  for (const who of ["approver1", "approver2", "approver3"] as const) {
    await send(`add_member ${who} as Approver`, "owner",
      await c.owner.add_member({ project_id, owner: addr.owner, member: addr[who], role: approver }));
  }
  await send("add_member submitter as Submitter", "owner",
    await c.owner.add_member({ project_id, owner: addr.owner, member: addr.submitter, role: submitter }));
  read("get_members", "anyone", await c.outsider.get_members({ project_id }),
    // Typed as a Map, but the SDK decodes an address-keyed map to a plain object.
    (m) => `${m instanceof Map ? m.size : Object.keys(m as object).length} members`);
  await send("set_threshold 2", "owner",
    await c.owner.set_threshold({ project_id, owner: addr.owner, threshold: 2 }));

  await send(`submit_milestone_proof ${m1}`, "submitter",
    await c.submitter.submit_milestone_proof({ project_id, milestone_id: m1, submitter: addr.submitter, proof_hash: h1 }));
  refuse(`submit_milestone_proof ${m1} by a non-member`, "outsider",
    await c.outsider.submit_milestone_proof({ project_id, milestone_id: m1, submitter: addr.outsider, proof_hash: h1 }),
    "NotMember");

  await send(`approve_milestone ${m1}`, "approver1",
    await c.approver1.approve_milestone({ project_id, milestone_id: m1, approver: addr.approver1, proof_hash: h1 }));
  refuse(`approve_milestone ${m1} a second time`, "approver1",
    await c.approver1.approve_milestone({ project_id, milestone_id: m1, approver: addr.approver1, proof_hash: h1 }),
    "AlreadyApproved");
  await send(`approve_milestone ${m1}`, "approver2",
    await c.approver2.approve_milestone({ project_id, milestone_id: m1, approver: addr.approver2, proof_hash: h1 }));
  const r1 = read(`get_milestone_status ${m1}`, "anyone",
    await c.outsider.get_milestone_status({ project_id, milestone_id: m1 }), status);
  if (r1.status.tag !== "Approved") throw new Error(`${m1} should be Approved after 2 of 2`);

  await send("remove_member approver3", "owner",
    await c.owner.remove_member({ project_id, owner: addr.owner, member: addr.approver3 }));
  await send(`submit_milestone_proof ${m2}`, "submitter",
    await c.submitter.submit_milestone_proof({ project_id, milestone_id: m2, submitter: addr.submitter, proof_hash: h2 }));
  refuse(`approve_milestone ${m2} by the removed approver`, "approver3",
    await c.approver3.approve_milestone({ project_id, milestone_id: m2, approver: addr.approver3, proof_hash: h2 }),
    "NotMember");

  await send("set_threshold 1", "owner",
    await c.owner.set_threshold({ project_id, owner: addr.owner, threshold: 1 }));
  await send(`approve_milestone ${m2}, now 1 of 1`, "approver1",
    await c.approver1.approve_milestone({ project_id, milestone_id: m2, approver: addr.approver1, proof_hash: h2 }),
    () => "Approved at the lowered threshold");

  const tree = MerkleTree.build(project_id, [
    { milestoneId: m1, proofHash: h1 },
    { milestoneId: m2, proofHash: h2 },
    { milestoneId: m3, proofHash: h3 },
  ]);
  const batch_id = "batch-1";
  await send(`anchor_batch ${batch_id}, 3 leaves`, "submitter",
    await c.submitter.anchor_batch({
      project_id, batch_id, submitter: addr.submitter, root: Buffer.from(tree.root), leaf_count: tree.leafCount,
    }),
    () => `root ${Buffer.from(tree.root).toString("hex").slice(0, 16)}…`);
  read(`get_batch ${batch_id}`, "anyone", await c.outsider.get_batch({ project_id, batch_id }),
    (b) => `${b.leaf_count} leaves, root matches: ${Buffer.from(b.root).equals(Buffer.from(tree.root))}`);

  const index = tree.indexOf(m3);
  const path = tree.proof(index).map((h) => Buffer.from(h));
  // Read-only, sent anyway so the check itself is on the ledger.
  const included = await send(`verify_inclusion ${m3} in ${batch_id}`, "outsider",
    await c.outsider.verify_inclusion({ project_id, batch_id, milestone_id: m3, proof_hash: h3, index, path }),
    (ok) => `returned ${ok}`, true);
  if (!included) throw new Error("verify_inclusion should be true for a real proof");
  const forged = read(`verify_inclusion ${m3} with the wrong proof hash`, "anyone",
    await c.outsider.verify_inclusion({ project_id, batch_id, milestone_id: m3, proof_hash: h1, index, path }),
    (ok) => `returned ${ok}`);
  if (forged) throw new Error("verify_inclusion should be false for a wrong proof hash");

  // Both owners sign (D-107): the outgoing owner as the transaction's source,
  // the incoming one by signing their auth entry.
  const transfer = await c.owner.transfer_project_owner({
    project_id, current_owner: addr.owner, new_owner: addr.outsider,
  });
  await transfer.signAuthEntries({
    address: addr.outsider,
    signAuthEntry: basicNodeSigner(roles.outsider, networkPassphrase).signAuthEntry,
  });
  await send("transfer_project_owner to outsider", "owner + outsider", transfer);
  read("get_project", "anyone", await c.submitter.get_project({ project_id }),
    (p) => `owner is outsider: ${p.owner === addr.outsider}, threshold ${p.threshold}`);

  const finishedAt = new Date();
  const date = startedAt.toISOString().slice(0, 10);
  const out = join(repoRoot, evidencePath(date));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderEvidence({
    date,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    contractId,
    wasmHash,
    rpcUrl: RPC_URL,
    projectId: project_id,
    accounts: Object.entries(addr).map(([role, address]) => ({ role, address })),
    steps,
  }));
  log(`\n${steps.length} steps passed. Evidence: ${evidencePath(date)}`);
}

main().catch((e: unknown) => {
  process.stderr.write(`\nharness failed after ${steps.length} steps: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
