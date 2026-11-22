// replay: rebuild milestone_proof_v2 state from the contract's events alone,
// and check the result against the contract's own getters.
//
// Every v2 write emits one event (contracts/milestone_proof_v2/src/events.rs)
// carrying what is needed to rebuild state without reading storage. Soroban RPC
// keeps events for a limited window only (about 7 days on testnet), so a replay
// that starts before the window can't see the oldest events. It says so: the
// snapshot is marked incomplete, and each project whose creation fell outside
// the window is marked partial and is not compared.

import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { toHex } from "@qdit/merkle";
import { ChainReader, NETWORK, VerifyError, addressString, sc, type ChainOptions, type RpcLike } from "./chain.ts";

/**
 * The ledger each known deployment was created in
 * (`contracts/milestone_proof_v2/DEPLOYMENTS.md`). A replay starts here unless
 * told otherwise: no event can be older.
 */
export const KNOWN_V2_DEPLOY_LEDGERS: Readonly<Record<string, number>> = {
  // Deploy tx d979fe53…a295fd, 2026-11-14.
  CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB: 5728090,
};

export const SNAPSHOT_FORMAT = "qdit-replay/v1";

export type Role = "Submitter" | "Approver";
export type MilestoneStatus = "Proposed" | "Submitted" | "Approved" | "Rejected";

/** One contract event, decoded to plain values. */
export interface ReplayEvent {
  /** RPC event id; sorts in chain order. */
  id: string;
  ledger: number;
  txHash: string;
  /** Topics as native values: `["qdit", verb, project_id]`. */
  topic: unknown[];
  /** The event's data as a native value (a field map for every v2 event). */
  value: unknown;
}

export interface ReplayMilestone {
  status: MilestoneStatus;
  version: number;
  /** Lowercase hex. */
  proofHash: string;
  /** Null when the submission itself fell outside the replayed window. */
  submitter: string | null;
  /** Unix seconds; null as for `submitter`. */
  timestamp: number | null;
  /** This version's approvers, in order. */
  approvers: string[];
}

export interface ReplayBatch {
  /** Lowercase hex. */
  root: string;
  leafCount: number;
  submitter: string;
  ledger: number;
  /** Unix seconds. */
  timestamp: number;
  txHash: string;
}

export interface ReplayProject {
  /**
   * The project's creation was replayed, so every later event was too and the
   * entry is the project's whole state. False when only later events were seen.
   */
  complete: boolean;
  owner: string | null;
  threshold: number | null;
  createdLedger: number | null;
  members: Record<string, Role>;
  milestones: Record<string, ReplayMilestone>;
  batches: Record<string, ReplayBatch>;
}

export interface ReplaySnapshot {
  format: typeof SNAPSHOT_FORMAT;
  network: typeof NETWORK;
  contractId: string;
  /** The ledger the contract was deployed in, when known. */
  deployLedger: number | null;
  /** The ledger asked for. */
  requestedFromLedger: number;
  /** The first ledger whose events are included. */
  fromLedger: number;
  /** The last ledger whose events are included. */
  toLedger: number;
  /** Every event from {@link deployLedger} (or the requested start) on was replayed. */
  complete: boolean;
  /** Why the snapshot is incomplete, in plain words. Empty when complete. */
  gaps: string[];
  eventCount: number;
  projects: Record<string, ReplayProject>;
}

/** The RPC calls replay makes, beyond the verifier's reads. */
export type EventRpcLike = RpcLike & Pick<rpc.Server, "getEvents" | "getLatestLedger" | "getHealth">;

export interface ReplayOptions extends Omit<ChainOptions, "server"> {
  contractId: string;
  /**
   * First ledger to read. Defaults to the deployment's ledger for a known
   * contract; required for any other.
   */
  startLedger?: number;
  /** Last ledger to read. Defaults to the latest ledger when the replay starts. */
  endLedger?: number;
  server?: EventRpcLike;
  /** Events per `getEvents` page. */
  pageLimit?: number;
}

// --- folding -------------------------------------------------------------

function fields(e: ReplayEvent): Record<string, unknown> {
  const v = e.value;
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new VerifyError("RPC", `event ${e.id}: data is not a field map`);
  }
  return v as Record<string, unknown>;
}

function enumName(v: unknown): string {
  const name = Array.isArray(v) ? v[0] : (v as { tag?: unknown })?.tag ?? v;
  if (typeof name !== "string") throw new VerifyError("RPC", `expected an enum variant, got ${JSON.stringify(v)}`);
  return name;
}

function role(v: unknown): Role {
  const n = enumName(v);
  if (n !== "Submitter" && n !== "Approver") throw new VerifyError("RPC", `unknown role ${n}`);
  return n;
}

function status(v: unknown): MilestoneStatus {
  const n = enumName(v);
  if (!["Proposed", "Submitted", "Approved", "Rejected"].includes(n)) throw new VerifyError("RPC", `unknown status ${n}`);
  return n as MilestoneStatus;
}

function hex(v: unknown): string {
  if (v instanceof Uint8Array) return toHex(new Uint8Array(v));
  throw new VerifyError("RPC", `expected bytes, got ${typeof v}`);
}

function num(v: unknown): number {
  const n = typeof v === "bigint" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n)) throw new VerifyError("RPC", `expected an integer, got ${String(v)}`);
  return n;
}

function emptyProject(complete: boolean): ReplayProject {
  return { complete, owner: null, threshold: null, createdLedger: null, members: {}, milestones: {}, batches: {} };
}

/**
 * Fold events, in chain order, into per-project state. Pure: no network.
 * Events that aren't `qdit` events are ignored.
 */
export function foldEvents(events: readonly ReplayEvent[]): Record<string, ReplayProject> {
  const projects = new Map<string, ReplayProject>();
  const project = (id: string) => {
    let p = projects.get(id);
    if (!p) {
      p = emptyProject(false);
      projects.set(id, p);
    }
    return p;
  };

  for (const e of events) {
    if (e.topic[0] !== "qdit" || typeof e.topic[1] !== "string" || typeof e.topic[2] !== "string") continue;
    const verb = e.topic[1];
    const pid = e.topic[2];
    const f = fields(e);

    switch (verb) {
      case "create": {
        // A project id is created once; ProjectExists refuses a second.
        const p = emptyProject(true);
        p.owner = addressString(f.owner);
        p.threshold = num(f.threshold);
        p.createdLedger = e.ledger;
        projects.set(pid, p);
        break;
      }
      case "transfer":
        project(pid).owner = addressString(f.new_owner);
        break;
      case "add_member":
        project(pid).members[addressString(f.member)] = role(f.role);
        break;
      case "remove_member":
        delete project(pid).members[addressString(f.member)];
        break;
      case "threshold":
        project(pid).threshold = num(f.threshold);
        break;
      case "submit": {
        // A submission starts a new version and clears earlier approvals.
        project(pid).milestones[String(f.milestone_id)] = {
          status: "Submitted",
          version: num(f.version),
          proofHash: hex(f.proof_hash),
          submitter: addressString(f.submitter),
          timestamp: num(f.timestamp),
          approvers: [],
        };
        break;
      }
      case "approve":
      case "reject": {
        const p = project(pid);
        const id = String(f.milestone_id);
        const version = num(f.version);
        let m = p.milestones[id];
        if (!m || m.version !== version) {
          // The submission fell outside the window: start from what the event says.
          m = { status: "Submitted", version, proofHash: hex(f.proof_hash), submitter: null, timestamp: null, approvers: [] };
          p.milestones[id] = m;
          p.complete = false;
        }
        if (verb === "approve") {
          m.approvers.push(addressString(f.approver));
          m.status = status(f.status);
        } else {
          m.status = "Rejected";
        }
        break;
      }
      case "batch":
        project(pid).batches[String(f.batch_id)] = {
          root: hex(f.root),
          leafCount: num(f.leaf_count),
          submitter: addressString(f.submitter),
          ledger: e.ledger,
          timestamp: num(f.timestamp),
          txHash: e.txHash,
        };
        break;
      default:
        // An event verb this version doesn't know: the state may be wrong.
        throw new VerifyError("RPC", `event ${e.id}: unknown qdit event ${JSON.stringify(verb)}`);
    }
  }
  return sortProjects(projects);
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function sortProjects(projects: Map<string, ReplayProject>): Record<string, ReplayProject> {
  return Object.fromEntries(
    [...projects.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, p]) => [id, { ...p, members: sortKeys(p.members), milestones: sortKeys(p.milestones), batches: sortKeys(p.batches) }]),
  );
}

// --- reading -------------------------------------------------------------

/** Decode one RPC event. */
export function decodeEvent(e: rpc.Api.EventResponse): ReplayEvent {
  return {
    id: e.id,
    ledger: e.ledger,
    txHash: e.txHash,
    topic: e.topic.map((t: xdr.ScVal) => scValToNative(t)),
    value: scValToNative(e.value),
  };
}

/**
 * The ledger an event id or paging cursor points at. Both start with a TOID,
 * whose top 32 bits are the ledger sequence.
 */
export function cursorLedger(cursor: string): number {
  const toid = /^(\d+)/.exec(cursor)?.[1];
  if (!toid) throw new VerifyError("RPC", `unexpected getEvents cursor ${JSON.stringify(cursor)}`);
  return Number(BigInt(toid) >> 32n);
}

function rpcFail(what: string, cause: unknown): never {
  const msg = cause instanceof Error ? cause.message : (cause as { message?: string })?.message ?? String(cause);
  throw new VerifyError("RPC", `${what} failed: ${msg}`, { cause });
}

/**
 * Read the contract's events through RPC `getEvents` and fold them into a
 * snapshot. Throws {@link VerifyError} when the read can't be made (not
 * testnet, not a known v2 contract, RPC failure). A window that starts after
 * the requested ledger is not an error: the snapshot says what is missing.
 */
export async function replay(options: ReplayOptions): Promise<ReplaySnapshot> {
  const { contractId } = options;
  const url = options.rpcUrl;
  const server: EventRpcLike =
    options.server ?? (new rpc.Server(url ?? "https://soroban-testnet.stellar.org", { allowHttp: !!url?.startsWith("http://") }) as EventRpcLike);
  // Checks testnet and a known v2 build before anything is read.
  const reader = new ChainReader(contractId, { ...options, server });
  await reader.checkTarget();

  const deployLedger = KNOWN_V2_DEPLOY_LEDGERS[contractId] ?? null;
  const requested = options.startLedger ?? deployLedger;
  if (requested === null || !Number.isSafeInteger(requested) || requested < 1) {
    throw new VerifyError("BAD_INPUT", `startLedger is required for ${contractId}, which has no known deploy ledger`);
  }

  let health: Awaited<ReturnType<EventRpcLike["getHealth"]>>;
  let latest: number;
  try {
    [health, latest] = await Promise.all([server.getHealth(), server.getLatestLedger().then((l) => l.sequence)]);
  } catch (cause) {
    rpcFail("reading the RPC's ledger range", cause);
  }
  const oldest = Number(health.oldestLedger);
  const toLedger = options.endLedger ?? latest;
  if (!Number.isSafeInteger(toLedger) || toLedger < requested) {
    throw new VerifyError("BAD_INPUT", `endLedger ${toLedger} is before startLedger ${requested}`);
  }
  if (toLedger > latest) throw new VerifyError("BAD_INPUT", `endLedger ${toLedger} is after the latest ledger ${latest}`);

  const gaps: string[] = [];
  let fromLedger = requested;
  if (requested < oldest) {
    fromLedger = oldest;
    gaps.push(
      `events from ledger ${requested} to ${oldest - 1} are outside the RPC's retention window ` +
        `(it keeps ledgers ${oldest} to ${latest}); state written in them is missing`,
    );
  }
  if (deployLedger !== null && requested > deployLedger) {
    gaps.push(`the replay starts at ledger ${requested}, after the deploy ledger ${deployLedger}; earlier events were not read`);
  }

  const limit = options.pageLimit ?? 1000;
  const filters: rpc.Api.EventFilter[] = [{ type: "contract", contractIds: [contractId] }];
  const events: ReplayEvent[] = [];
  let page: rpc.Api.GetEventsResponse;
  try {
    // endLedger is exclusive.
    page = await server.getEvents({ startLedger: fromLedger, endLedger: toLedger + 1, filters, limit });
  } catch (cause) {
    rpcFail("getEvents", cause);
  }
  // The RPC scans a bounded run of ledgers per call (about 10,000 on testnet),
  // so a short or empty page doesn't mean the end. The cursor encodes how far
  // the scan got: page until it passes toLedger.
  let lastCursor = "";
  for (;;) {
    let past = false;
    for (const e of page.events) {
      if (e.ledger > toLedger) {
        past = true;
        break;
      }
      events.push(decodeEvent(e));
    }
    if (past || !page.cursor || cursorLedger(page.cursor) >= toLedger) break;
    if (page.cursor === lastCursor) throw new VerifyError("RPC", `getEvents made no progress at cursor ${page.cursor}`);
    lastCursor = page.cursor;
    try {
      page = await server.getEvents({ cursor: page.cursor, filters, limit });
    } catch (cause) {
      rpcFail("getEvents", cause);
    }
  }

  const projects = foldEvents(events);
  const partial = Object.entries(projects).filter(([, p]) => !p.complete).map(([id]) => id);
  if (partial.length > 0) {
    gaps.push(`${partial.length} project(s) were created before ledger ${fromLedger} and are partial: ${partial.join(", ")}`);
  }

  return {
    format: SNAPSHOT_FORMAT,
    network: NETWORK,
    contractId,
    deployLedger,
    requestedFromLedger: requested,
    fromLedger,
    toLedger,
    complete: gaps.length === 0,
    gaps,
    eventCount: events.length,
    projects,
  };
}

// --- comparing -----------------------------------------------------------

export interface ContractComparison {
  /** Every compared entry matches the contract's getters. */
  ok: boolean;
  /** Echoes the snapshot: false means some state was never replayed. */
  snapshotComplete: boolean;
  checked: { projects: number; members: number; milestones: number; batches: number };
  /** Partial projects, which can't be compared. */
  skipped: string[];
  /** Each difference, as `project/kind/id: field snapshot X, contract Y`. */
  diffs: string[];
}

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

/**
 * Check every complete project in `snapshot` against the contract: owner and
 * threshold (`get_project`), roster (`get_members`), each milestone
 * (`get_milestone_status`) and each batch (`get_batch`).
 */
export async function compareWithContract(
  snapshot: ReplaySnapshot,
  options: ChainOptions & { concurrency?: number } = {},
): Promise<ContractComparison> {
  const chain = new ChainReader(snapshot.contractId, options);
  await chain.checkTarget();
  const out: ContractComparison = {
    ok: false,
    snapshotComplete: snapshot.complete,
    checked: { projects: 0, members: 0, milestones: 0, batches: 0 },
    skipped: [],
    diffs: [],
  };
  const diff = (where: string, field: string, want: unknown, got: unknown) => {
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      out.diffs.push(`${where}: ${field} snapshot ${JSON.stringify(want)}, contract ${JSON.stringify(got)}`);
    }
  };

  const tasks: (() => Promise<void>)[] = [];
  for (const [pid, p] of Object.entries(snapshot.projects)) {
    if (!p.complete) {
      out.skipped.push(pid);
      continue;
    }
    out.checked.projects++;
    tasks.push(async () => {
      const r = await chain.read("get_project", [sc.string(pid)]);
      if (!r.ok) return void out.diffs.push(`${pid}: get_project refused: ${r.error}`);
      const v = r.value as { owner: unknown; threshold: unknown };
      diff(pid, "owner", p.owner, addressString(v.owner));
      diff(pid, "threshold", p.threshold, num(v.threshold));
    });
    tasks.push(async () => {
      const r = await chain.read("get_members", [sc.string(pid)]);
      if (!r.ok) return void out.diffs.push(`${pid}: get_members refused: ${r.error}`);
      const onChain = sortKeys(
        Object.fromEntries(Object.entries(r.value as Record<string, unknown>).map(([a, ro]) => [a, role(ro)])),
      );
      out.checked.members += Object.keys(onChain).length;
      diff(pid, "members", p.members, onChain);
    });
    for (const [mid, m] of Object.entries(p.milestones)) {
      out.checked.milestones++;
      tasks.push(async () => {
        const r = await chain.read("get_milestone_status", [sc.string(pid), sc.string(mid)]);
        const where = `${pid}/milestone/${mid}`;
        if (!r.ok) return void out.diffs.push(`${where}: get_milestone_status refused: ${r.error}`);
        const v = r.value as Record<string, unknown>;
        diff(where, "status", m.status, status(v.status));
        diff(where, "version", m.version, num(v.version));
        diff(where, "proofHash", m.proofHash, hex(v.proof_hash));
        diff(where, "submitter", m.submitter, addressString(v.submitter));
        diff(where, "timestamp", m.timestamp, num(v.timestamp));
        diff(where, "approvers", m.approvers, (v.approvers as unknown[]).map(addressString));
      });
    }
    for (const [bid, b] of Object.entries(p.batches)) {
      out.checked.batches++;
      tasks.push(async () => {
        const r = await chain.read("get_batch", [sc.string(pid), sc.string(bid)]);
        const where = `${pid}/batch/${bid}`;
        if (!r.ok) return void out.diffs.push(`${where}: get_batch refused: ${r.error}`);
        const v = r.value as Record<string, unknown>;
        diff(where, "root", b.root, hex(v.root));
        diff(where, "leafCount", b.leafCount, num(v.leaf_count));
        diff(where, "submitter", b.submitter, addressString(v.submitter));
        diff(where, "ledger", b.ledger, num(v.ledger));
        diff(where, "timestamp", b.timestamp, num(v.timestamp));
      });
    }
  }
  await pool(tasks, options.concurrency ?? 8, (t) => t());
  out.diffs.sort();
  out.ok = out.diffs.length === 0;
  return out;
}
