// Drives milestone_proof_v2 on testnet end to end, from throwaway Friendbot
// accounts, through the generated bindings, then writes the evidence log.
//
//   cd packages && npm run harness
//
// Each write is simulated, signed by the account the contract expects, sent and
// confirmed. Each refusal is first checked by simulation, then sent anyway, so
// it lands on the ledger as a failed transaction carrying the contract's error.
// Every check throws on a mismatch: a run that finishes passed all of them.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { MerkleTree } from "@qdit/merkle";
import type { Client } from "@qdit/milestone-proof-v2-bindings";

import { evidencePath, renderEvidence } from "./evidence.ts";
import * as lib from "./lib.ts";
import { RPC_URL, batchKey, check, clientFor, contractId, fund, networkPassphrase, server, sha256, type Tx } from "./lib.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const rec = new lib.Recorder();
const steps = rec.steps;
const log = (line: string) => rec.log(line);
const send = <T>(title: string, signer: string, tx: Tx<T>, outcome?: (value: T) => string, force?: boolean) =>
  lib.send(rec, title, signer, tx, outcome, force);
const read = <T>(title: string, signer: string, tx: Tx<T>, outcome: (value: T) => string) =>
  lib.read(rec, title, signer, tx, outcome);
const refuse = (...a: Parameters<typeof lib.refuse> extends [unknown, ...infer R] ? R : never) => lib.refuse(rec, ...a);

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
