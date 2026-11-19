// Reads milestone_proof_v2 state through Soroban RPC simulation. Nothing is
// signed or sent, so no key and no fee are needed.

import {
  Account,
  Address,
  Contract,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

/** The only network v0.1 verifies against. */
export const NETWORK = "testnet";

export const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";

/**
 * WASM hashes of the `milestone_proof_v2` builds this package understands
 * (`contracts/milestone_proof_v2/DEPLOYMENTS.md`). Any contract id running
 * one of them is accepted; anything else, including v1 and the v2 builds on
 * Merkle scheme v1, is refused. A new deploy of changed code adds its hash.
 */
export const KNOWN_V2_WASM_HASHES: ReadonlySet<string> = new Set([
  // Merkle scheme qdit/merkle/v2 (D-124), deployed 2026-11-14.
  "bce764f43120e4ea74b692d2051b33e8be8aba6553eb23e9d9e7101605e6a900",
]);

/**
 * Contract ids of the qdit `milestone_proof_v2` deployments
 * (`contracts/milestone_proof_v2/DEPLOYMENTS.md`). The WASM hash alone is not
 * enough: v2 has no admin, so anyone can deploy the same code, register any
 * project id on their copy and anchor any root there. Only these ids are read
 * unless the caller names others in `trustedContracts`.
 */
export const KNOWN_V2_CONTRACT_IDS: ReadonlySet<string> = new Set([
  "CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB",
]);

/** The contract's error codes (`contracts/milestone_proof_v2/src/errors.rs`). */
export const CONTRACT_ERRORS: Readonly<Record<number, string>> = {
  1: "ProjectExists",
  2: "ProjectNotFound",
  3: "MilestoneNotFound",
  4: "NotAuthorized",
  5: "InvalidStatus",
  6: "IdTooLong",
  7: "NotMember",
  8: "AlreadyApproved",
  9: "InvalidThreshold",
  10: "MemberLimit",
  11: "BatchExists",
  12: "ProofMismatch",
  13: "BatchNotFound",
  14: "InvalidBatch",
};

export type VerifyErrorCode =
  /** The input is malformed: a bad contract id, hash or proof file. */
  | "BAD_INPUT"
  /** The RPC or the proof file is for a network other than testnet. */
  | "WRONG_NETWORK"
  /** The contract id doesn't exist, or doesn't run a known v2 build. */
  | "WRONG_CONTRACT"
  /** The RPC failed or answered something unexpected. */
  | "RPC";

/**
 * Thrown when a check can't be made at all. A check that runs and fails is
 * not an error: it comes back with `ok: false` and its reasons.
 */
export class VerifyError extends Error {
  readonly code: VerifyErrorCode;
  constructor(code: VerifyErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VerifyError";
    this.code = code;
  }
}

/** The RPC calls the verifier makes. `rpc.Server` satisfies it; tests pass a fake. */
export type RpcLike = Pick<rpc.Server, "getNetwork" | "getContractData" | "simulateTransaction">;

export interface ChainOptions {
  /** Soroban RPC endpoint. Defaults to the public testnet RPC. */
  rpcUrl?: string;
  /** Use this RPC client instead of building one from `rpcUrl`. */
  server?: RpcLike;
  /**
   * Contract ids to accept instead of {@link KNOWN_V2_CONTRACT_IDS}. Each must
   * still run a known v2 WASM. Name only deployments you trust: the contract
   * is where the root comes from.
   */
  trustedContracts?: readonly string[];
}

/** A read's outcome: the decoded value, or the contract error it was refused with. */
export type ReadResult = { ok: true; value: unknown } | { ok: false; code: number; error: string };

/** The all-zero account simulations run from. It needs no funds and no key. */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export const sc = {
  string: (s: string) => nativeToScVal(s, { type: "string" }),
  u32: (n: number) => nativeToScVal(n, { type: "u32" }),
  bytes: (b: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(b)),
  vec: (items: xdr.ScVal[]) => xdr.ScVal.scvVec(items),
};

export class ChainReader {
  readonly contractId: string;
  private readonly server: RpcLike;
  private readonly contract: Contract;
  private target?: Promise<string>;

  constructor(contractId: string, options: ChainOptions = {}) {
    if (typeof contractId !== "string" || !StrKey.isValidContract(contractId)) {
      throw new VerifyError("BAD_INPUT", `not a contract id: ${JSON.stringify(contractId)}`);
    }
    const trusted = options.trustedContracts ? new Set(options.trustedContracts) : KNOWN_V2_CONTRACT_IDS;
    if (!trusted.has(contractId)) {
      throw new VerifyError(
        "WRONG_CONTRACT",
        `${contractId} is not a known qdit milestone_proof_v2 deployment; pass trustedContracts to check another`,
      );
    }
    this.contractId = contractId;
    this.contract = new Contract(contractId);
    const url = options.rpcUrl ?? TESTNET_RPC_URL;
    this.server = options.server ?? new rpc.Server(url, { allowHttp: url.startsWith("http://") });
  }

  /**
   * Check, once per reader, that the RPC serves testnet and that the contract
   * runs a known v2 build. Resolves to the contract's WASM hash.
   */
  checkTarget(): Promise<string> {
    this.target ??= this.loadTarget();
    return this.target;
  }

  private async loadTarget(): Promise<string> {
    let passphrase: string;
    try {
      passphrase = (await this.server.getNetwork()).passphrase;
    } catch (cause) {
      throw new VerifyError("RPC", `getNetwork failed: ${message(cause)}`, { cause });
    }
    if (passphrase !== Networks.TESTNET) {
      throw new VerifyError(
        "WRONG_NETWORK",
        `the RPC serves ${JSON.stringify(passphrase)}; @qdit/verify v0.1 checks Stellar testnet only`,
      );
    }

    let entry: Awaited<ReturnType<RpcLike["getContractData"]>>;
    try {
      entry = await this.server.getContractData(
        this.contractId,
        xdr.ScVal.scvLedgerKeyContractInstance(),
        rpc.Durability.Persistent,
      );
    } catch (cause) {
      // The SDK rejects with a plain `{ code: 404, message }` for a missing entry.
      if ((cause as { code?: unknown })?.code === 404 || /not found/i.test(message(cause))) {
        throw new VerifyError("WRONG_CONTRACT", `no contract ${this.contractId} on testnet`, { cause });
      }
      throw new VerifyError("RPC", `reading contract ${this.contractId} failed: ${message(cause)}`, { cause });
    }

    const executable = entry.val.contractData().val().instance().executable();
    if (executable.switch() !== xdr.ContractExecutableType.contractExecutableWasm()) {
      throw new VerifyError("WRONG_CONTRACT", `${this.contractId} is not a WASM contract`);
    }
    const hash = Buffer.from(executable.wasmHash()).toString("hex");
    if (!KNOWN_V2_WASM_HASHES.has(hash)) {
      throw new VerifyError(
        "WRONG_CONTRACT",
        `${this.contractId} runs WASM ${hash}, which is not a known milestone_proof_v2 build`,
      );
    }
    return hash;
  }

  /** Simulate a read-only call, after {@link checkTarget}. */
  async read(method: string, args: xdr.ScVal[]): Promise<ReadResult> {
    await this.checkTarget();
    const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(0)
      .build();

    let sim: Awaited<ReturnType<RpcLike["simulateTransaction"]>>;
    try {
      sim = await this.server.simulateTransaction(tx);
    } catch (cause) {
      throw new VerifyError("RPC", `${method}: simulation failed: ${message(cause)}`, { cause });
    }
    if (rpc.Api.isSimulationError(sim)) {
      const m = /Error\(Contract, #(\d+)\)/.exec(sim.error);
      if (m) {
        const code = Number(m[1]);
        return { ok: false, code, error: CONTRACT_ERRORS[code] ?? `contract error #${code}` };
      }
      throw new VerifyError("RPC", `${method}: ${sim.error}`);
    }
    const retval = (sim as { result?: { retval?: xdr.ScVal } }).result?.retval;
    if (!retval) throw new VerifyError("RPC", `${method}: simulation returned no result`);
    return { ok: true, value: scValToNative(retval) };
  }
}

/** An address as its `G…`/`C…` string, whatever form the decoder gave. */
export function addressString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Address) return v.toString();
  throw new VerifyError("RPC", `expected an address, got ${typeof v}`);
}

function message(e: unknown): string {
  if (e instanceof Error) return e.message;
  const m = (e as { message?: unknown })?.message;
  if (typeof m === "string") return m;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
