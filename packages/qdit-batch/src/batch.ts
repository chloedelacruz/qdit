// Everything qdit-batch does that needs no network: read the input, build the
// tree, and lay out the output directory.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  MerkleTree,
  fromHex,
  isU32,
  proofFiles,
  toHex,
  type AnchorInfo,
  type InclusionProofFile,
} from "@qdit/merkle";

/** The input file: one project, the milestones to batch, in order. */
export interface BatchInput {
  project_id: string;
  /** `version` is the milestone's submission version, as the contract records it. */
  milestones: { milestone_id: string; version: number; proof_hash: string }[];
}

/** Ids the contract accepts: at most 64 bytes (`IdTooLong`). */
const MAX_ID_BYTES = 64;

export function parseInput(json: string): BatchInput {
  const v = JSON.parse(json) as Partial<BatchInput>;
  if (typeof v.project_id !== "string") throw new TypeError("input: project_id must be a string");
  checkId("project_id", v.project_id);
  if (!Array.isArray(v.milestones)) throw new TypeError("input: milestones must be a list");
  v.milestones.forEach((m, i) => {
    if (typeof m?.milestone_id !== "string") throw new TypeError(`input: milestones[${i}].milestone_id must be a string`);
    checkId(`milestones[${i}].milestone_id`, m.milestone_id);
    if (!isU32(m.version)) throw new TypeError(`input: milestones[${i}].version must be a whole number from 0 to 2^32-1`);
    if (typeof m.proof_hash !== "string") throw new TypeError(`input: milestones[${i}].proof_hash must be hex`);
    fromHex(m.proof_hash, 32);
  });
  return v as BatchInput;
}

export function checkId(name: string, id: string): void {
  const bytes = new TextEncoder().encode(id).length;
  if (bytes > MAX_ID_BYTES) throw new RangeError(`${name} is ${bytes} bytes; the contract allows ${MAX_ID_BYTES}`);
}

export function buildTree(input: BatchInput): MerkleTree {
  return MerkleTree.build(
    input.project_id,
    input.milestones.map((m) => ({
      milestoneId: m.milestone_id,
      version: m.version,
      proofHash: fromHex(m.proof_hash, 32),
    })),
  );
}

/** `batch.json`: the batch as a whole, for the record. */
export interface BatchSummary {
  format: "qdit-batch/v2";
  network: string;
  contract_id: string;
  project_id: string;
  batch_id: string;
  root: string;
  leaf_count: number;
  milestones: { index: number; milestone_id: string; version: number; proof_hash: string; leaf: string; proof_file: string }[];
  anchor?: AnchorInfo & { submitter: string; fee_charged_stroops: string };
}

/** A proof file name that is safe on every filesystem and still sorts by index. */
export function proofFileName(file: InclusionProofFile): string {
  const safe = file.milestone_id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "milestone";
  return `${String(file.index).padStart(5, "0")}-${safe}.json`;
}

export interface WriteContext {
  network: string;
  contractId: string;
  batchId: string;
  anchor?: AnchorInfo;
  submitter?: string;
  feeCharged?: bigint;
}

/** Write `batch.json` and `proofs/*.json` under `outDir`. Returns the summary. */
export function writeBatch(outDir: string, tree: MerkleTree, ctx: WriteContext): BatchSummary {
  const files = proofFiles(tree, {
    network: ctx.network,
    contractId: ctx.contractId,
    batchId: ctx.batchId,
    ...(ctx.anchor ? { anchor: ctx.anchor } : {}),
  });

  const proofsDir = join(outDir, "proofs");
  mkdirSync(proofsDir, { recursive: true });
  const names = files.map((f) => {
    const name = proofFileName(f);
    writeFileSync(join(proofsDir, name), JSON.stringify(f, null, 2) + "\n");
    return name;
  });

  const summary: BatchSummary = {
    format: "qdit-batch/v2",
    network: ctx.network,
    contract_id: ctx.contractId,
    project_id: tree.projectId,
    batch_id: ctx.batchId,
    root: toHex(tree.root),
    leaf_count: tree.leafCount,
    milestones: files.map((f, i) => ({
      index: f.index,
      milestone_id: f.milestone_id,
      version: f.version,
      proof_hash: f.proof_hash,
      leaf: f.leaf,
      proof_file: `proofs/${names[i]}`,
    })),
  };
  if (ctx.anchor) {
    summary.anchor = {
      ...ctx.anchor,
      submitter: ctx.submitter ?? "",
      fee_charged_stroops: (ctx.feeCharged ?? 0n).toString(),
    };
  }
  writeFileSync(join(outDir, "batch.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}
