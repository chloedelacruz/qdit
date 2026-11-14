// Drives milestone_proof_v2 on testnet end to end, from throwaway Friendbot
// accounts, through the generated bindings, then writes the evidence log.
//
//   cd packages && npm run harness
//
// Each write is simulated, signed by the account the contract expects, sent and
// confirmed. Each refusal is first checked by simulation, then sent anyway, so
// it lands on the ledger as a failed transaction carrying the contract's error.
// Every check throws on a mismatch: a run that finishes passed all of them.

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { basicNodeSigner, type AssembledTransaction, type Result } from "@stellar/stellar-sdk/contract";
import { MerkleTree } from "@qdit/merkle";
import { Client, Errors, networks } from "@qdit/milestone-proof-v2-bindings";

import { evidencePath, renderEvidence, type Step } from "./evidence.ts";

const RPC_URL = process.env["QDIT_RPC_URL"] ?? "https://soroban-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
const { contractId, networkPassphrase } = networks.testnet;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const server = new rpc.Server(RPC_URL);

type ErrorName = (typeof Errors)[keyof typeof Errors]["message"];
type Tx<T> = AssembledTransaction<Result<T>>;

const steps: Step[] = [];

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`check failed: ${what}`);
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
  tx: Tx<T>,
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

/** A simulated read. `outcome` should throw (via `check`) if the value is wrong. */
function read<T>(title: string, signer: string, tx: Tx<T>, outcome: (value: T) => string): T {
  const value = tx.result.unwrap();
  const text = outcome(value);
  steps.push({ kind: "read", title, signer, outcome: text });
  log(`  ✓ ${title} — ${text} (simulated)`);
  return value;
}

/** The first `Error(Contract, #n)` anywhere in a failed transaction's diagnostic events. */
function contractErrorIn(events: readonly xdr.DiagnosticEvent[]): number | undefined {
  const scan = (v: xdr.ScVal): number | undefined => {
    if (v.switch().name === "scvError" && v.error().switch().name === "sceContract") {
      return v.error().contractCode();
    }
    if (v.switch().name === "scvVec") {
      for (const item of v.vec() ?? []) {
        const hit = scan(item);
        if (hit !== undefined) return hit;
      }
    }
    return undefined;
  };
  for (const ev of events) {
    const body = ev.event().body().v0();
    for (const v of [...body.topics(), body.data()]) {
      const hit = scan(v);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/**
 * A call the contract must refuse with `expected`.
 *
 * The simulation has to fail with that code. Then the call is sent anyway: a
 * failing simulation gives no footprint, so the transaction borrows the
 * resources and footprint of `model`, the same call made valid (another signer
 * or another id), plus any `extraKeys` only the refused call reads. It lands on
 * the ledger as a failed transaction, and its diagnostic events must carry the
 * same code.
 */
async function refuse(
  title: string,
  signer: string,
  kp: Keypair,
  refused: { tx: Tx<unknown>; method: string; args: Record<string, unknown> },
  model: Tx<unknown>,
  expected: ErrorName,
  extraKeys: xdr.LedgerKey[] = [],
): Promise<void> {
  const code = codeOf(expected);
  const sim = refused.tx.simulation;
  const raw = sim && rpc.Api.isSimulationError(sim) ? sim.error : "";
  const hostError = /Error\(Contract, #\d+\)/.exec(raw)?.[0] ?? "";
  if (!refused.tx.result.isErr() || hostError !== `Error(Contract, #${code})`) {
    throw new Error(`${title}: expected ${expected} (#${code}) in simulation, got ${hostError || raw || "success"}`);
  }
  check(model.result.isOk(), `${title}: the model call has to simulate cleanly`);

  const client = clientFor(kp);
  const scArgs = client.spec.funcArgsToScVals(refused.method, refused.args);
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contractId).toScAddress(),
        functionName: refused.method,
        args: scArgs,
      }),
    ),
    subInvocations: [],
  });
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation,
  });

  const modelData = model.simulationData.transactionData;
  const builder = new SorobanDataBuilder(modelData);
  builder.setFootprint([...builder.getReadOnly(), ...extraKeys], builder.getReadWrite());
  const resourceFee = BigInt(modelData.resourceFee().toString()) * 2n;
  builder.setResourceFee(resourceFee.toString());

  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: (BigInt(BASE_FEE) + resourceFee).toString(),
    networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({ contract: contractId, function: refused.method, args: scArgs, auth: [auth] }),
    )
    .setSorobanData(builder.build())
    .setTimeout(60)
    .build();
  tx.sign(kp);

  const submitted = await server.sendTransaction(tx);
  if (submitted.status !== "PENDING") {
    throw new Error(`${title}: the node didn't accept the transaction (${submitted.status})`);
  }
  const done = await server.pollTransaction(submitted.hash, { attempts: 30 });
  if (done.status !== rpc.Api.GetTransactionStatus.FAILED) {
    throw new Error(`${title}: expected a failed transaction, got ${done.status}`);
  }
  const onChain = contractErrorIn(done.diagnosticEventsXdr ?? []);
  if (onChain !== code) {
    throw new Error(`${title}: the failed transaction carries ${onChain === undefined ? "no contract error" : `#${onChain}`}, expected #${code}`);
  }

  steps.push({ kind: "refused", title, signer, expected, code, hostError, txHash: submitted.hash, ledger: done.ledger });
  log(`  ✓ ${title} — refused ${expected} (#${code}) on chain — ${submitted.hash}`);
}

/** The persistent key of `DataKey::Batch(project_id, batch_id)`. */
function batchKey(projectId: string, batchId: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Batch"),
        nativeToScVal(projectId, { type: "string" }),
        nativeToScVal(batchId, { type: "string" }),
      ]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

interface MilestoneView {
  status: { tag: string };
  version: number;
  proof_hash: Buffer;
  approvers: string[];
}

async function main(): Promise<void> {
  const startedAt = new Date();
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

  type Role = keyof typeof roles;
  const c = Object.fromEntries(Object.entries(roles).map(([k, kp]) => [k, clientFor(kp)])) as Record<Role, Client>;
  const addr = Object.fromEntries(Object.entries(roles).map(([k, kp]) => [k, kp.publicKey()])) as Record<Role, string>;

  const project_id = randomUUID();
  const [m1, m2, m3] = ["milestone-1", "milestone-2", "milestone-3"] as const;
  const h1 = sha256(`${project_id}/${m1}/proof`);
  const h2 = sha256(`${project_id}/${m2}/proof`);
  const h2b = sha256(`${project_id}/${m2}/proof, revised`);
  const h3 = sha256(`${project_id}/${m3}/proof`);
  const approver = { tag: "Approver", values: undefined } as const;
  const submitter = { tag: "Submitter", values: undefined } as const;
  log(`project ${project_id}`);

  const statusOf = async (milestone_id: string) =>
    (await c.outsider.get_milestone_status({ project_id, milestone_id })) as Tx<MilestoneView>;
  const describe = (r: MilestoneView) =>
    `status ${r.status.tag}, version ${r.version}, ${r.approvers.length} approval(s)`;
  const expectStatus = (want: { status: string; version: number; approvals: number }) => (r: MilestoneView) => {
    check(
      r.status.tag === want.status && r.version === want.version && r.approvers.length === want.approvals,
      `expected status ${want.status}, version ${want.version}, ${want.approvals} approval(s); got ${describe(r)}`,
    );
    return describe(r);
  };

  // ---- roster and threshold ----
  await send("create_project, threshold 1", "owner",
    await c.owner.create_project({ project_id, owner: addr.owner, threshold: 1 }));
  for (const who of ["approver1", "approver2", "approver3"] as const) {
    await send(`add_member ${who} as Approver`, "owner",
      await c.owner.add_member({ project_id, owner: addr.owner, member: addr[who], role: approver }));
  }
  await send("add_member submitter as Submitter", "owner",
    await c.owner.add_member({ project_id, owner: addr.owner, member: addr.submitter, role: submitter }));
  read("get_members", "anyone", await c.outsider.get_members({ project_id }), (m) => {
    // Typed as a Map, but the SDK decodes an address-keyed map to a plain object.
    const count = m instanceof Map ? m.size : Object.keys(m as object).length;
    check(count === 4, `expected 4 members, got ${count}`);
    return `${count} members`;
  });
  await send("set_threshold 2", "owner",
    await c.owner.set_threshold({ project_id, owner: addr.owner, threshold: 2 }));

  // ---- 2-of-3 approval ----
  await send(`submit_milestone_proof ${m1}`, "submitter",
    await c.submitter.submit_milestone_proof({ project_id, milestone_id: m1, submitter: addr.submitter, proof_hash: h1 }));
  {
    const args = { project_id, milestone_id: m1, submitter: addr.outsider, proof_hash: h1 };
    await refuse(`submit_milestone_proof ${m1} by a non-member`, "outsider", roles.outsider,
      { tx: await c.outsider.submit_milestone_proof(args), method: "submit_milestone_proof", args },
      await c.submitter.submit_milestone_proof({ ...args, submitter: addr.submitter }),
      "NotMember");
  }
  await send(`approve_milestone ${m1}`, "approver1",
    await c.approver1.approve_milestone({ project_id, milestone_id: m1, approver: addr.approver1, proof_hash: h1 }));
  {
    const args = { project_id, milestone_id: m1, approver: addr.approver1, proof_hash: h1 };
    await refuse(`approve_milestone ${m1} a second time`, "approver1", roles.approver1,
      { tx: await c.approver1.approve_milestone(args), method: "approve_milestone", args },
      await c.approver2.approve_milestone({ ...args, approver: addr.approver2 }),
      "AlreadyApproved");
  }
  await send(`approve_milestone ${m1}`, "approver2",
    await c.approver2.approve_milestone({ project_id, milestone_id: m1, approver: addr.approver2, proof_hash: h1 }));
  read(`get_milestone_status ${m1}`, "anyone", await statusOf(m1),
    expectStatus({ status: "Approved", version: 1, approvals: 2 }));

  // ---- removal, rejection, resubmission, lowered threshold ----
  await send("remove_member approver3", "owner",
    await c.owner.remove_member({ project_id, owner: addr.owner, member: addr.approver3 }));
  await send(`submit_milestone_proof ${m2}`, "submitter",
    await c.submitter.submit_milestone_proof({ project_id, milestone_id: m2, submitter: addr.submitter, proof_hash: h2 }));
  {
    const args = { project_id, milestone_id: m2, approver: addr.approver3, proof_hash: h2 };
    await refuse(`approve_milestone ${m2} by the removed approver`, "approver3", roles.approver3,
      { tx: await c.approver3.approve_milestone(args), method: "approve_milestone", args },
      await c.approver1.approve_milestone({ ...args, approver: addr.approver1 }),
      "NotMember");
  }
  await send(`reject_milestone ${m2}`, "approver1",
    await c.approver1.reject_milestone({ project_id, milestone_id: m2, approver: addr.approver1, proof_hash: h2 }));
  read(`get_milestone_status ${m2}`, "anyone", await statusOf(m2),
    expectStatus({ status: "Rejected", version: 1, approvals: 0 }));
  await send(`submit_milestone_proof ${m2} again, revised proof`, "submitter",
    await c.submitter.submit_milestone_proof({ project_id, milestone_id: m2, submitter: addr.submitter, proof_hash: h2b }));
  await send("set_threshold 1", "owner",
    await c.owner.set_threshold({ project_id, owner: addr.owner, threshold: 1 }));
  await send(`approve_milestone ${m2}, now 1 of 1`, "approver1",
    await c.approver1.approve_milestone({ project_id, milestone_id: m2, approver: addr.approver1, proof_hash: h2b }));
  read(`get_milestone_status ${m2}`, "anyone", await statusOf(m2),
    expectStatus({ status: "Approved", version: 2, approvals: 1 }));

  // ---- batch ----
  // Each leaf carries the version the contract recorded: m2 is on version 2.
  await send(`submit_milestone_proof ${m3}`, "submitter",
    await c.submitter.submit_milestone_proof({ project_id, milestone_id: m3, submitter: addr.submitter, proof_hash: h3 }));
  const tree = MerkleTree.build(project_id, [
    { milestoneId: m1, version: 1, proofHash: h1 },
    { milestoneId: m2, version: 2, proofHash: h2b },
    { milestoneId: m3, version: 1, proofHash: h3 },
  ]);
  const root = Buffer.from(tree.root);
  const batch_id = "batch-1";
  await send(`anchor_batch ${batch_id}, 3 leaves`, "submitter",
    await c.submitter.anchor_batch({ project_id, batch_id, submitter: addr.submitter, root, leaf_count: tree.leafCount }),
    () => `root ${root.toString("hex").slice(0, 16)}…`);
  read(`get_batch ${batch_id}`, "anyone", await c.outsider.get_batch({ project_id, batch_id }), (b) => {
    check(b.leaf_count === 3 && Buffer.from(b.root).equals(root), "stored batch should hold our root and 3 leaves");
    return "3 leaves, stored root matches the local tree";
  });
  {
    const args = { project_id, batch_id, submitter: addr.submitter, root, leaf_count: tree.leafCount };
    await refuse(`anchor_batch ${batch_id} again`, "submitter", roles.submitter,
      { tx: await c.submitter.anchor_batch(args), method: "anchor_batch", args },
      await c.submitter.anchor_batch({ ...args, batch_id: "batch-model" }),
      "BatchExists",
      [batchKey(project_id, batch_id)]);
  }

  const proofFor = (milestoneId: string) => {
    const index = tree.indexOf(milestoneId);
    return { index, path: tree.proof(index).map((h) => Buffer.from(h)) };
  };
  // Read-only, sent anyway so the check itself is on the ledger.
  const p2 = proofFor(m2);
  const included = await send(`verify_inclusion ${m2} v2 in ${batch_id}`, "outsider",
    await c.outsider.verify_inclusion({ project_id, batch_id, milestone_id: m2, version: 2, proof_hash: h2b, ...p2 }),
    (ok) => `returned ${ok}`, true);
  check(included, "verify_inclusion should be true for the anchored version");
  read(`verify_inclusion ${m2} claimed as v1`, "anyone",
    await c.outsider.verify_inclusion({ project_id, batch_id, milestone_id: m2, version: 1, proof_hash: h2b, ...p2 }),
    (ok) => {
      check(!ok, "verify_inclusion should be false for a version that wasn't anchored");
      return `returned ${ok}`;
    });
  read(`verify_inclusion ${m2} with the rejected proof hash`, "anyone",
    await c.outsider.verify_inclusion({ project_id, batch_id, milestone_id: m2, version: 2, proof_hash: h2, ...p2 }),
    (ok) => {
      check(!ok, "verify_inclusion should be false for a proof hash that wasn't anchored");
      return `returned ${ok}`;
    });

  // ---- ownership ----
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
  read("get_project", "anyone", await c.submitter.get_project({ project_id }), (p) => {
    check(p.owner === addr.outsider && p.threshold === 1, "owner should be outsider at threshold 1");
    return "owner is outsider, threshold 1";
  });

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
