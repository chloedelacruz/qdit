import "server-only";

import {
  Account,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";

import { NETWORK_PASSPHRASE, SOROBAN_RPC_URL, isContractId, type StellarNetwork } from "@/lib/stellar";

/**
 * doqtri's DoqtriRegistry, read back for the public milestone page (WP-3.2).
 *
 * A milestone that came from a doqtri heading records the doc version its
 * link was last written against (`milestone_external_links.doc_version`,
 * contract section 7). That number is qdit's copy; the chain is the truth
 * (D-04). So before the public page says which plan a milestone was planned
 * in, it asks DoqtriRegistry itself through a Soroban RPC simulation:
 * read-only, no signer, no fee, no token for doqtri.
 *
 * Which registry. There is one per deployment pair (contract section 1):
 * `DOQTRI_REGISTRY_CONTRACT_ID` on `DOQTRI_REGISTRY_NETWORK`, the constants
 * doqtri's side of the pair also uses. The network is doqtri's, not the qdit
 * project's: a mainnet project can be planned in a doc doqtri anchors on
 * testnet. The project's own network and contract only matter for the
 * heading's `artifact_ref`, which names the project's `milestone_proof`.
 *
 * The two registry reads, as doqtri's `contract/src/lib.rs` defines them
 * (mirrored, not imported — the two apps share nothing but the contract,
 * D-01):
 *
 *   get_document(doc_id: String) -> Result<Document, Error>
 *       Document { owner: Address, content_hash: BytesN<32>, version: u32,
 *                  node_count: u32, updated_at: u64 }
 *       Error::DocumentNotFound = 2 when nothing is anchored under the id
 *   get_node(doc_id: String, node_id: String) -> Result<NodeRecord, Error>
 *       NodeRecord { status: NodeStatus, tool: String, artifact_ref: String,
 *                    updated_at: u64 }
 *       NodeStatus is a unit enum: Planned | Building | Built | Verified
 *       Error::NodeNotFound = 3 when the heading was never signed
 *
 * `doc_id` is doqtri's `documents.id`, passed as an `ScString` (the contract
 * takes any string; doqtri's app notes use their UUID).
 *
 * And one of qdit's own, for a heading signed for this milestone (contract
 * section 12: a node signed Verified is fact 4 only together with fact 3,
 * the milestone Approved at the version the node names):
 *
 *   milestone_proof.get_milestone_status(project_id, milestone_id)
 *       -> Result<MilestoneRecord, Error>, Error::MilestoneNotFound = 3
 *
 * on the project's own contract and network, read by hand like the other two
 * so the three share one simulation path and one notion of "could not read".
 * The proof chain (WP-3.3) reads the same record for facts 2 and 3 on every
 * linked milestone of a registered project, through `checkMilestoneRecord`
 * and the same cache entry.
 *
 * What the comparison can and cannot say. The registry keeps only a
 * document's current version, and versions only go up, so a chain at or past
 * the stored version verifies it (past it: the plan was anchored again since
 * the milestone was linked, which the page says). Nothing here checks the
 * plan's content: doqtri keeps the text, only its hash is on chain.
 *
 * Every failure to get a trustworthy answer — no registry configured, the RPC
 * down or slow, a reply that does not decode — is its own state that the page
 * shows as "could not check". Nothing is ever shown as verified because a
 * read failed.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type RegistryConfig = {
  network: StellarNetwork;
  contractId: string;
  rpcUrl: string;
};

const ENV_CONTRACT = "DOQTRI_REGISTRY_CONTRACT_ID";
const ENV_NETWORK = "DOQTRI_REGISTRY_NETWORK";
const ENV_RPC = "DOQTRI_REGISTRY_RPC_URL";

const NETWORKS: readonly StellarNetwork[] = ["testnet", "mainnet"];

/**
 * This deployment's DoqtriRegistry, or null when it has none.
 *
 * An unset contract id is "not configured", quietly. A contract id that is
 * not one, a network that is missing or not `testnet`/`mainnet`, or an RPC
 * override that is not an https URL, is a typo in the config: it is logged
 * and also treated as not configured, so the page says it could not check
 * rather than reading some other contract, network or endpoint.
 */
export function registryConfig(env: Record<string, string | undefined> = process.env): RegistryConfig | null {
  const contractId = env[ENV_CONTRACT]?.trim() ?? "";
  if (contractId === "") return null;
  if (!isContractId(contractId)) {
    console.error(`doqtri registry: ${ENV_CONTRACT} is not a contract id, so it is ignored.`);
    return null;
  }

  const network = env[ENV_NETWORK]?.trim() ?? "";
  if (!NETWORKS.includes(network as StellarNetwork)) {
    console.error(`doqtri registry: ${ENV_NETWORK} must be testnet or mainnet, so the registry is not read.`);
    return null;
  }

  const override = env[ENV_RPC]?.trim() ?? "";
  if (override === "") {
    return { network: network as StellarNetwork, contractId, rpcUrl: SOROBAN_RPC_URL[network as StellarNetwork] };
  }

  let url: URL | null;
  try {
    url = new URL(override);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:") {
    console.error(`doqtri registry: ${ENV_RPC} is not an https URL, so the registry is not read.`);
    return null;
  }
  return { network: network as StellarNetwork, contractId, rpcUrl: override };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type RegistryDocument = {
  owner: string;
  /** Lowercase hex of the anchored content hash. */
  contentHash: string;
  version: number;
  nodeCount: number;
  /** Ledger time of the last write, in Unix seconds. */
  updatedAt: number;
};

export const NODE_STATUSES = ["Planned", "Building", "Built", "Verified"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export type RegistryNode = {
  status: NodeStatus;
  tool: string;
  artifactRef: string;
  updatedAt: number;
};

export type ReadFailure = "rpc" | "timeout" | "decode";

/** One read of a document and one of its nodes; null where the contract has none. */
export type RegistryRead =
  | { ok: true; document: RegistryDocument | null; node: RegistryNode | null }
  | { ok: false; reason: ReadFailure };

/** `milestone_proof`'s `MilestoneStatus`, a unit enum like `NodeStatus`. */
export const MILESTONE_STATUSES = ["Proposed", "Submitted", "Approved", "Rejected"] as const;
export type ChainMilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/** A `MilestoneRecord`, less the ids it was read by. */
export type ChainMilestone = {
  status: ChainMilestoneStatus;
  /** Submissions so far, from 1; approve and reject keep it. */
  version: number;
  /** Lowercase hex of the current submission's proof hash. */
  proofHash: string;
  /** The address that made the current submission. */
  submitter: string;
  /** Ledger time of the current submission, in Unix seconds; approve and reject keep it. */
  timestamp: number;
};

/** One `get_milestone_status` read; `record` is null for MilestoneNotFound. */
export type MilestoneRead = { ok: true; record: ChainMilestone | null } | { ok: false; reason: ReadFailure };

/** DoqtriRegistry's `Error` codes for "no such record". */
const DOCUMENT_NOT_FOUND = 2;
const NODE_NOT_FOUND = 3;
/** milestone_proof's `Error::MilestoneNotFound`. */
const MILESTONE_NOT_FOUND = 3;

/**
 * The account a read is simulated from. Simulation never checks that the
 * source exists, so the SDK's all-zero account serves, as it does for the
 * generated bindings' read calls.
 */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Each read gives up after this long, and the page says it could not check. */
export const READ_TIMEOUT_MS = 5_000;

class RegistryReadError extends Error {
  constructor(readonly reason: ReadFailure, message: string) {
    super(message);
  }
}

/** A contract error code from a failed simulation, or null for any other failure. */
function contractErrorCode(message: string): number | null {
  const match = /Error\(Contract, #(\d+)\)/.exec(message);
  return match ? Number(match[1]) : null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RegistryReadError("timeout", `no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Simulate one read-only call. Returns the return value, or null when the
 * contract answered with `notFound` — its "no such record" error. Any other
 * outcome throws a RegistryReadError.
 */
async function simulate(
  server: rpc.Server,
  target: { network: StellarNetwork; contractId: string },
  method: "get_document" | "get_node" | "get_milestone_status",
  args: xdr.ScVal[],
  notFound: number,
): Promise<xdr.ScVal | null> {
  const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE[target.network],
  })
    .addOperation(new Contract(target.contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  let sim: rpc.Api.SimulateTransactionResponse;
  try {
    sim = await withTimeout(server.simulateTransaction(tx), READ_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof RegistryReadError) throw error;
    throw new RegistryReadError("rpc", `${method}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (rpc.Api.isSimulationError(sim)) {
    if (contractErrorCode(sim.error) === notFound) return null;
    throw new RegistryReadError("rpc", `${method}: ${sim.error}`);
  }
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new RegistryReadError("decode", `${method}: the simulation returned no value`);
  }
  return sim.result.retval;
}

function record(value: unknown, method: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RegistryReadError("decode", `${method}: not a struct`);
  }
  return value as Record<string, unknown>;
}

function u32(value: unknown, method: string, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RegistryReadError("decode", `${method}: ${field} is not a u32`);
  }
  return value;
}

function u64(value: unknown, method: string, field: string): number {
  if (typeof value !== "bigint" || value < 0n) {
    throw new RegistryReadError("decode", `${method}: ${field} is not a u64`);
  }
  return Number(value);
}

function text(value: unknown, method: string, field: string): string {
  if (typeof value !== "string") throw new RegistryReadError("decode", `${method}: ${field} is not a string`);
  return value;
}

/** `Document`, from the native form `scValToNative` gives a contract struct. */
export function decodeDocument(value: xdr.ScVal): RegistryDocument {
  const doc = record(scValToNative(value), "get_document");
  const hash = doc.content_hash;
  if (!(hash instanceof Uint8Array) || hash.length !== 32) {
    throw new RegistryReadError("decode", "get_document: content_hash is not 32 bytes");
  }
  return {
    owner: text(doc.owner, "get_document", "owner"),
    contentHash: Buffer.from(hash).toString("hex"),
    version: u32(doc.version, "get_document", "version"),
    nodeCount: u32(doc.node_count, "get_document", "node_count"),
    updatedAt: u64(doc.updated_at, "get_document", "updated_at"),
  };
}

/** `NodeRecord`. A unit enum variant arrives as a one-symbol vector. */
export function decodeNode(value: xdr.ScVal): RegistryNode {
  const node = record(scValToNative(value), "get_node");
  const tag = Array.isArray(node.status) ? node.status[0] : undefined;
  if (!NODE_STATUSES.includes(tag as NodeStatus)) {
    throw new RegistryReadError("decode", "get_node: status is not a NodeStatus");
  }
  return {
    status: tag as NodeStatus,
    tool: text(node.tool, "get_node", "tool"),
    artifactRef: text(node.artifact_ref, "get_node", "artifact_ref"),
    updatedAt: u64(node.updated_at, "get_node", "updated_at"),
  };
}

/** `MilestoneRecord`, less its ids. */
export function decodeMilestone(value: xdr.ScVal): ChainMilestone {
  const fields = record(scValToNative(value), "get_milestone_status");
  const tag = Array.isArray(fields.status) ? fields.status[0] : undefined;
  if (!MILESTONE_STATUSES.includes(tag as ChainMilestoneStatus)) {
    throw new RegistryReadError("decode", "get_milestone_status: status is not a MilestoneStatus");
  }
  const hash = fields.proof_hash;
  if (!(hash instanceof Uint8Array) || hash.length !== 32) {
    throw new RegistryReadError("decode", "get_milestone_status: proof_hash is not 32 bytes");
  }
  // The ids are checked too, so a value of another shape that happens to
  // carry a status and a version is not taken for a record.
  text(fields.project_id, "get_milestone_status", "project_id");
  text(fields.milestone_id, "get_milestone_status", "milestone_id");
  return {
    status: tag as ChainMilestoneStatus,
    version: u32(fields.version, "get_milestone_status", "version"),
    proofHash: Buffer.from(hash).toString("hex"),
    submitter: text(fields.submitter, "get_milestone_status", "submitter"),
    timestamp: u64(fields.timestamp, "get_milestone_status", "timestamp"),
  };
}

/** Both reads, in parallel, on one RPC server. Never throws. */
export async function readRegistry(
  config: RegistryConfig,
  docId: string,
  nodeId: string,
): Promise<RegistryRead> {
  const server = new rpc.Server(config.rpcUrl, { timeout: READ_TIMEOUT_MS });
  const doc = nativeToScVal(docId, { type: "string" });
  const node = nativeToScVal(nodeId, { type: "string" });

  try {
    const [docValue, nodeValue] = await Promise.all([
      simulate(server, config, "get_document", [doc], DOCUMENT_NOT_FOUND),
      simulate(server, config, "get_node", [doc, node], NODE_NOT_FOUND),
    ]);
    return {
      ok: true,
      document: docValue ? decodeDocument(docValue) : null,
      node: nodeValue ? decodeNode(nodeValue) : null,
    };
  } catch (error) {
    const reason = error instanceof RegistryReadError ? error.reason : "decode";
    console.error(`doqtri registry: could not read ${docId} on ${config.network}:`, error);
    return { ok: false, reason };
  }
}

/** Where a project's `milestone_proof` lives: its own network and contract. */
export type MilestoneTarget = {
  network: StellarNetwork;
  contractId: string;
  rpcUrl: string;
};

/** `get_milestone_status(project_id, milestone_id)` on the project's contract. Never throws. */
export async function readMilestone(
  target: MilestoneTarget,
  projectId: string,
  milestoneId: string,
): Promise<MilestoneRead> {
  const server = new rpc.Server(target.rpcUrl, { timeout: READ_TIMEOUT_MS });
  try {
    const value = await simulate(
      server,
      target,
      "get_milestone_status",
      [nativeToScVal(projectId, { type: "string" }), nativeToScVal(milestoneId, { type: "string" })],
      MILESTONE_NOT_FOUND,
    );
    return { ok: true, record: value ? decodeMilestone(value) : null };
  } catch (error) {
    const reason = error instanceof RegistryReadError ? error.reason : "decode";
    console.error(`doqtri registry: could not read milestone ${milestoneId} on ${target.network}:`, error);
    return { ok: false, reason };
  }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** The doqtri reference qdit stored for a linked milestone. */
export type StoredDocSource = {
  docId: string;
  nodeId: string;
  /** DoqtriRegistry `Document.version` the link was last written against. */
  docVersion: number | null;
};

/** What the page is checking the heading's record against. */
export type DocSourceContext = {
  milestoneId: string;
  /**
   * The project's registration on `milestone_proof`, or null when it has
   * none (then nothing on chain can speak for the milestone).
   */
  project: { id: string; network: StellarNetwork; contractId: string } | null;
};

/**
 * Contract section 12's check of the plan version (fact 1):
 *
 *   verified      the document is on the registry at or past the stored
 *                 version (past it: the plan changed since, which the page
 *                 says alongside)
 *   not-anchored  the link has no version: the doc was not anchored when it
 *                 was linked, whatever the registry holds now
 *   not-found     the link has a version, the registry has no such document
 *   mismatch      the registry is behind the stored version, which a correct
 *                 link cannot produce
 *   unreachable   the read failed (RPC down, timed out, undecodable reply)
 *   unconfigured  this deployment has no registry configured
 */
export type DocSourceState =
  | "verified"
  | "not-anchored"
  | "not-found"
  | "mismatch"
  | "unreachable"
  | "unconfigured";

/** Why a heading signed for this milestone does not line up with the chain. */
export type InconsistentReason =
  /** The project is not registered on `milestone_proof`. */
  | "no-chain"
  /** The `artifact_ref` names another network than the project's. */
  | "network"
  /** The `artifact_ref` names another contract than the project's. */
  | "contract"
  /** `get_milestone_status` has no record for the milestone. */
  | "not-found"
  /** The milestone's record is at a lower version than the node names. */
  | "older";

/**
 * The heading's own on-chain record, against this milestone (contract
 * sections 10 and 12). A node linked to a qdit milestone is signed with
 * `tool = "qdit"` and an `artifact_ref` naming `P/M@vV`; what it says is
 * then read against `milestone_proof`'s current record for `M`:
 *
 *   none          never signed
 *   other         signed with another tool (for example `rollup`)
 *   elsewhere     signed with `tool = "qdit"`, but the reference does not
 *                 parse or names another project or milestone
 *   inconsistent  names this project and milestone, but on another network
 *                 or contract, or the record is missing or older than `V`
 *   unchecked     names this milestone; its record could not be read
 *   current       the record is at `V`: it speaks for the submission the
 *                 node was signed against
 *   resubmitted   the record is past `V`: the milestone was resubmitted
 *                 after the node was signed, so the signature refers to `vV`
 *
 * Only `current` with the node `Verified` and the record `Approved` is fact
 * 4 (`verifiedOnChain`). After a resubmission the record cannot attest an
 * approval at `vV`: `milestone_proof` makes an approval final (a submit
 * after one is `InvalidStatus`), so a record past `V` means `vV` was never
 * approved.
 */
export type NodeAttestation =
  | { state: "none" }
  | { state: "other"; status: NodeStatus; tool: string }
  | { state: "elsewhere"; status: NodeStatus }
  | {
      state: "inconsistent";
      status: NodeStatus;
      signedVersion: number;
      reason: InconsistentReason;
      /** The record's version for "older"; else null. */
      chainVersion: number | null;
    }
  | { state: "unchecked"; status: NodeStatus; signedVersion: number }
  | { state: "current"; status: NodeStatus; signedVersion: number; milestoneStatus: ChainMilestoneStatus }
  | {
      state: "resubmitted";
      status: NodeStatus;
      signedVersion: number;
      chainVersion: number;
      milestoneStatus: ChainMilestoneStatus;
    };

/** Fact 4: the node is signed Verified and the milestone is Approved at the version it names. */
export function verifiedOnChain(node: NodeAttestation | null): boolean {
  return node?.state === "current" && node.status === "Verified" && node.milestoneStatus === "Approved";
}

/** A node record that names this project and milestone (see `namesThisMilestone`). */
export type NodeEvidence = Extract<NodeAttestation, { state: "current" | "resubmitted" | "unchecked" | "inconsistent" }>;

/**
 * Contract section 12's node evidence: the heading's record has `tool =
 * "qdit"` and an `artifact_ref` naming this project and milestone. Only then
 * may the page show the node id, the record's status and `@vV`. Not for
 * `inconsistent` with `no-chain`: without a registration the project id was
 * never compared, so the record is known to name the milestone only.
 * `none`, `other` and `elsewhere` are not signed for this milestone, and a
 * null node (the registry was not read) is no evidence either.
 */
export function namesThisMilestone(node: NodeAttestation | null): node is NodeEvidence {
  switch (node?.state) {
    case "current":
    case "resubmitted":
    case "unchecked":
      return true;
    case "inconsistent":
      return node.reason !== "no-chain";
    default:
      return false;
  }
}

/**
 * The block's one verdict on "Planned in doqtri" (contract section 12):
 *
 *   verified      the node evidence holds, its record lines up with this
 *                 milestone's, and the doc is anchored at or past the linked
 *                 version
 *   unsigned      no record names this project and milestone (the link row
 *                 alone, which anyone with the role may write, is no proof)
 *   no-chain      a record names the milestone, but the project is not on
 *                 chain, so it cannot be checked against the project
 *   inconsistent  a record names this project and milestone, but on another
 *                 network or contract, or the milestone's record is missing
 *                 or older than the version it names
 *   doc           the node evidence holds; the doc anchor does not
 *   unchecked     the node evidence holds, but the milestone's record could
 *                 not be read, so whether it lines up is unknown: a read
 *                 failure, never a pass
 *   unreachable   the registry could not be read
 *   unconfigured  this deployment has no registry
 *
 * The node and doc checks are separate lines on the page; this is only
 * whether both hold, and the first reason they do not.
 */
export type PlannedVerdict =
  | "verified"
  | "unsigned"
  | "no-chain"
  | "inconsistent"
  | "doc"
  | "unchecked"
  | "unreachable"
  | "unconfigured";

/** `PlannedVerdict` for a check. Pure. */
export function plannedVerdict(check: DocSourceCheck): PlannedVerdict {
  if (check.state === "unconfigured" || check.state === "unreachable") return check.state;
  const node = check.node;
  if (node?.state === "inconsistent" && node.reason === "no-chain") return "no-chain";
  if (!namesThisMilestone(node)) return "unsigned";
  if (node.state === "inconsistent") return "inconsistent";
  if (check.state !== "verified") return "doc";
  return node.state === "unchecked" ? "unchecked" : "verified";
}

export type DocSourceCheck = {
  state: DocSourceState;
  /** The registry's network; null when none is configured. */
  network: StellarNetwork | null;
  /** The registry contract that was read; null when none is configured. */
  registryId: string | null;
  /** The registry's current `Document.version`, when it was read and exists. */
  chainVersion: number | null;
  /** The document's `updated_at` (ledger time, Unix seconds), when it was read and exists. */
  docUpdatedAt: number | null;
  /** Null when the registry was not read. */
  node: NodeAttestation | null;
  /** The heading's record's `updated_at` (ledger time, Unix seconds), when it was read and exists. */
  nodeUpdatedAt: number | null;
};

/** Contract section 10's `artifact-ref`, split into its parts. */
const ARTIFACT_REF =
  /^qdit:(testnet|mainnet):(C[A-Z2-7]{55}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@v([1-9][0-9]{0,9})$/;

export type QditArtifactRef = {
  network: StellarNetwork;
  contractId: string;
  projectId: string;
  milestoneId: string;
  version: number;
};

/** Parse a `qdit:` artifact reference, or null when it is not one. */
export function parseQditArtifactRef(ref: string): QditArtifactRef | null {
  const match = ARTIFACT_REF.exec(ref);
  if (!match) return null;
  const version = Number(match[5]);
  if (version > 0xffffffff) return null;
  return {
    network: match[1] as StellarNetwork,
    contractId: match[2],
    projectId: match[3],
    milestoneId: match[4],
    version,
  };
}

/**
 * The milestone record a node's reference calls for, or null when none is
 * needed: the node is not signed for this project's milestone, or what it
 * names cannot be this project's record (no registration, another network
 * or contract) and is inconsistent without a read.
 */
export function milestoneToRead(
  node: RegistryNode | null,
  context: DocSourceContext,
): { network: StellarNetwork; contractId: string; projectId: string; milestoneId: string } | null {
  const ref = signedFor(node, context);
  const project = context.project;
  if (!ref || !project || ref.network !== project.network || ref.contractId !== project.contractId) return null;
  return {
    network: project.network,
    contractId: project.contractId,
    projectId: project.id,
    milestoneId: ref.milestoneId,
  };
}

/**
 * The reference, when the node is signed `tool = "qdit"` for this project
 * and milestone. Without a registration the project id is not public, so
 * only the milestone id is compared, and the node ends up inconsistent
 * ("no-chain") either way.
 */
function signedFor(node: RegistryNode | null, context: DocSourceContext): QditArtifactRef | null {
  if (!node || node.tool !== "qdit") return null;
  const ref = parseQditArtifactRef(node.artifactRef);
  if (!ref || ref.milestoneId !== context.milestoneId) return null;
  if (context.project && ref.projectId !== context.project.id) return null;
  return ref;
}

/**
 * What the heading's record says about this milestone. `milestone` is the
 * read `milestoneToRead()` asked for, or null when it asked for none. Pure.
 */
export function nodeAttestation(
  node: RegistryNode | null,
  context: DocSourceContext,
  milestone: MilestoneRead | null,
): NodeAttestation {
  if (!node) return { state: "none" };
  if (node.tool !== "qdit") return { state: "other", status: node.status, tool: node.tool };

  const ref = signedFor(node, context);
  if (!ref) return { state: "elsewhere", status: node.status };

  const signed = { status: node.status, signedVersion: ref.version };
  const inconsistent = (reason: InconsistentReason, chainVersion: number | null = null): NodeAttestation => ({
    state: "inconsistent",
    ...signed,
    reason,
    chainVersion,
  });

  const project = context.project;
  if (!project) return inconsistent("no-chain");
  if (ref.network !== project.network) return inconsistent("network");
  if (ref.contractId !== project.contractId) return inconsistent("contract");

  if (!milestone || !milestone.ok) return { state: "unchecked", ...signed };
  const record = milestone.record;
  if (!record) return inconsistent("not-found");
  if (record.version < ref.version) return inconsistent("older", record.version);
  if (record.version === ref.version) return { state: "current", ...signed, milestoneStatus: record.status };
  return { state: "resubmitted", ...signed, chainVersion: record.version, milestoneStatus: record.status };
}

/** Contract section 12's verdict on the plan version, from the registry's answer. Pure. */
export function docVerdict(stored: StoredDocSource, chainVersion: number | null): DocSourceState {
  if (stored.docVersion === null) return "not-anchored";
  if (chainVersion === null) return "not-found";
  return chainVersion >= stored.docVersion ? "verified" : "mismatch";
}

/** Compare the reads with the stored reference. Pure. */
export function compareDocSource(
  stored: StoredDocSource,
  read: RegistryRead,
  context: DocSourceContext,
  config: Pick<RegistryConfig, "network" | "contractId">,
  milestone: MilestoneRead | null = null,
): DocSourceCheck {
  const base = { network: config.network, registryId: config.contractId };
  if (!read.ok) {
    return { ...base, state: "unreachable", chainVersion: null, docUpdatedAt: null, node: null, nodeUpdatedAt: null };
  }

  const chainVersion = read.document?.version ?? null;
  return {
    ...base,
    state: docVerdict(stored, chainVersion),
    chainVersion,
    docUpdatedAt: read.document?.updatedAt ?? null,
    node: nodeAttestation(read.node, context, milestone),
    nodeUpdatedAt: read.node?.updatedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// The cached check the page calls
// ---------------------------------------------------------------------------

/** How long a read that got an answer is reused. */
export const CACHE_TTL_MS = 30_000;
/** How long a failed read is reused, so a reload storm does not hammer a down RPC. */
export const FAILURE_TTL_MS = 5_000;
const CACHE_LIMIT = 500;

type Cached = { at: number; read: RegistryRead | MilestoneRead };
const cache = new Map<string, Cached>();
/** Reads still on the wire, so two callers asking for one record send one request. */
const inflight = new Map<string, Promise<RegistryRead | MilestoneRead>>();

/** Empties the read cache. For tests. */
export function clearRegistryCache(): void {
  cache.clear();
  inflight.clear();
}

/** A read through the cache: CACHE_TTL_MS for an answer, FAILURE_TTL_MS for a failure. */
async function cached<T extends RegistryRead | MilestoneRead>(
  key: string,
  now: number,
  read: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && now - hit.at < (hit.read.ok ? CACHE_TTL_MS : FAILURE_TTL_MS)) return hit.read as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const request = read().then((fresh) => {
    inflight.delete(key);
    cache.delete(key);
    cache.set(key, { at: now, read: fresh });
    // Oldest first, by insertion order.
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    return fresh;
  });
  inflight.set(key, request);
  return request;
}

/** A project's `get_milestone_status(project_id, milestone_id)`, through the cache. */
function cachedMilestone(
  project: { id: string; network: StellarNetwork; contractId: string },
  milestoneId: string,
  now: number,
): Promise<MilestoneRead> {
  return cached(
    ["milestone", project.network, project.contractId, project.id, milestoneId].join("|"),
    now,
    () =>
      readMilestone(
        { network: project.network, contractId: project.contractId, rpcUrl: SOROBAN_RPC_URL[project.network] },
        project.id,
        milestoneId,
      ),
  );
}

/**
 * The milestone's current record on its project's `milestone_proof`, for the
 * public page's proof chain (WP-3.3, facts 2 and 3). Cached like the
 * registry reads, under the same key as the one `checkDocSource` makes for a
 * heading signed for this milestone, so a page that asks for both sends one
 * request. Never throws.
 */
export function checkMilestoneRecord(
  project: { id: string; network: StellarNetwork; contractId: string },
  milestoneId: string,
  options: { now?: () => number } = {},
): Promise<MilestoneRead> {
  return cachedMilestone(project, milestoneId, (options.now ?? Date.now)());
}

/**
 * Check a linked milestone's doc reference against this deployment's
 * DoqtriRegistry, and the heading's record against the project's
 * `milestone_proof` when it names this milestone. Each read is cached per
 * record for CACHE_TTL_MS (FAILURE_TTL_MS for a failed one), server side, in
 * memory: a public page can be reloaded by anyone, and the answer it shows is
 * a few seconds old at most.
 */
export async function checkDocSource(
  stored: StoredDocSource,
  context: DocSourceContext,
  options: { now?: () => number; env?: Record<string, string | undefined> } = {},
): Promise<DocSourceCheck> {
  const config = registryConfig(options.env);
  if (!config) {
    return {
      state: "unconfigured",
      network: null,
      registryId: null,
      chainVersion: null,
      docUpdatedAt: null,
      node: null,
      nodeUpdatedAt: null,
    };
  }

  const now = (options.now ?? Date.now)();
  const read = await cached(
    ["registry", config.network, config.contractId, config.rpcUrl, stored.docId, stored.nodeId].join("|"),
    now,
    () => readRegistry(config, stored.docId, stored.nodeId),
  );

  const wanted = read.ok ? milestoneToRead(read.node, context) : null;
  const milestone = wanted
    ? await cachedMilestone(
        { id: wanted.projectId, network: wanted.network, contractId: wanted.contractId },
        wanted.milestoneId,
        now,
      )
    : null;

  return compareDocSource(stored, read, context, config, milestone);
}
