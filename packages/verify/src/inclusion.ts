// verifyInclusion: does a qdit-inclusion-proof/v2 file prove its milestone is
// in an anchored batch? Offline it checks the file against itself; on chain it
// checks the path against the root a known qdit contract stored, never the
// file's.

import {
  MAX_ID_BYTES,
  checkProofFile,
  equal,
  fromHex,
  isU32,
  parseProofFile,
  toHex,
  type InclusionProofFile,
} from "@qdit/merkle";
import { ChainReader, NETWORK, VerifyError, addressString, sc, type ChainOptions } from "./chain.ts";

export interface VerifyInclusionOptions extends ChainOptions {
  /**
   * Also read the batch from the contract, check the path against its stored
   * root and leaf count, and ask the contract's own `verify_inclusion`.
   * Without it, `ok` means only that the file is internally consistent and
   * `rootConfirmed` is false.
   */
  onChain?: boolean;
}

/** The batch as the contract stored it. */
export interface AnchoredBatch {
  /** Lowercase hex. */
  root: string;
  leafCount: number;
  submitter: string;
  ledger: number;
  /** Unix seconds. */
  timestamp: number;
  /** What the contract's `verify_inclusion` returned for this file. */
  contractSays: boolean;
}

/**
 * The milestone's own record on chain, when there is one. A batch can anchor a
 * milestone that was never submitted on its own, so a missing record is not a
 * failure. When there is one, the file's version must have been submitted, and
 * at the current version its proof hash must be the submitted one.
 */
export type SubmissionCheck =
  | { recorded: false }
  | { recorded: true; status: string; version: number; proofHash: string };

export interface InclusionVerification {
  /**
   * Offline: the leaf matches the file's milestone fields and the path leads
   * to the file's root. On chain: the path leads to the stored root, the
   * contract agrees, the file's root, leaf count and anchor match the chain,
   * and the file doesn't contradict the milestone's own record.
   */
  ok: boolean;
  /** Whether the chain was consulted. */
  onChain: boolean;
  /**
   * The root was read from a known qdit contract. False offline: a forged
   * file that agrees with itself also passes an offline check.
   */
  rootConfirmed: boolean;
  network: typeof NETWORK;
  contractId: string;
  projectId: string;
  batchId: string;
  milestoneId: string;
  version: number;
  /** Lowercase hex. */
  proofHash: string;
  /** The recomputed leaf equals the file's `leaf`. */
  leafMatches: boolean;
  /** The path leads to {@link root}. */
  pathValid: boolean;
  /** The root the path was checked against: the stored one on chain, else the file's. */
  root: string;
  /** Present when `onChain` is set and the batch exists. */
  batch?: AnchoredBatch;
  /** Present when `onChain` is set and the batch exists. */
  submission?: SubmissionCheck;
  /** Why `ok` is false. Empty when it is true. */
  reasons: string[];
}

/**
 * Check an inclusion-proof file (its JSON text, the parsed object, or an
 * {@link InclusionProofFile}). Throws {@link VerifyError} only when the check
 * can't be made: a malformed file, a network other than testnet, a contract
 * that isn't a known qdit deployment, or an RPC failure.
 */
export async function verifyInclusion(
  proofFile: string | unknown,
  options: VerifyInclusionOptions = {},
): Promise<InclusionVerification> {
  let file: InclusionProofFile;
  try {
    file = parseProofFile(proofFile);
  } catch (cause) {
    throw new VerifyError("BAD_INPUT", cause instanceof Error ? cause.message : String(cause), { cause });
  }
  if (!isU32(file.index) || !isU32(file.leaf_count)) {
    throw new VerifyError("BAD_INPUT", "index and leaf_count must fit a u32");
  }
  for (const [name, id] of [
    ["project_id", file.project_id],
    ["batch_id", file.batch_id],
    ["milestone_id", file.milestone_id],
  ] as const) {
    if (Buffer.byteLength(id, "utf8") > MAX_ID_BYTES) {
      throw new VerifyError("BAD_INPUT", `${name} is over ${MAX_ID_BYTES} bytes, which the contract never accepts`);
    }
  }
  if (file.network !== NETWORK) {
    throw new VerifyError(
      "WRONG_NETWORK",
      `the proof is for ${JSON.stringify(file.network)}; @qdit/verify v0.1 checks Stellar testnet only`,
    );
  }

  const offline = checkProofFile(file);
  const result: InclusionVerification = {
    ok: false,
    onChain: options.onChain === true,
    rootConfirmed: false,
    network: NETWORK,
    contractId: file.contract_id,
    projectId: file.project_id,
    batchId: file.batch_id,
    milestoneId: file.milestone_id,
    version: file.version,
    proofHash: file.proof_hash.toLowerCase(),
    leafMatches: offline.leafMatches,
    pathValid: offline.pathValid,
    root: toHex(offline.root),
    reasons: [],
  };
  if (!offline.leafMatches) {
    result.reasons.push("leaf does not match the file's project, milestone, version and proof hash");
  }

  if (!result.onChain) {
    if (!offline.pathValid) result.reasons.push("path does not lead to the file's root");
    result.ok = result.reasons.length === 0;
    return result;
  }

  // Refuses any contract id that isn't a known qdit deployment, before a read.
  const chain = new ChainReader(file.contract_id, options);
  const stored = await chain.read("get_batch", [sc.string(file.project_id), sc.string(file.batch_id)]);
  if (!stored.ok) {
    result.pathValid = false;
    result.reasons.push(`batch ${JSON.stringify(file.batch_id)}: ${stored.error}`);
    return result;
  }
  const record = stored.value as {
    root?: unknown;
    leaf_count?: unknown;
    submitter?: unknown;
    ledger?: unknown;
    timestamp?: unknown;
  };
  if (!(record?.root instanceof Uint8Array) || record.root.length !== 32 || !isU32(Number(record.leaf_count))) {
    throw new VerifyError("RPC", "get_batch returned something that isn't a batch record");
  }
  const root = new Uint8Array(record.root);
  const leafCount = Number(record.leaf_count);

  // The path is checked against the stored root and leaf count only.
  const onChainCheck = checkProofFile(file, { root, leafCount });
  result.pathValid = onChainCheck.pathValid;
  result.root = toHex(root);
  result.rootConfirmed = true;

  const [says, milestone] = await Promise.all([
    chain.read("verify_inclusion", [
      sc.string(file.project_id),
      sc.string(file.batch_id),
      sc.string(file.milestone_id),
      sc.u32(file.version),
      sc.bytes(fromHex(file.proof_hash, 32)),
      sc.u32(file.index),
      sc.vec(file.path.map((h) => sc.bytes(fromHex(h, 32)))),
    ]),
    chain.read("get_milestone_status", [sc.string(file.project_id), sc.string(file.milestone_id)]),
  ]);

  result.batch = {
    root: result.root,
    leafCount,
    submitter: addressString(record.submitter),
    ledger: Number(record.ledger),
    timestamp: Number(record.timestamp),
    contractSays: says.ok && says.value === true,
  };

  if (!onChainCheck.pathValid) result.reasons.push("path does not lead to the root stored on chain");
  if (!says.ok) result.reasons.push(`the contract's verify_inclusion refused the proof: ${says.error}`);
  else if (says.value !== true) result.reasons.push("the contract's verify_inclusion returned false");
  if (!equal(fromHex(file.root, 32), root)) {
    result.reasons.push(`file's root ${file.root} differs from the stored root ${result.root}`);
  }
  if (file.leaf_count !== leafCount) {
    result.reasons.push(`file's leaf_count ${file.leaf_count} differs from the stored ${leafCount}`);
  }
  if (file.anchor && file.anchor.ledger !== result.batch.ledger) {
    result.reasons.push(`file's anchor ledger ${file.anchor.ledger} differs from the stored ${result.batch.ledger}`);
  }
  if (file.anchor && file.anchor.timestamp !== result.batch.timestamp) {
    result.reasons.push(
      `file's anchor timestamp ${file.anchor.timestamp} differs from the stored ${result.batch.timestamp}`,
    );
  }

  if (milestone.ok) {
    const m = milestone.value as { status: unknown; version: unknown; proof_hash: Uint8Array };
    const submission: SubmissionCheck = {
      recorded: true,
      status: String(Array.isArray(m.status) ? m.status[0] : m.status),
      version: Number(m.version),
      proofHash: toHex(new Uint8Array(m.proof_hash)),
    };
    result.submission = submission;
    if (file.version > submission.version) {
      result.reasons.push(
        `version ${file.version} was never submitted: the milestone's record is at version ${submission.version}`,
      );
    } else if (file.version === submission.version && result.proofHash !== submission.proofHash) {
      result.reasons.push(
        `proof hash differs from the one submitted at version ${submission.version} (${submission.proofHash})`,
      );
    }
  } else if (milestone.code === 3) {
    result.submission = { recorded: false };
  } else {
    result.reasons.push(`milestone ${JSON.stringify(file.milestone_id)}: ${milestone.error}`);
  }

  result.ok = result.reasons.length === 0;
  return result;
}
