// A thin client for the milestone_proof_v2 calls qdit-batch makes: build,
// simulate, sign, send and wait. It holds no state beyond the RPC handle.

import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

/** The all-zero account the SDK's contract client simulates reads from. */
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export interface Network {
  name: string;
  rpcUrl: string;
  passphrase: string;
  friendbotUrl?: string;
}

export const TESTNET: Network = {
  name: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  passphrase: Networks.TESTNET,
  friendbotUrl: "https://friendbot.stellar.org",
};

/** The contract's error codes (`milestone_proof_v2/src/errors.rs`). */
export const CONTRACT_ERRORS: Record<number, string> = {
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

export class ContractError extends Error {
  readonly code: number;
  constructor(code: number, method: string) {
    super(`${method} refused: ${CONTRACT_ERRORS[code] ?? "unknown"} (#${code})`);
    this.code = code;
  }
}

/** Turn a simulation or result error into a ContractError when it names one. */
function asContractError(method: string, raw: string): Error {
  const m = /Error\(Contract, #(\d+)\)/.exec(raw);
  return m ? new ContractError(Number(m[1]), method) : new Error(`${method} failed: ${raw}`);
}

export const sc = {
  string: (s: string) => nativeToScVal(s, { type: "string" }),
  u32: (n: number) => nativeToScVal(n, { type: "u32" }),
  bytes: (b: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(b)),
  address: (a: string) => new Address(a).toScVal(),
  vec: (items: xdr.ScVal[]) => xdr.ScVal.scvVec(items),
};

/** What one sent transaction cost and where it landed. */
export interface Sent {
  txHash: string;
  ledger: number;
  createdAt: number;
  /** Total fee charged, in stroops (inclusion fee plus resource fee). */
  feeCharged: bigint;
  /** The resource fee the simulation asked for, in stroops. */
  resourceFee: bigint;
  /** CPU instructions the simulation measured. */
  instructions: number;
  /** Bytes of ledger entries written. */
  writeBytes: number;
  /** Size of the signed transaction envelope. */
  txBytes: number;
  returnValue: unknown;
}

export interface Simulated {
  value: unknown;
  instructions: number;
  resourceFee: bigint;
}

export class Client {
  readonly server: rpc.Server;
  readonly network: Network;
  readonly contract: Contract;

  constructor(network: Network, contractId: string) {
    this.network = network;
    this.server = new rpc.Server(network.rpcUrl, {
      allowHttp: network.rpcUrl.startsWith("http://"),
    });
    this.contract = new Contract(contractId);
  }

  get contractId(): string {
    return this.contract.contractId();
  }

  private build(account: Account, method: string, args: xdr.ScVal[]) {
    return new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.network.passphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(120)
      .build();
  }

  /**
   * Simulate a read-only call. Nothing is signed or sent, so the source is the
   * SDK's null account and no funded key is needed.
   */
  async read(method: string, args: xdr.ScVal[]): Promise<Simulated> {
    const tx = this.build(new Account(NULL_ACCOUNT, "0"), method, args);
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw asContractError(method, sim.error);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      throw new Error(`${method}: simulation returned no result`);
    }
    return {
      value: scValToNative(sim.result.retval),
      instructions: sim.transactionData.build().resources().instructions(),
      resourceFee: BigInt(sim.minResourceFee),
    };
  }

  /** Simulate, sign with `signer`, send, and wait for the ledger to close. */
  async invoke(signer: Keypair, method: string, args: xdr.ScVal[]): Promise<Sent> {
    const tx = this.build(await this.server.getAccount(signer.publicKey()), method, args);
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw asContractError(method, sim.error);
    if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`${method}: simulation failed`);

    const resources = sim.transactionData.build().resources();
    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(signer);
    const txBytes = prepared.toEnvelope().toXDR().length;

    const sent = await this.server.sendTransaction(prepared);
    if (sent.status === "ERROR" || sent.status === "DUPLICATE" || sent.status === "TRY_AGAIN_LATER") {
      const detail = sent.errorResult ? sent.errorResult.result().switch().name : sent.status;
      throw new Error(`${method}: send ${sent.status} (${detail})`);
    }

    const done = await this.server.pollTransaction(sent.hash, {
      attempts: 60,
      sleepStrategy: () => 1000,
    });
    if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`${method}: transaction ${sent.hash} ended ${done.status}`);
    }

    return {
      txHash: sent.hash,
      ledger: done.ledger,
      createdAt: done.createdAt,
      feeCharged: BigInt(done.resultXdr.feeCharged().toString()),
      resourceFee: BigInt(sim.minResourceFee),
      instructions: resources.instructions(),
      writeBytes: resources.writeBytes(),
      txBytes,
      returnValue: done.returnValue ? scValToNative(done.returnValue) : undefined,
    };
  }
}

/** Fund a fresh testnet account through friendbot. */
export async function fund(network: Network, publicKey: string): Promise<void> {
  if (!network.friendbotUrl) throw new Error(`no friendbot on ${network.name}`);
  const res = await fetch(`${network.friendbotUrl}/?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) throw new Error(`friendbot: HTTP ${res.status} ${await res.text()}`);
}

/** The batch record `get_batch` returns, with plain JS types. */
export interface BatchRecord {
  root: Uint8Array;
  leafCount: number;
  submitter: string;
  timestamp: number;
  ledger: number;
}

export function toBatchRecord(v: unknown): BatchRecord {
  const r = v as { root: Buffer; leaf_count: number; submitter: string; timestamp: bigint; ledger: number };
  return {
    root: new Uint8Array(r.root),
    leafCount: Number(r.leaf_count),
    submitter: String(r.submitter),
    timestamp: Number(r.timestamp),
    ledger: Number(r.ledger),
  };
}
