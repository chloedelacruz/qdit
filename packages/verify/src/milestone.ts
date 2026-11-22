// verifyMilestone: is this v2 milestone approved on chain, at the expected
// proof hash and version?

import { fromHex, isU32, toHex } from "@qdit/merkle";
import { ChainReader, NETWORK, VerifyError, addressString, sc, type ChainOptions } from "./chain.ts";

export type MilestoneStatus = "Proposed" | "Submitted" | "Approved" | "Rejected";

export interface VerifyMilestoneInput {
  contractId: string;
  projectId: string;
  milestoneId: string;
  /** What the caller expects the chain to hold. Each field is checked when given. */
  expected?: {
    /** 32 bytes, as lowercase or uppercase hex (an optional `0x` is allowed) or raw bytes. */
    proofHash?: string | Uint8Array;
    version?: number;
  };
}

export interface MilestoneVerification {
  /** Approved on chain, and every `expected` field matches. */
  ok: boolean;
  network: typeof NETWORK;
  contractId: string;
  projectId: string;
  milestoneId: string;
  /** `null` when the project or milestone isn't on chain. */
  status: MilestoneStatus | null;
  version: number | null;
  /** Lowercase hex. */
  proofHash: string | null;
  submitter: string | null;
  /** Ledger time of this version's submission, in Unix seconds. */
  submittedAt: number | null;
  /** Addresses that approved this version, in order. */
  approvers: string[];
  /**
   * The project's threshold now. The contract checks it when each approval
   * lands, so a milestone approved before the threshold was raised stays
   * approved with fewer approvers than this.
   */
  threshold: number | null;
  /**
   * The project's owner now. The owner picks every approver, and anyone can
   * register an unused project id, so check this is the owner you expect:
   * "approved by M approvers" means M addresses the owner chose.
   */
  owner: string | null;
  /** Why `ok` is false. Empty when it is true. */
  reasons: string[];
}

const STATUSES: readonly MilestoneStatus[] = ["Proposed", "Submitted", "Approved", "Rejected"];

/**
 * Read a milestone and its project from the v2 contract and check that the
 * milestone is approved. Throws {@link VerifyError} only when the check can't
 * be made (bad input, wrong network or contract, RPC failure).
 */
export async function verifyMilestone(
  input: VerifyMilestoneInput,
  options: ChainOptions = {},
): Promise<MilestoneVerification> {
  const { contractId, projectId, milestoneId, expected } = input;
  for (const [name, v] of [
    ["projectId", projectId],
    ["milestoneId", milestoneId],
  ] as const) {
    if (typeof v !== "string" || v.length === 0) {
      throw new VerifyError("BAD_INPUT", `${name} must be a non-empty string`);
    }
  }
  const expectedHash = expected?.proofHash === undefined ? undefined : hashHex(expected.proofHash);
  if (expected?.version !== undefined && !isU32(expected.version)) {
    throw new VerifyError("BAD_INPUT", `expected.version must be a u32, got ${expected.version}`);
  }

  const chain = new ChainReader(contractId, options);
  const result: MilestoneVerification = {
    ok: false,
    network: NETWORK,
    contractId: chain.contractId,
    projectId,
    milestoneId,
    status: null,
    version: null,
    proofHash: null,
    submitter: null,
    submittedAt: null,
    approvers: [],
    threshold: null,
    owner: null,
    reasons: [],
  };

  const [project, milestone] = await Promise.all([
    chain.read("get_project", [sc.string(projectId)]),
    chain.read("get_milestone_status", [sc.string(projectId), sc.string(milestoneId)]),
  ]);

  if (!project.ok) {
    result.reasons.push(`project ${JSON.stringify(projectId)}: ${project.error}`);
    return result;
  }
  result.threshold = Number((project.value as { threshold: unknown }).threshold);
  result.owner = addressString((project.value as { owner: unknown }).owner);

  if (!milestone.ok) {
    result.reasons.push(`milestone ${JSON.stringify(milestoneId)}: ${milestone.error}`);
    return result;
  }
  const record = milestone.value as {
    approvers: unknown[];
    proof_hash: Uint8Array;
    status: unknown;
    submitter: unknown;
    timestamp: bigint | number;
    version: number;
  };
  result.status = statusName(record.status);
  result.version = Number(record.version);
  result.proofHash = toHex(new Uint8Array(record.proof_hash));
  result.submitter = addressString(record.submitter);
  result.submittedAt = Number(record.timestamp);
  result.approvers = record.approvers.map(addressString);

  if (result.status !== "Approved") {
    const tally =
      result.status === "Submitted" ? ` (${result.approvers.length} of ${result.threshold} approvals)` : "";
    result.reasons.push(`status is ${result.status}, not Approved${tally}`);
  } else if (result.approvers.length === 0) {
    result.reasons.push("status is Approved but no approver is recorded");
  }
  if (expectedHash !== undefined && expectedHash !== result.proofHash) {
    result.reasons.push(`proof hash on chain is ${result.proofHash}, expected ${expectedHash}`);
  }
  if (expected?.version !== undefined && expected.version !== result.version) {
    result.reasons.push(`version on chain is ${result.version}, expected ${expected.version}`);
  }

  result.ok = result.reasons.length === 0;
  return result;
}

/** A contract enum's variant name. The decoder gives unit variants as `["Name"]`. */
function statusName(v: unknown): MilestoneStatus {
  const name = Array.isArray(v) ? v[0] : (v as { tag?: unknown })?.tag ?? v;
  if (typeof name === "string" && (STATUSES as readonly string[]).includes(name)) {
    return name as MilestoneStatus;
  }
  throw new VerifyError("RPC", `unexpected milestone status ${JSON.stringify(v)}`);
}

function hashHex(h: string | Uint8Array): string {
  try {
    if (typeof h === "string") return toHex(fromHex(h, 32));
    if (h instanceof Uint8Array && h.length === 32) return toHex(h);
  } catch {
    // fall through
  }
  throw new VerifyError("BAD_INPUT", "expected.proofHash must be 32 bytes, as hex or bytes");
}
