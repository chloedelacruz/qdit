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
 * in, it asks DoqtriRegistry itself, on the project's network, through a
 * Soroban RPC simulation: read-only, no signer, no fee, no token for doqtri.
 *
 * The two reads, as doqtri's `contract/src/lib.rs` defines them (mirrored, not
 * imported — the two apps share nothing but the contract, D-01):
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
 * What the comparison can and cannot say. The registry keeps only a
 * document's current version, and versions only go up, so "the chain is at
 * the stored version" is a match and "the chain is past it" means the plan
 * was anchored again since the milestone was linked. Nothing here checks the
 * plan's content: doqtri keeps the text, only its hash is on chain.
 *
 * Every failure to get a trustworthy answer — no registry configured for the
 * network, the RPC down or slow, a reply that does not decode — is its own
 * state that the page shows as "could not check". Nothing is ever shown as
 * verified because a read failed.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type RegistryConfig = {
  network: StellarNetwork;
  contractId: string;
  rpcUrl: string;
};

const ENV_CONTRACT: Record<StellarNetwork, string> = {
  testnet: "DOQTRI_REGISTRY_CONTRACT_ID_TESTNET",
  mainnet: "DOQTRI_REGISTRY_CONTRACT_ID_MAINNET",
};

const ENV_RPC: Record<StellarNetwork, string> = {
  testnet: "DOQTRI_REGISTRY_RPC_URL_TESTNET",
  mainnet: "DOQTRI_REGISTRY_RPC_URL_MAINNET",
};

/**
 * The registry on `network`, or null when this deployment has none.
 *
 * Unset is "not configured", quietly. A value that is not a contract id, or
 * an RPC override that is not an https URL, is a typo in the config: it is
 * logged and also treated as not configured, so the page says it could not
 * check rather than reading some other contract or endpoint.
 */
export function registryConfig(
  network: StellarNetwork,
  env: Record<string, string | undefined> = process.env,
): RegistryConfig | null {
  const contractId = env[ENV_CONTRACT[network]]?.trim() ?? "";
  if (contractId === "") return null;
  if (!isContractId(contractId)) {
    console.error(`doqtri registry: ${ENV_CONTRACT[network]} is not a contract id, so it is ignored.`);
    return null;
  }

  const override = env[ENV_RPC[network]]?.trim() ?? "";
  if (override === "") return { network, contractId, rpcUrl: SOROBAN_RPC_URL[network] };

  let url: URL | null;
  try {
    url = new URL(override);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:") {
    console.error(`doqtri registry: ${ENV_RPC[network]} is not an https URL, so the registry is not read.`);
    return null;
  }
  return { network, contractId, rpcUrl: override };
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

/** One read of a document and one of its nodes; null where the contract has none. */
export type RegistryRead =
  | { ok: true; document: RegistryDocument | null; node: RegistryNode | null }
  | { ok: false; reason: "rpc" | "timeout" | "decode" };

/** DoqtriRegistry's `Error` codes for "no such record". */
const DOCUMENT_NOT_FOUND = 2;
const NODE_NOT_FOUND = 3;

/**
 * The account a read is simulated from. Simulation never checks that the
 * source exists, so the SDK's all-zero account serves, as it does for the
 * generated bindings' read calls.
 */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Each read gives up after this long, and the page says it could not check. */
export const READ_TIMEOUT_MS = 5_000;

class RegistryReadError extends Error {
  constructor(readonly reason: "rpc" | "timeout" | "decode", message: string) {
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
  config: RegistryConfig,
  method: "get_document" | "get_node",
  args: xdr.ScVal[],
  notFound: number,
): Promise<xdr.ScVal | null> {
  const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE[config.network],
  })
    .addOperation(new Contract(config.contractId).call(method, ...args))
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

/** What the page is checking the reference for. */
export type DocSourceContext = {
  network: StellarNetwork;
  milestoneId: string;
  /** The project's `milestone_proof` contract, when it has registered. */
  contractId: string | null;
};

/**
 * How the chain's document compares with the stored version:
 *
 *   verified      the registry is at the stored version
 *   newer         the registry is past it: the plan changed since the link
 *                 was written (or was first anchored since, when the link has
 *                 no version)
 *   mismatch      the registry is behind the stored version, which a correct
 *                 link cannot produce
 *   not-found     the link has a version, the registry has no such document
 *   not-anchored  neither has one: the plan was never anchored, so there is
 *                 nothing to check against
 *   unreachable   the read failed (RPC down, timed out, undecodable reply)
 *   unconfigured  this deployment has no registry for the network
 */
export type DocSourceState =
  | "verified"
  | "newer"
  | "mismatch"
  | "not-found"
  | "not-anchored"
  | "unreachable"
  | "unconfigured";

/**
 * The heading's own on-chain record, against this milestone (contract
 * section 10): a node linked to a qdit milestone is signed with
 * `tool = "qdit"` and an `artifact_ref` naming the milestone.
 *
 *   attests    signed for this milestone, on this network (and this
 *              project's contract, when the project has one)
 *   elsewhere  signed with `tool = "qdit"`, but the reference names another
 *              milestone, network or contract, or does not parse
 *   other      signed with another tool (for example `rollup`)
 *   none       never signed
 */
export type NodeAttestation =
  | { state: "attests"; status: NodeStatus; milestoneVersion: number }
  | { state: "elsewhere"; status: NodeStatus }
  | { state: "other"; status: NodeStatus; tool: string }
  | { state: "none" };

export type DocSourceCheck = {
  state: DocSourceState;
  network: StellarNetwork;
  /** The registry contract that was (or would have been) read. */
  registryId: string | null;
  /** The registry's current `Document.version`, when it was read. */
  chainVersion: number | null;
  /** Null when the registry was not read. */
  node: NodeAttestation | null;
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

export function nodeAttestation(node: RegistryNode | null, context: DocSourceContext): NodeAttestation {
  if (!node) return { state: "none" };
  if (node.tool !== "qdit") return { state: "other", status: node.status, tool: node.tool };

  const ref = parseQditArtifactRef(node.artifactRef);
  const matches =
    ref !== null &&
    ref.milestoneId === context.milestoneId &&
    ref.network === context.network &&
    (context.contractId === null || ref.contractId === context.contractId);

  return matches
    ? { state: "attests", status: node.status, milestoneVersion: ref.version }
    : { state: "elsewhere", status: node.status };
}

/** Compare a read with the stored reference. Pure. */
export function compareDocSource(
  stored: StoredDocSource,
  read: RegistryRead,
  context: DocSourceContext,
  registryId: string,
): DocSourceCheck {
  const base = { network: context.network, registryId };
  if (!read.ok) return { ...base, state: "unreachable", chainVersion: null, node: null };

  const node = nodeAttestation(read.node, context);
  const chain = read.document?.version ?? null;
  const linked = stored.docVersion;

  let state: DocSourceState;
  if (chain === null) state = linked === null ? "not-anchored" : "not-found";
  else if (linked === null || chain > linked) state = "newer";
  else if (chain === linked) state = "verified";
  else state = "mismatch";

  return { ...base, state, chainVersion: chain, node };
}

// ---------------------------------------------------------------------------
// The cached check the page calls
// ---------------------------------------------------------------------------

/** How long a read that got an answer is reused. */
export const CACHE_TTL_MS = 30_000;
/** How long a failed read is reused, so a reload storm does not hammer a down RPC. */
export const FAILURE_TTL_MS = 5_000;
const CACHE_LIMIT = 500;

const cache = new Map<string, { at: number; read: RegistryRead }>();

/** Empties the read cache. For tests. */
export function clearRegistryCache(): void {
  cache.clear();
}

/**
 * Check a linked milestone's doc reference against DoqtriRegistry on the
 * project's network. Reads are cached per document and node for
 * CACHE_TTL_MS (FAILURE_TTL_MS for a failed one), server side, in memory: a
 * public page can be reloaded by anyone, and the answer it shows is a few
 * seconds old at most.
 */
export async function checkDocSource(
  stored: StoredDocSource,
  context: DocSourceContext,
  options: { now?: () => number; env?: Record<string, string | undefined> } = {},
): Promise<DocSourceCheck> {
  const config = registryConfig(context.network, options.env);
  if (!config) {
    return { state: "unconfigured", network: context.network, registryId: null, chainVersion: null, node: null };
  }

  const now = (options.now ?? Date.now)();
  const key = [config.network, config.contractId, config.rpcUrl, stored.docId, stored.nodeId].join("|");
  const hit = cache.get(key);
  const fresh = hit && now - hit.at < (hit.read.ok ? CACHE_TTL_MS : FAILURE_TTL_MS);

  let read: RegistryRead;
  if (hit && fresh) {
    read = hit.read;
  } else {
    read = await readRegistry(config, stored.docId, stored.nodeId);
    cache.delete(key);
    cache.set(key, { at: now, read });
    // Oldest first, by insertion order.
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  }

  return compareDocSource(stored, read, context, config.contractId);
}
