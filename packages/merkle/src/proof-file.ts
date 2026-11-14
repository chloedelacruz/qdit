/**
 * The portable inclusion-proof file, `qdit-inclusion-proof/v2`
 * (`docs/merkle/SPEC.md`, section 7).
 */

import { MAX_PROOF_LEN, MerkleTree, equal, fromHex, isU32, leafHash, toHex, verifyPath, type Hash } from "./tree.ts";

export const PROOF_FORMAT = "qdit-inclusion-proof/v2";

/** Where and when the batch root was anchored. */
export interface AnchorInfo {
  tx_hash: string;
  ledger: number;
  timestamp: number;
}

/** The JSON shape, field for field. Hex is lowercase without `0x`. */
export interface InclusionProofFile {
  format: typeof PROOF_FORMAT;
  network: string;
  contract_id: string;
  project_id: string;
  batch_id: string;
  milestone_id: string;
  /** The milestone's submission version. Part of the leaf. */
  version: number;
  proof_hash: string;
  index: number;
  leaf_count: number;
  leaf: string;
  path: string[];
  root: string;
  /** Absent when the batch was built but not anchored. */
  anchor?: AnchorInfo;
}

export interface ProofFileContext {
  network: string;
  contractId: string;
  batchId: string;
  anchor?: AnchorInfo;
}

/** One proof file per leaf of `tree`, in leaf order. */
export function proofFiles(tree: MerkleTree, ctx: ProofFileContext): InclusionProofFile[] {
  const root = toHex(tree.root);
  return tree.leaves.map((leaf, index) => {
    const file: InclusionProofFile = {
      format: PROOF_FORMAT,
      network: ctx.network,
      contract_id: ctx.contractId,
      project_id: tree.projectId,
      batch_id: ctx.batchId,
      milestone_id: leaf.milestoneId,
      version: leaf.version,
      proof_hash: toHex(leaf.proofHash),
      index,
      leaf_count: tree.leafCount,
      leaf: toHex(tree.leaf(index)),
      path: tree.proof(index).map(toHex),
      root,
    };
    if (ctx.anchor) file.anchor = ctx.anchor;
    return file;
  });
}

/** Parse and shape-check a proof file. Throws on anything malformed. */
export function parseProofFile(json: string | unknown): InclusionProofFile {
  const v = (typeof json === "string" ? JSON.parse(json) : json) as Record<string, unknown>;
  const fail = (why: string): never => {
    throw new TypeError(`not a ${PROOF_FORMAT} file: ${why}`);
  };
  if (v === null || typeof v !== "object") fail("not an object");
  if (v.format !== PROOF_FORMAT) fail(`format is ${JSON.stringify(v.format)}`);
  for (const key of ["network", "contract_id", "project_id", "batch_id", "milestone_id"] as const) {
    if (typeof v[key] !== "string") fail(`${key} is not a string`);
  }
  for (const key of ["proof_hash", "leaf", "root"] as const) {
    if (typeof v[key] !== "string") fail(`${key} is not a string`);
    fromHex(v[key] as string, 32);
  }
  if (!isU32(v.version)) fail("version is not a u32");
  for (const key of ["index", "leaf_count"] as const) {
    if (!Number.isInteger(v[key]) || (v[key] as number) < 0) fail(`${key} is not a whole number`);
  }
  if (!Array.isArray(v.path) || v.path.length > MAX_PROOF_LEN) fail("path is not a list of at most 16 hashes");
  for (const h of v.path as unknown[]) {
    if (typeof h !== "string") fail("path holds a non-string");
    fromHex(h as string, 32);
  }
  if (v.anchor !== undefined) {
    const a = v.anchor as Record<string, unknown>;
    if (typeof a.tx_hash !== "string" || !Number.isInteger(a.ledger) || !Number.isInteger(a.timestamp)) {
      fail("anchor needs tx_hash, ledger and timestamp");
    }
  }
  return v as unknown as InclusionProofFile;
}

export interface OfflineCheck {
  /** The recomputed leaf matches the file's `leaf` field. */
  leafMatches: boolean;
  /** The path leads to `root` (the file's own, unless one was passed in). */
  pathValid: boolean;
  /** The root the path was checked against. */
  root: Hash;
}

/**
 * Check a proof file without the network. With no `trustedRoot` it is checked
 * against its own `root` field, which proves only that the file is internally
 * consistent: the root still has to be read from the chain.
 */
export function checkProofFile(
  file: InclusionProofFile,
  trusted?: { root: Hash; leafCount: number },
): OfflineCheck {
  const root = trusted?.root ?? fromHex(file.root, 32);
  const leafCount = trusted?.leafCount ?? file.leaf_count;
  const leaf = leafHash(file.project_id, file.milestone_id, file.version, fromHex(file.proof_hash, 32));
  return {
    leafMatches: equal(leaf, fromHex(file.leaf, 32)),
    pathValid: verifyPath(
      root,
      leafCount,
      file.index,
      leaf,
      file.path.map((h) => fromHex(h, 32)),
    ),
    root,
  };
}
