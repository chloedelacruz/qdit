// What the harness and the QA seed share: Friendbot funding, a client per
// account, and the send / read / refuse steps that record every transaction.

import { createHash } from "node:crypto";

import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { basicNodeSigner, type AssembledTransaction, type Result } from "@stellar/stellar-sdk/contract";
import { Client, Errors, networks } from "@qdit/milestone-proof-v2-bindings";

import type { Step } from "./evidence.ts";

export const RPC_URL = process.env["QDIT_RPC_URL"] ?? "https://soroban-testnet.stellar.org";
export const FRIENDBOT = "https://friendbot.stellar.org";
export const { contractId, networkPassphrase } = networks.testnet;
export const server = new rpc.Server(RPC_URL);

export type ErrorName = (typeof Errors)[keyof typeof Errors]["message"];
export type Tx<T> = AssembledTransaction<Result<T>>;

/** Records the steps of one run, and logs each as it lands. */
export class Recorder {
  readonly steps: Step[] = [];
  readonly prefix: string;
  constructor(prefix = "") {
    this.prefix = prefix;
  }
  log(line: string): void {
    process.stdout.write(`${this.prefix}${line}\n`);
  }
}

export function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`check failed: ${what}`);
}

export function codeOf(name: string): number {
  const hit = Object.entries(Errors).find(([, e]) => e.message === name);
  if (!hit) throw new Error(`unknown contract error ${name}`);
  return Number(hit[0]);
}

export const sha256 = (data: string | Uint8Array): Buffer => createHash("sha256").update(data).digest();

export async function fund(kp: Keypair): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
    if (res.ok) return;
    if (attempt === 3) throw new Error(`Friendbot refused ${kp.publicKey()}: ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

export function clientFor(kp: Keypair): Client {
  const { signTransaction, signAuthEntry } = basicNodeSigner(kp, networkPassphrase);
  return new Client({
    contractId,
    networkPassphrase,
    rpcUrl: RPC_URL,
    publicKey: kp.publicKey(),
    signTransaction,
    signAuthEntry,
  });
}

/** Sign, send and confirm a write the simulation accepted. */
export async function send<T>(
  rec: Recorder,
  title: string,
  signer: string,
  tx: Tx<T>,
  outcome: (value: T) => string = () => "ok",
  force = false,
): Promise<T> {
  const simulated = tx.result;
  if (simulated.isErr()) {
    throw new Error(`${title}: simulation refused with ${simulated.unwrapErr().message}`);
  }
  const sent = await tx.signAndSend({ force });
  const txHash = sent.sendTransactionResponse?.hash;
  const done = sent.getTransactionResponse;
  if (!txHash || !done || done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`${title}: transaction did not succeed (${done?.status ?? "not sent"})`);
  }
  const value = sent.result.unwrap();
  const step: Step = { kind: "sent", title, signer, outcome: outcome(value), txHash, ledger: done.ledger };
  rec.steps.push(step);
  rec.log(`  ✓ ${title} — ${step.outcome} — ${txHash}`);
  return value;
}

/** A simulated read. `outcome` should throw (via `check`) if the value is wrong. */
export function read<T>(rec: Recorder, title: string, signer: string, tx: Tx<T>, outcome: (value: T) => string): T {
  const value = tx.result.unwrap();
  const text = outcome(value);
  rec.steps.push({ kind: "read", title, signer, outcome: text });
  rec.log(`  ✓ ${title} — ${text} (simulated)`);
  return value;
}

/** The first `Error(Contract, #n)` anywhere in a failed transaction's diagnostic events. */
export function contractErrorIn(events: readonly xdr.DiagnosticEvent[]): number | undefined {
  const scan = (v: xdr.ScVal): number | undefined => {
    if (v.switch().name === "scvError" && v.error().switch().name === "sceContract") {
      return v.error().contractCode();
    }
    if (v.switch().name === "scvVec") {
      for (const item of v.vec() ?? []) {
        const hit = scan(item);
        if (hit !== undefined) return hit;
      }
    }
    return undefined;
  };
  for (const ev of events) {
    const body = ev.event().body().v0();
    for (const v of [...body.topics(), body.data()]) {
      const hit = scan(v);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/**
 * A call the contract must refuse with `expected`.
 *
 * The simulation has to fail with that code. Then the call is sent anyway: a
 * failing simulation gives no footprint, so the transaction borrows the
 * resources and footprint of `model`, the same call made valid (another signer
 * or another id), plus any `extraKeys` only the refused call reads. It lands on
 * the ledger as a failed transaction, and its diagnostic events must carry the
 * same code.
 */
export async function refuse(
  rec: Recorder,
  title: string,
  signer: string,
  kp: Keypair,
  refused: { tx: Tx<unknown>; method: string; args: Record<string, unknown> },
  model: Tx<unknown>,
  expected: ErrorName,
  extraKeys: xdr.LedgerKey[] = [],
): Promise<void> {
  const code = codeOf(expected);
  const sim = refused.tx.simulation;
  const raw = sim && rpc.Api.isSimulationError(sim) ? sim.error : "";
  const hostError = /Error\(Contract, #\d+\)/.exec(raw)?.[0] ?? "";
  if (!refused.tx.result.isErr() || hostError !== `Error(Contract, #${code})`) {
    throw new Error(`${title}: expected ${expected} (#${code}) in simulation, got ${hostError || raw || "success"}`);
  }
  check(model.result.isOk(), `${title}: the model call has to simulate cleanly`);

  const client = clientFor(kp);
  const scArgs = client.spec.funcArgsToScVals(refused.method, refused.args);
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contractId).toScAddress(),
        functionName: refused.method,
        args: scArgs,
      }),
    ),
    subInvocations: [],
  });
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation,
  });

  const modelData = model.simulationData.transactionData;
  const builder = new SorobanDataBuilder(modelData);
  builder.setFootprint([...builder.getReadOnly(), ...extraKeys], builder.getReadWrite());
  const resourceFee = BigInt(modelData.resourceFee().toString()) * 2n;
  builder.setResourceFee(resourceFee.toString());

  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: (BigInt(BASE_FEE) + resourceFee).toString(),
    networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({ contract: contractId, function: refused.method, args: scArgs, auth: [auth] }),
    )
    .setSorobanData(builder.build())
    .setTimeout(60)
    .build();
  tx.sign(kp);

  const submitted = await server.sendTransaction(tx);
  if (submitted.status !== "PENDING") {
    throw new Error(`${title}: the node didn't accept the transaction (${submitted.status})`);
  }
  const done = await server.pollTransaction(submitted.hash, { attempts: 30 });
  if (done.status !== rpc.Api.GetTransactionStatus.FAILED) {
    throw new Error(`${title}: expected a failed transaction, got ${done.status}`);
  }
  const onChain = contractErrorIn(done.diagnosticEventsXdr ?? []);
  if (onChain !== code) {
    throw new Error(`${title}: the failed transaction carries ${onChain === undefined ? "no contract error" : `#${onChain}`}, expected #${code}`);
  }

  rec.steps.push({ kind: "refused", title, signer, expected, code, hostError, txHash: submitted.hash, ledger: done.ledger });
  rec.log(`  ✓ ${title} — refused ${expected} (#${code}) on chain — ${submitted.hash}`);
}

/** The persistent key of `DataKey::Batch(project_id, batch_id)`. */
export function batchKey(projectId: string, batchId: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("Batch"),
        nativeToScVal(projectId, { type: "string" }),
        nativeToScVal(batchId, { type: "string" }),
      ]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

