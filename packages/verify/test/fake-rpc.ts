// A stand-in for Soroban RPC that answers the verifier's three calls from an
// in-memory milestone_proof_v2. Return values are encoded the way the contract
// encodes them, so the verifier's decoding is exercised too.

import { Address, Keypair, Networks, StrKey, scValToNative, xdr, type Transaction } from "@stellar/stellar-sdk";
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
    } as unknown as RpcLike;
  }

  private simulate(tx: Transaction) {
    const op = tx.operations[0] as unknown as { func: xdr.HostFunction };
    const call = op.func.invokeContract();
    const fn = call.functionName().toString();
    const args = call.args().map((a) => scValToNative(a));
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
