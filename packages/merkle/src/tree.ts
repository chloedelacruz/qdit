/**
 * The qdit Merkle batch scheme, version 1: `docs/merkle/SPEC.md`.
 *
 * Byte-for-byte the same as `milestone_proof_v2` (`anchor_batch`,
 * `verify_inclusion`). Both are tested against `docs/merkle/vectors.json`.
 */

import { createHash } from "node:crypto";

/** The domain tag, ASCII `qdit/merkle/v1`. A new scheme version gets a new tag. */
export const TAG: Uint8Array = new TextEncoder().encode("qdit/merkle/v1");

/** Most leaves a batch may hold, the contract's `MAX_BATCH_LEAVES`. */
export const MAX_BATCH_LEAVES = 65_536;

/** Longest inclusion proof, `log2(MAX_BATCH_LEAVES)`. */
export const MAX_PROOF_LEN = 16;

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

/** A 32-byte SHA-256 digest. */
export type Hash = Uint8Array;

/** One milestone in a batch. */
export interface Leaf {
  milestoneId: string;
  /** The milestone's existing 32-byte proof hash. */
  proofHash: Hash;
}

const encoder = new TextEncoder();

function sha256(parts: readonly Uint8Array[]): Hash {
  const h = createHash("sha256");
  for (const part of parts) h.update(part);
  return new Uint8Array(h.digest());
}

/** `u32be(UTF-8 byte length) || UTF-8 bytes`. */
function str(s: string): Uint8Array {
  const bytes = encoder.encode(s);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, false);
  out.set(bytes, 4);
  return out;
}

function check32(name: string, h: Uint8Array): void {
  if (!(h instanceof Uint8Array) || h.length !== 32) {
    throw new TypeError(`${name} must be 32 bytes, got ${h?.length ?? typeof h}`);
  }
}

/** `H(0x00 || TAG || str(projectId) || str(milestoneId) || proofHash)`. */
export function leafHash(projectId: string, milestoneId: string, proofHash: Hash): Hash {
  check32("proofHash", proofHash);
  return sha256([Uint8Array.of(LEAF_PREFIX), TAG, str(projectId), str(milestoneId), proofHash]);
}

/** `H(0x01 || TAG || left || right)`. */
export function nodeHash(left: Hash, right: Hash): Hash {
  check32("left", left);
  check32("right", right);
  return sha256([Uint8Array.of(NODE_PREFIX), TAG, left, right]);
}

/** A built tree. Every level is kept, so a proof for any leaf is a lookup. */
export class MerkleTree {
  readonly projectId: string;
  readonly leaves: readonly Leaf[];
  /** `levels[0]` is the leaf hashes, the last level is `[root]`. */
  readonly levels: readonly (readonly Hash[])[];

  private constructor(projectId: string, leaves: readonly Leaf[], levels: Hash[][]) {
    this.projectId = projectId;
    this.leaves = leaves;
    this.levels = levels;
  }

  /**
   * Build the tree over `leaves`, in the order given. Refuses an empty batch,
   * more than {@link MAX_BATCH_LEAVES} leaves and a repeated milestone id.
   */
  static build(projectId: string, leaves: readonly Leaf[]): MerkleTree {
    if (leaves.length === 0) throw new RangeError("a batch needs at least one leaf");
    if (leaves.length > MAX_BATCH_LEAVES) {
      throw new RangeError(`a batch holds at most ${MAX_BATCH_LEAVES} leaves, got ${leaves.length}`);
    }
    const seen = new Set<string>();
    for (const leaf of leaves) {
      if (seen.has(leaf.milestoneId)) {
        throw new Error(`milestone ${JSON.stringify(leaf.milestoneId)} appears twice in the batch`);
      }
      seen.add(leaf.milestoneId);
    }

    let level = leaves.map((l) => leafHash(projectId, l.milestoneId, l.proofHash));
    const levels: Hash[][] = [level];
    while (level.length > 1) {
      const next: Hash[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i]!;
        const right = level[i + 1];
        // A lone last node is promoted unchanged, never paired with itself.
        next.push(right === undefined ? left : nodeHash(left, right));
      }
      levels.push(next);
      level = next;
    }
    return new MerkleTree(projectId, [...leaves], levels);
  }

  get root(): Hash {
    return this.levels[this.levels.length - 1]![0]!;
  }

  get leafCount(): number {
    return this.leaves.length;
  }

  /** The leaf hash at `index`. */
  leaf(index: number): Hash {
    this.checkIndex(index);
    return this.levels[0]![index]!;
  }

  /** Sibling hashes from leaf `index` up to the root, leaf level first. */
  proof(index: number): Hash[] {
    this.checkIndex(index);
    const path: Hash[] = [];
    let i = index;
    for (const level of this.levels.slice(0, -1)) {
      const sibling = level[i % 2 === 1 ? i - 1 : i + 1];
      if (sibling !== undefined) path.push(sibling);
      i = Math.floor(i / 2);
    }
    return path;
  }

  /** The index of `milestoneId`, or -1. */
  indexOf(milestoneId: string): number {
    return this.leaves.findIndex((l) => l.milestoneId === milestoneId);
  }

  private checkIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.leaves.length) {
      throw new RangeError(`leaf index ${index} is outside 0..${this.leaves.length - 1}`);
    }
  }
}

/** The leaf-level arguments of {@link verifyInclusion}. */
export interface InclusionClaim {
  projectId: string;
  milestoneId: string;
  proofHash: Hash;
  index: number;
  path: readonly Hash[];
}

/**
 * Whether `path` leads from `leaf`, at `index`, to `root` in a tree of
 * `leafCount` leaves. Sides come from `index` and `leafCount`, never from the
 * proof. Malformed input is `false`, as in the contract.
 */
export function verifyPath(
  root: Hash,
  leafCount: number,
  index: number,
  leaf: Hash,
  path: readonly Hash[],
): boolean {
  if (
    !Number.isInteger(leafCount) ||
    !Number.isInteger(index) ||
    leafCount < 1 ||
    leafCount > MAX_BATCH_LEAVES ||
    index < 0 ||
    index >= leafCount ||
    path.length > MAX_PROOF_LEN ||
    root.length !== 32 ||
    leaf.length !== 32 ||
    path.some((h) => h.length !== 32)
  ) {
    return false;
  }

  let h = leaf;
  let i = index;
  let size = leafCount;
  let p = 0;
  while (size > 1) {
    if (i % 2 === 1) {
      const sibling = path[p++];
      if (sibling === undefined) return false;
      h = nodeHash(sibling, h);
    } else if (i + 1 < size) {
      const sibling = path[p++];
      if (sibling === undefined) return false;
      h = nodeHash(h, sibling);
    }
    i = Math.floor(i / 2);
    size = Math.ceil(size / 2);
  }
  return p === path.length && equal(h, root);
}

/**
 * The off-chain twin of the contract's `verify_inclusion`: rebuild the leaf
 * from the claim and check it against `root`. `root` and `leafCount` MUST come
 * from the chain (`get_batch`), not from the proof file being checked.
 */
export function verifyInclusion(root: Hash, leafCount: number, claim: InclusionClaim): boolean {
  if (claim.proofHash.length !== 32) return false;
  const leaf = leafHash(claim.projectId, claim.milestoneId, claim.proofHash);
  return verifyPath(root, leafCount, claim.index, leaf, claim.path);
}

/** Constant-shape byte comparison. */
export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Lowercase hex, no `0x`. */
export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");
}

/** Parse hex, with or without `0x`. With `length`, the byte count must match. */
export function fromHex(hex: string, length?: number): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new TypeError(`not hex: ${JSON.stringify(hex)}`);
  }
  const out = new Uint8Array(Buffer.from(clean, "hex"));
  if (length !== undefined && out.length !== length) {
    throw new TypeError(`expected ${length} bytes of hex, got ${out.length}`);
  }
  return out;
}

