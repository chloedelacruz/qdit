// QA seed for the SOW 3.6 delivery targets, on the live testnet contract.
//
//   cd packages && npm run build && npm run seed -w v2-harness
//
// Five projects, each with its own throwaway Friendbot accounts, run side by
// side. Each sets a threshold of 2 or more and pushes five or six milestones
// through it. Project qa-1 also lands the three refusals on chain, and qa-2 a
// rejection and resubmission. Each project then anchors two batches (one of
// qa-1's has 128 leaves), and every inclusion proof is checked with
// @qdit/verify, offline and on chain, as is every approved milestone.
//
// Everything is written to docs/evidence/qa-<date>/: run.json (every step and
// check), README.md (the same, with links), and the batches with every proof
// file, so anyone can run the checks again.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@stellar/stellar-sdk";
import { MerkleTree, proofFiles, toHex, type InclusionProofFile } from "@qdit/merkle";
import type { Client } from "@qdit/milestone-proof-v2-bindings";
import { verifyInclusion, verifyMilestone } from "@qdit/verify";

import type { SentStep } from "./evidence.ts";
import { renderQa, type QaProject, type QaRun } from "./qa-evidence.ts";
import { Recorder, check, clientFor, contractId, fund, read, refuse, send, server, sha256, type Tx } from "./lib.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

interface Plan {
  name: string;
  approvers: number;
  threshold: number;
  /** Leaves in the project's second, synthetic batch. */
  bulkLeaves: number;
  /** Land the three refusals (qa-1). */
  negatives?: boolean;
  /** Reject a milestone, then resubmit and approve it (qa-2). */
  resubmit?: boolean;
}

const PLANS: Plan[] = [
  { name: "qa-1", approvers: 3, threshold: 2, bulkLeaves: 128, negatives: true },
  { name: "qa-2", approvers: 3, threshold: 2, bulkLeaves: 20, resubmit: true },
  { name: "qa-3", approvers: 3, threshold: 2, bulkLeaves: 20 },
  { name: "qa-4", approvers: 4, threshold: 3, bulkLeaves: 20 },
  { name: "qa-5", approvers: 2, threshold: 2, bulkLeaves: 20 },
];
const MILESTONES = 5;

const approverRole = { tag: "Approver", values: undefined } as const;
const submitterRole = { tag: "Submitter", values: undefined } as const;

interface MilestoneView {
  status: { tag: string };
  version: number;
  approvers: string[];
}

interface Leaf {
  milestoneId: string;
  version: number;
  proofHash: Buffer;
}

async function runProject(plan: Plan): Promise<{ project: QaProject; files: Map<string, InclusionProofFile[]> }> {
  const rec = new Recorder(`[${plan.name}] `);
  const owner = Keypair.random();
  const submitter = Keypair.random();
  const approvers = Array.from({ length: plan.approvers }, () => Keypair.random());
  const outsider = Keypair.random();
  const everyone = [owner, submitter, ...approvers, ...(plan.negatives ? [outsider] : [])];
  rec.log(`funding ${everyone.length} throwaway accounts with Friendbot…`);
  for (const kp of everyone) await fund(kp);

  const c = {
    owner: clientFor(owner),
    submitter: clientFor(submitter),
    approvers: approvers.map(clientFor),
    outsider: clientFor(outsider),
  };
  const project_id = randomUUID();
  rec.log(`project ${project_id}`);
  const approved: Leaf[] = [];

  const statusOf = async (milestone_id: string) =>
    // Reads are simulated from the owner's account: a simulation needs a funded source.
    (await c.owner.get_milestone_status({ project_id, milestone_id })) as Tx<MilestoneView>;
  const expect = (want: { status: string; version: number; approvals: number }) => (r: MilestoneView) => {
    const got = `status ${r.status.tag}, version ${r.version}, ${r.approvers.length} approval(s)`;
    check(
      r.status.tag === want.status && r.version === want.version && r.approvers.length === want.approvals,
      `expected status ${want.status}, version ${want.version}, ${want.approvals} approval(s); got ${got}`,
    );
    return got;
  };
  const submit = (milestone_id: string, proof_hash: Buffer, label = "") =>
    c.submitter
      .submit_milestone_proof({ project_id, milestone_id, submitter: submitter.publicKey(), proof_hash })
      .then((tx) => send(rec, `submit_milestone_proof ${milestone_id}${label}`, "submitter", tx));
  const approve = (i: number, milestone_id: string, proof_hash: Buffer) =>
    c.approvers[i]!
      .approve_milestone({ project_id, milestone_id, approver: approvers[i]!.publicKey(), proof_hash })
      .then((tx) => send(rec, `approve_milestone ${milestone_id}`, `approver${i + 1}`, tx));

  // ---- roster and threshold ----
  await send(rec, "create_project, threshold 1", "owner",
    await c.owner.create_project({ project_id, owner: owner.publicKey(), threshold: 1 }));
  for (let i = 0; i < approvers.length; i++) {
    await send(rec, `add_member approver${i + 1} as Approver`, "owner",
      await c.owner.add_member({ project_id, owner: owner.publicKey(), member: approvers[i]!.publicKey(), role: approverRole }));
  }
  await send(rec, "add_member submitter as Submitter", "owner",
    await c.owner.add_member({ project_id, owner: owner.publicKey(), member: submitter.publicKey(), role: submitterRole }));
  await send(rec, `set_threshold ${plan.threshold}`, "owner",
    await c.owner.set_threshold({ project_id, owner: owner.publicKey(), threshold: plan.threshold }));

  // ---- milestones through the threshold ----
  for (let n = 1; n <= MILESTONES; n++) {
    const milestone_id = `milestone-${n}`;
    const proof_hash = sha256(`${project_id}/${milestone_id}/proof`);
    await submit(milestone_id, proof_hash);

    if (plan.negatives && n === 1) {
      const args = { project_id, milestone_id, submitter: outsider.publicKey(), proof_hash };
      await refuse(rec, `submit_milestone_proof ${milestone_id} by a non-member`, "outsider", outsider,
        { tx: await c.outsider.submit_milestone_proof(args), method: "submit_milestone_proof", args },
        await c.submitter.submit_milestone_proof({ ...args, submitter: submitter.publicKey() }),
        "NotMember");
    }
    for (let i = 0; i < plan.threshold; i++) {
      await approve(i, milestone_id, proof_hash);
      if (plan.negatives && n === 1 && i === 0) {
        const args = { project_id, milestone_id, approver: approvers[0]!.publicKey(), proof_hash };
        await refuse(rec, `approve_milestone ${milestone_id} a second time`, "approver1", approvers[0]!,
          { tx: await c.approvers[0]!.approve_milestone(args), method: "approve_milestone", args },
          await c.approvers[1]!.approve_milestone({ ...args, approver: approvers[1]!.publicKey() }),
          "AlreadyApproved");
      }
    }
    read(rec, `get_milestone_status ${milestone_id}`, "anyone", await statusOf(milestone_id),
      expect({ status: "Approved", version: 1, approvals: plan.threshold }));
    approved.push({ milestoneId: milestone_id, version: 1, proofHash: proof_hash });
  }

  // ---- qa-1: a removed approver is refused ----
  if (plan.negatives) {
    const last = plan.approvers - 1;
    await send(rec, `remove_member approver${last + 1}`, "owner",
      await c.owner.remove_member({ project_id, owner: owner.publicKey(), member: approvers[last]!.publicKey() }));
    const milestone_id = "milestone-6";
    const proof_hash = sha256(`${project_id}/${milestone_id}/proof`);
    await submit(milestone_id, proof_hash);
    const args = { project_id, milestone_id, approver: approvers[last]!.publicKey(), proof_hash };
    await refuse(rec, `approve_milestone ${milestone_id} by the removed approver`, `approver${last + 1}`, approvers[last]!,
      { tx: await c.approvers[last]!.approve_milestone(args), method: "approve_milestone", args },
      await c.approvers[0]!.approve_milestone({ ...args, approver: approvers[0]!.publicKey() }),
      "NotMember");
    for (let i = 0; i < plan.threshold; i++) await approve(i, milestone_id, proof_hash);
    read(rec, `get_milestone_status ${milestone_id}`, "anyone", await statusOf(milestone_id),
      expect({ status: "Approved", version: 1, approvals: plan.threshold }));
    approved.push({ milestoneId: milestone_id, version: 1, proofHash: proof_hash });
  }

  // ---- qa-2: rejection, resubmission, approval of version 2 ----
  if (plan.resubmit) {
    const milestone_id = "milestone-6";
    const first = sha256(`${project_id}/${milestone_id}/proof`);
    const revised = sha256(`${project_id}/${milestone_id}/proof, revised`);
    await submit(milestone_id, first);
    await approve(0, milestone_id, first);
    await send(rec, `reject_milestone ${milestone_id}`, "approver2",
      await c.approvers[1]!.reject_milestone({ project_id, milestone_id, approver: approvers[1]!.publicKey(), proof_hash: first }));
    read(rec, `get_milestone_status ${milestone_id}`, "anyone", await statusOf(milestone_id),
      expect({ status: "Rejected", version: 1, approvals: 1 }));
    await submit(milestone_id, revised, " again, revised proof");
    read(rec, `get_milestone_status ${milestone_id}`, "anyone", await statusOf(milestone_id),
      expect({ status: "Submitted", version: 2, approvals: 0 }));
    for (let i = 0; i < plan.threshold; i++) await approve(i, milestone_id, revised);
    read(rec, `get_milestone_status ${milestone_id}`, "anyone", await statusOf(milestone_id),
      expect({ status: "Approved", version: 2, approvals: plan.threshold }));
    approved.push({ milestoneId: milestone_id, version: 2, proofHash: revised });
  }

  // ---- two batches ----
  const bulk: Leaf[] = Array.from({ length: plan.bulkLeaves }, (_, i) => {
    const milestoneId = `record-${String(i).padStart(3, "0")}`;
    return { milestoneId, version: 1, proofHash: sha256(`${project_id}/${milestoneId}/qa record`) };
  });
  const batches: QaProject["batches"] = [];
  const files = new Map<string, InclusionProofFile[]>();
  for (const [batch_id, leaves] of [
    ["approved", approved],
    ["records", bulk],
  ] as const) {
    const tree = MerkleTree.build(project_id, leaves);
    const root = Buffer.from(tree.root);
    await send(rec, `anchor_batch ${batch_id}, ${tree.leafCount} leaves`, "submitter",
      await c.submitter.anchor_batch({ project_id, batch_id, submitter: submitter.publicKey(), root, leaf_count: tree.leafCount }),
      () => `root ${root.toString("hex").slice(0, 16)}…`);
    const anchored = rec.steps.at(-1) as SentStep;
    const stored = read(rec, `get_batch ${batch_id}`, "anyone", await c.owner.get_batch({ project_id, batch_id }), (b) => {
      check(b.leaf_count === tree.leafCount && Buffer.from(b.root).equals(root), "stored batch should hold our root");
      return `${b.leaf_count} leaves, stored root matches the local tree`;
    });
    const anchor = { tx_hash: anchored.txHash, ledger: stored.ledger, timestamp: Number(stored.timestamp) };
    files.set(batch_id, proofFiles(tree, { network: "testnet", contractId, batchId: batch_id, anchor }));
    batches.push({ batchId: batch_id, leafCount: tree.leafCount, root: toHex(tree.root), ...anchor, proofsVerified: 0, proofsFailed: [] });
  }

  return {
    project: {
      name: plan.name,
      projectId: project_id,
      threshold: plan.threshold,
      approvers: plan.approvers,
      accounts: [
        { role: "owner", address: owner.publicKey() },
        { role: "submitter", address: submitter.publicKey() },
        ...approvers.map((a, i) => ({ role: `approver${i + 1}`, address: a.publicKey() })),
        ...(plan.negatives ? [{ role: "outsider", address: outsider.publicKey() }] : []),
      ],
      steps: rec.steps,
      approvedMilestones: approved.map((m) => ({
        milestoneId: m.milestoneId,
        version: m.version,
        proofHash: m.proofHash.toString("hex"),
        verified: false,
        approvers: [],
      })),
      batches,
    },
    files,
  };
}

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const date = startedAt.toISOString().slice(0, 10);
  const wasmHash = sha256(await server.getContractWasmByContractId(contractId)).toString("hex");
  process.stdout.write(`milestone_proof_v2 ${contractId}\nwasm ${wasmHash}\n`);

  const results = await Promise.allSettled(PLANS.map((p) => runProject(p)));
  const failed = results.flatMap((r, i) => (r.status === "rejected" ? [`${PLANS[i]!.name}: ${String((r.reason as Error)?.message ?? r.reason)}`] : []));
  if (failed.length) throw new Error(`projects failed:\n  ${failed.join("\n  ")}`);
  const done = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof runProject>>>).value);

  // ---- check everything with @qdit/verify ----
  process.stdout.write("checking every approved milestone and inclusion proof with @qdit/verify…\n");
  const outDir = join(repoRoot, `docs/evidence/qa-${date}`);
  const jobs: (() => Promise<void>)[] = [];
  for (const { project, files } of done) {
    for (const m of project.approvedMilestones) {
      jobs.push(async () => {
        const r = await verifyMilestone({
          contractId,
          projectId: project.projectId,
          milestoneId: m.milestoneId,
          expected: { proofHash: m.proofHash, version: m.version },
        });
        m.verified = r.ok && r.approvers.length >= project.threshold;
        m.approvers = r.approvers;
      });
    }
    for (const batch of project.batches) {
      const dir = join(outDir, "batches", project.name, batch.batchId);
      mkdirSync(join(dir, "proofs"), { recursive: true });
      for (const file of files.get(batch.batchId)!) {
        const name = `${String(file.index).padStart(5, "0")}-${file.milestone_id}.json`;
        writeFileSync(join(dir, "proofs", name), JSON.stringify(file, null, 2) + "\n");
        jobs.push(async () => {
          const off = await verifyInclusion(file);
          const on = await verifyInclusion(file, { onChain: true });
          if (off.ok && on.ok && on.batch?.contractSays === true) batch.proofsVerified++;
          else batch.proofsFailed.push(`${file.milestone_id}: ${[...off.reasons, ...on.reasons].join("; ")}`);
        });
      }
    }
  }
  await pool(jobs, 6, (j) => j());

  const run: QaRun = {
    date,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    contractId,
    wasmHash,
    projects: done.map((d) => d.project),
  };
  writeFileSync(join(outDir, "run.json"), JSON.stringify(run, null, 2) + "\n");
  writeFileSync(join(outDir, "README.md"), renderQa(run));

  const proofs = run.projects.flatMap((p) => p.batches);
  const bad = proofs.flatMap((b) => b.proofsFailed);
  const unverified = run.projects.flatMap((p) => p.approvedMilestones.filter((m) => !m.verified).map((m) => `${p.name}/${m.milestoneId}`));
  process.stdout.write(
    `\n${proofs.reduce((n, b) => n + b.proofsVerified, 0)} inclusion proofs verified offline and on chain, ${bad.length} failed.\n` +
      `${run.projects.reduce((n, p) => n + p.approvedMilestones.length, 0) - unverified.length} threshold-approved milestones verified, ${unverified.length} failed.\n` +
      `Evidence: docs/evidence/qa-${date}/\n`,
  );
  if (bad.length || unverified.length) {
    throw new Error(`checks failed:\n  ${[...bad, ...unverified].join("\n  ")}`);
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`\nseed failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
