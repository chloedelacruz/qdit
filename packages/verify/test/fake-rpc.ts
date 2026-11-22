// A stand-in for Soroban RPC that answers the verifier's three calls from an
// in-memory milestone_proof_v2. Return values are encoded the way the contract
// encodes them, so the verifier's decoding is exercised too.

import { Address, Contract, Keypair, Networks, StrKey, rpc, scValToNative, xdr, type Transaction } from "@stellar/stellar-sdk";
import { fromHex, leafHash, verifyPath } from "@qdit/merkle";
import type { RpcLike } from "../src/chain.ts";

export const V2_WASM = "bce764f43120e4ea74b692d2051b33e8be8aba6553eb23e9d9e7101605e6a900";

/** The pinned deployment, so the fake answers for the real id. */
export const CONTRACT_ID = "CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB";

/** A copy of the same WASM at another id: what a forger would deploy. */
export const CLONE_ID = StrKey.encodeContract(Buffer.alloc(32, 7));

export const addr = (seed: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, seed)).publicKey();

export type Status = "Proposed" | "Submitted" | "Approved" | "Rejected";

export interface FakeMilestone {
  status: Status;
  version: number;
  proofHash: Uint8Array;
  submitter: string;
  timestamp: number;
  approvers: string[];
}

export interface FakeBatch {
  root: Uint8Array;
  leafCount: number;
  submitter: string;
  ledger: number;
  timestamp: number;
}

export class FakeChain {
  passphrase: string = Networks.TESTNET;
  /** WASM hash per contract id. A missing id is "not found". */
  contracts = new Map<string, string>([
    [CONTRACT_ID, V2_WASM],
    [CLONE_ID, V2_WASM],
  ]);
  projects = new Map<string, { owner: string; threshold: number }>();
  milestones = new Map<string, FakeMilestone>();
  batches = new Map<string, FakeBatch>();
  /** Roster per project: address to role. */
  members = new Map<string, Map<string, "Submitter" | "Approver">>();
  /** Events in chain order, RPC-shaped, as the contract emits them. */
  events: rpc.Api.EventResponse[] = [];
  ledger = 1000;
  /** The oldest ledger the fake RPC still serves events for. */
  oldestLedger = 1;
  private seq = 0;
  /** Force a contract error from a function, by name. */
  refuse = new Map<string, number>();
  /** Every simulated call, by function name. */
  calls: string[] = [];

  rpc(): RpcLike {
    return {
      getNetwork: async () => ({ passphrase: this.passphrase, protocolVersion: 23 }),
      getContractData: async (contract: unknown) => {
        const id = String(contract);
        const hash = this.contracts.get(id);
        // The real SDK rejects with a plain object here, not an Error.
        if (!hash) throw { code: 404, message: `Contract data not found for ${id}` };
        return { val: instanceEntry(id, hash) };
      },
      simulateTransaction: async (tx: unknown) => this.simulate(tx as Transaction),
      getLatestLedger: async () => ({ id: "x", sequence: this.ledger, protocolVersion: 23 }),
      getHealth: async () => ({ status: "healthy", latestLedger: this.ledger, oldestLedger: this.oldestLedger, ledgerRetentionWindow: 120960 }),
      getEvents: async (req: rpc.Api.GetEventsRequest) => this.getEvents(req),
    } as unknown as RpcLike;
  }

  /** Ledgers one getEvents call scans, like the real RPC's 10,000. */
  scanLedgers = 3;

  /**
   * getEvents with the real RPC's paging: a ledger range first, then a cursor.
   * Each call scans at most {@link scanLedgers} ledgers or `limit` events, and
   * the cursor is a TOID at the end of what was scanned.
   */
  private getEvents(req: rpc.Api.GetEventsRequest) {
    const limit = req.limit ?? 100;
    let after: bigint; // exclusive TOID
    let end: number; // exclusive ledger
    if (req.cursor !== undefined) {
      after = BigInt(req.cursor.split("-")[0]!);
      end = this.cursorEnd;
    } else {
      if (req.startLedger < this.oldestLedger || req.startLedger > this.ledger) {
        throw new Error(`startLedger must be between the oldest ledger: ${this.oldestLedger} and the latest ledger: ${this.ledger}`);
      }
      after = (BigInt(req.startLedger) << 32n) - 1n;
      end = req.endLedger ?? this.ledger + 1;
      this.cursorEnd = end;
    }
    const firstLedger = Number((after + 1n) >> 32n);
    const scanEnd = Math.min(end, firstLedger + this.scanLedgers); // exclusive
    const ids = new Set(req.filters.flatMap((f) => f.contractIds ?? []));
    const page = this.events
      .filter((e) => ids.has(e.contractId?.contractId() ?? "") && BigInt(e.id.split("-")[0]!) > after && e.ledger < scanEnd)
      .slice(0, limit);
    const cursor =
      page.length === limit
        ? page.at(-1)!.id
        : `${((BigInt(scanEnd) << 32n) - 1n).toString().padStart(19, "0")}-4294967295`;
    return {
      events: page,
      cursor,
      latestLedger: this.ledger,
      oldestLedger: this.oldestLedger,
      latestLedgerCloseTime: "0",
      oldestLedgerCloseTime: "0",
    };
  }
  private cursorEnd = 0;

  // --- writes: change state and emit the contract's event --------------------

  private emit(verb: string, project: string, data: Record<string, xdr.ScVal>): void {
    this.ledger++;
    this.seq++;
    this.events.push({
      id: `${((BigInt(this.ledger) << 32n) | BigInt(this.seq)).toString().padStart(19, "0")}-0000000000`,
      type: "contract",
      ledger: this.ledger,
      ledgerClosedAt: "",
      transactionIndex: 0,
      operationIndex: 0,
      inSuccessfulContractCall: true,
      txHash: this.seq.toString(16).padStart(64, "0"),
      contractId: new Contract(CONTRACT_ID),
      topic: [xdr.ScVal.scvSymbol("qdit"), xdr.ScVal.scvSymbol(verb), xdr.ScVal.scvString(project)],
      value: struct(data),
    } as unknown as rpc.Api.EventResponse);
  }

  create(project: string, owner: string, threshold: number): void {
    this.projects.set(project, { owner, threshold });
    this.members.set(project, new Map());
    this.emit("create", project, { owner: address(owner), threshold: xdr.ScVal.scvU32(threshold) });
  }

  transfer(project: string, newOwner: string): void {
    const p = this.projects.get(project)!;
    const previous = p.owner;
    p.owner = newOwner;
    this.emit("transfer", project, { new_owner: address(newOwner), previous_owner: address(previous) });
  }

  addMember(project: string, member: string, role: "Submitter" | "Approver"): void {
    this.members.get(project)!.set(member, role);
    this.emit("add_member", project, { member: address(member), role: variant(role) });
  }

  removeMember(project: string, member: string): void {
    const role = this.members.get(project)!.get(member)!;
    this.members.get(project)!.delete(member);
    this.emit("remove_member", project, { member: address(member), role: variant(role) });
  }

  setThreshold(project: string, threshold: number): void {
    this.projects.get(project)!.threshold = threshold;
    this.emit("threshold", project, { threshold: xdr.ScVal.scvU32(threshold) });
  }

  submit(project: string, milestone: string, submitter: string, proofHash: Uint8Array): void {
    const key = `${project}/${milestone}`;
    const version = (this.milestones.get(key)?.version ?? 0) + 1;
    const timestamp = 1_763_000_000 + this.ledger * 5;
    this.milestones.set(key, { status: "Submitted", version, proofHash, submitter, timestamp, approvers: [] });
    this.emit("submit", project, {
      milestone_id: xdr.ScVal.scvString(milestone),
      proof_hash: xdr.ScVal.scvBytes(Buffer.from(proofHash)),
      submitter: address(submitter),
      timestamp: xdr.ScVal.scvU64(new xdr.Uint64(BigInt(timestamp))),
      version: xdr.ScVal.scvU32(version),
    });
  }

  approve(project: string, milestone: string, approver: string): void {
    const m = this.milestones.get(`${project}/${milestone}`)!;
    m.approvers.push(approver);
    if (m.approvers.length >= this.projects.get(project)!.threshold) m.status = "Approved";
    this.emit("approve", project, {
      approver: address(approver),
      milestone_id: xdr.ScVal.scvString(milestone),
      proof_hash: xdr.ScVal.scvBytes(Buffer.from(m.proofHash)),
      status: variant(m.status),
      version: xdr.ScVal.scvU32(m.version),
    });
  }

  reject(project: string, milestone: string, approver: string): void {
    const m = this.milestones.get(`${project}/${milestone}`)!;
    m.status = "Rejected";
    this.emit("reject", project, {
      approver: address(approver),
      milestone_id: xdr.ScVal.scvString(milestone),
      proof_hash: xdr.ScVal.scvBytes(Buffer.from(m.proofHash)),
      version: xdr.ScVal.scvU32(m.version),
    });
  }

  anchorBatch(project: string, batch: string, submitter: string, root: Uint8Array, leafCount: number): void {
    const timestamp = 1_763_000_000 + (this.ledger + 1) * 5;
    this.batches.set(`${project}/${batch}`, { root, leafCount, submitter, ledger: this.ledger + 1, timestamp });
    this.emit("batch", project, {
      batch_id: xdr.ScVal.scvString(batch),
      leaf_count: xdr.ScVal.scvU32(leafCount),
      root: xdr.ScVal.scvBytes(Buffer.from(root)),
      submitter: address(submitter),
      timestamp: xdr.ScVal.scvU64(new xdr.Uint64(BigInt(timestamp))),
    });
  }

  private simulate(tx: Transaction) {
    const op = tx.operations[0] as unknown as { func: xdr.HostFunction };
    const call = op.func.invokeContract();
    const fn = call.functionName().toString();
    // Over XDR a string arrives as bytes; the contract sees a string.
    const args = call.args().map((a) => (a.switch() === xdr.ScValType.scvString() ? a.str().toString() : scValToNative(a)));
    this.calls.push(fn);
    try {
      return { transactionData: {}, minResourceFee: "0", result: { auth: [], retval: this.answer(fn, args) } };
    } catch (e) {
      if (e instanceof ContractErr) {
        return { error: `HostError: Error(Contract, #${e.code})\n\nEvent log: ...` };
      }
      throw e;
    }
  }

  private answer(fn: string, a: unknown[]): xdr.ScVal {
    const forced = this.refuse.get(fn);
    if (forced !== undefined) throw new ContractErr(forced);
    switch (fn) {
      case "get_project": {
        const p = this.projects.get(a[0] as string);
        if (!p) throw new ContractErr(2);
        return struct({ owner: address(p.owner), threshold: xdr.ScVal.scvU32(p.threshold) });
      }
      case "get_members": {
        const m = this.members.get(a[0] as string);
        if (!m) throw new ContractErr(2);
        return xdr.ScVal.scvMap(
          [...m.entries()]
            .map(([who, role]) => new xdr.ScMapEntry({ key: address(who), val: variant(role) })),
        );
      }
      case "get_milestone_status": {
        if (!this.projects.has(a[0] as string)) throw new ContractErr(2);
        const m = this.milestones.get(`${a[0]}/${a[1]}`);
        if (!m) throw new ContractErr(3);
        return struct({
          approvers: xdr.ScVal.scvVec(m.approvers.map(address)),
          proof_hash: xdr.ScVal.scvBytes(Buffer.from(m.proofHash)),
          status: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(m.status)]),
          submitter: address(m.submitter),
          timestamp: xdr.ScVal.scvU64(new xdr.Uint64(BigInt(m.timestamp))),
          version: xdr.ScVal.scvU32(m.version),
        });
      }
      case "get_batch": {
        const b = this.batches.get(`${a[0]}/${a[1]}`);
        if (!b) throw new ContractErr(13);
        return struct({
          leaf_count: xdr.ScVal.scvU32(b.leafCount),
          ledger: xdr.ScVal.scvU32(b.ledger),
          root: xdr.ScVal.scvBytes(Buffer.from(b.root)),
          submitter: address(b.submitter),
          timestamp: xdr.ScVal.scvU64(new xdr.Uint64(BigInt(b.timestamp))),
        });
      }
      case "verify_inclusion": {
        const [project, batch, milestone, version, proofHash, index, path] = a as [
          string,
          string,
          string,
          number,
          Buffer,
          number,
          Buffer[],
        ];
        if (Buffer.byteLength(milestone) > 64) throw new ContractErr(6);
        const b = this.batches.get(`${project}/${batch}`);
        if (!b) throw new ContractErr(13);
        const leaf = leafHash(project, milestone, version, new Uint8Array(proofHash));
        const ok = verifyPath(b.root, b.leafCount, index, leaf, path.map((p) => new Uint8Array(p)));
        return xdr.ScVal.scvBool(ok);
      }
      default:
        throw new Error(`fake RPC: no ${fn}`);
    }
  }
}

class ContractErr extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`contract error #${code}`);
    this.code = code;
  }
}

/** A Soroban struct: a map with symbol keys in sorted order. */
function struct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map((k) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: fields[k]! })),
  );
}

/** A unit enum variant, as the contract encodes one: a one-item vec of its name. */
function variant(name: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
}

function address(a: string): xdr.ScVal {
  return new Address(a).toScVal();
}

function instanceEntry(contractId: string, wasmHex: string): xdr.LedgerEntryData {
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
      val: xdr.ScVal.scvContractInstance(
        new xdr.ScContractInstance({
          executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(fromHex(wasmHex, 32))),
          storage: null,
        }),
      ),
    }),
  );
}
