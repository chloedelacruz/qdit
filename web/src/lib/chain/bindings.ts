import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CAZYR4UI5EYAIUDNXYAYDVHGMUOELJHQNETOAPN3SMR5BMH6XV2FJRH6",
  }
} as const

export const Errors = {
  /**
   * A project with this id is already registered.
   */
  1: {message:"ProjectExists"},
  /**
   * No project is registered under this id.
   */
  2: {message:"ProjectNotFound"},
  /**
   * No milestone record exists for this project/milestone pair.
   */
  3: {message:"MilestoneNotFound"},
  /**
   * Caller is authenticated but is not the project owner.
   */
  4: {message:"NotAuthorized"},
  /**
   * The milestone is not in a status that permits this transition.
   */
  5: {message:"InvalidStatus"},
  /**
   * An identifier exceeds [`MAX_ID_LEN`].
   */
  6: {message:"IdTooLong"}
}

/**
 * Persistent storage keys.
 */
export type DataKey = {tag: "Project", values: readonly [string]} | {tag: "Milestone", values: readonly [string, string]};



/**
 * The full on-chain record for one milestone of one project.
 */
export interface MilestoneRecord {
  milestone_id: string;
  project_id: string;
  /**
 * Hash of the off-chain proof artifact.
 */
proof_hash: Buffer;
  status: MilestoneStatus;
  /**
 * Address that submitted the proof hash.
 */
submitter: string;
  /**
 * Ledger timestamp at the moment the proof was submitted.
 */
timestamp: u64;
  /**
 * Submissions so far, starting at 1. Monotonic.
 * 
 * A re-submission overwrites `proof_hash`, so without this the ledger
 * would show the latest hash with no evidence an earlier one existed.
 * Approve and reject preserve the counter — they attest to a submission
 * rather than making one.
 */
version: u32;
}

/**
 * Lifecycle of a single milestone.
 */
export type MilestoneStatus = {tag: "Proposed", values: void} | {tag: "Submitted", values: void} | {tag: "Approved", values: void} | {tag: "Rejected", values: void};




export interface Client {
  /**
   * Construct and simulate a reject_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reject a submitted milestone. Only the project owner may call this.
   */
  reject_milestone: ({project_id, milestone_id, approver}: {project_id: string, milestone_id: string, approver: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a approve_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Approve a submitted milestone. Only the project owner may call this.
   */
  approve_milestone: ({project_id, milestone_id, approver}: {project_id: string, milestone_id: string, approver: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_project_ref transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a project reference owned by `owner`.
   * 
   * Requires `owner` auth. Errors with [`Error::ProjectExists`] if the id is
   * taken — deliberately, rather than upserting, so a client can treat that
   * error as "already registered" and carry on.
   */
  create_project_ref: ({project_id, owner}: {project_id: string, owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_milestone_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read the current record for a milestone.
   * 
   * Unauthenticated: an anchored hash is public by design, and that is what
   * makes it evidence a third party can check.
   */
  get_milestone_status: ({project_id, milestone_id}: {project_id: string, milestone_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<MilestoneRecord>>>

  /**
   * Construct and simulate a submit_milestone_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Attach a proof hash to a milestone and move it to [`MilestoneStatus::Submitted`].
   * 
   * Requires `submitter` auth. The milestone does not need to exist beforehand;
   * an unseen milestone is implicitly `Proposed`. A milestone that has already
   * been approved is terminal and cannot be re-submitted.
   */
  submit_milestone_proof: ({project_id, milestone_id, submitter, proof_hash}: {project_id: string, milestone_id: string, submitter: string, proof_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABgAAAC1BIHByb2plY3Qgd2l0aCB0aGlzIGlkIGlzIGFscmVhZHkgcmVnaXN0ZXJlZC4AAAAAAAANUHJvamVjdEV4aXN0cwAAAAAAAAEAAAAnTm8gcHJvamVjdCBpcyByZWdpc3RlcmVkIHVuZGVyIHRoaXMgaWQuAAAAAA9Qcm9qZWN0Tm90Rm91bmQAAAAAAgAAADtObyBtaWxlc3RvbmUgcmVjb3JkIGV4aXN0cyBmb3IgdGhpcyBwcm9qZWN0L21pbGVzdG9uZSBwYWlyLgAAAAARTWlsZXN0b25lTm90Rm91bmQAAAAAAAADAAAANUNhbGxlciBpcyBhdXRoZW50aWNhdGVkIGJ1dCBpcyBub3QgdGhlIHByb2plY3Qgb3duZXIuAAAAAAAADU5vdEF1dGhvcml6ZWQAAAAAAAAEAAAAPlRoZSBtaWxlc3RvbmUgaXMgbm90IGluIGEgc3RhdHVzIHRoYXQgcGVybWl0cyB0aGlzIHRyYW5zaXRpb24uAAAAAAANSW52YWxpZFN0YXR1cwAAAAAAAAUAAAAlQW4gaWRlbnRpZmllciBleGNlZWRzIFtgTUFYX0lEX0xFTmBdLgAAAAAAAAlJZFRvb0xvbmcAAAAAAAAG",
        "AAAAAgAAABhQZXJzaXN0ZW50IHN0b3JhZ2Uga2V5cy4AAAAAAAAAB0RhdGFLZXkAAAAAAgAAAAEAAAAsYHByb2plY3RfaWQgLT4gQWRkcmVzc2AgKHRoZSBwcm9qZWN0IG93bmVyKS4AAAAHUHJvamVjdAAAAAABAAAAEAAAAAEAAAAwYChwcm9qZWN0X2lkLCBtaWxlc3RvbmVfaWQpIC0+IE1pbGVzdG9uZVJlY29yZGAuAAAACU1pbGVzdG9uZQAAAAAAAAIAAAAQAAAAEA==",
        "AAAABQAAAAAAAAAAAAAADlByb29mU3VibWl0dGVkAAAAAAACAAAABHFkaXQAAAAGc3VibWl0AAAAAAAFAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAQAAAAAQAAAAAAAAAMbWlsZXN0b25lX2lkAAAAEAAAAAAAAAAAAAAACXN1Ym1pdHRlcgAAAAAAABMAAAAAAAAAAAAAAApwcm9vZl9oYXNoAAAAAAPuAAAAIAAAAAAAAAAAAAAAB3ZlcnNpb24AAAAABAAAAAAAAAAC",
        "AAAAAQAAADpUaGUgZnVsbCBvbi1jaGFpbiByZWNvcmQgZm9yIG9uZSBtaWxlc3RvbmUgb2Ygb25lIHByb2plY3QuAAAAAAAAAAAAD01pbGVzdG9uZVJlY29yZAAAAAAHAAAAAAAAAAxtaWxlc3RvbmVfaWQAAAAQAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAQAAAAJUhhc2ggb2YgdGhlIG9mZi1jaGFpbiBwcm9vZiBhcnRpZmFjdC4AAAAAAAAKcHJvb2ZfaGFzaAAAAAAD7gAAACAAAAAAAAAABnN0YXR1cwAAAAAH0AAAAA9NaWxlc3RvbmVTdGF0dXMAAAAAJkFkZHJlc3MgdGhhdCBzdWJtaXR0ZWQgdGhlIHByb29mIGhhc2guAAAAAAAJc3VibWl0dGVyAAAAAAAAEwAAADdMZWRnZXIgdGltZXN0YW1wIGF0IHRoZSBtb21lbnQgdGhlIHByb29mIHdhcyBzdWJtaXR0ZWQuAAAAAAl0aW1lc3RhbXAAAAAAAAAGAAABFlN1Ym1pc3Npb25zIHNvIGZhciwgc3RhcnRpbmcgYXQgMS4gTW9ub3RvbmljLgoKQSByZS1zdWJtaXNzaW9uIG92ZXJ3cml0ZXMgYHByb29mX2hhc2hgLCBzbyB3aXRob3V0IHRoaXMgdGhlIGxlZGdlcgp3b3VsZCBzaG93IHRoZSBsYXRlc3QgaGFzaCB3aXRoIG5vIGV2aWRlbmNlIGFuIGVhcmxpZXIgb25lIGV4aXN0ZWQuCkFwcHJvdmUgYW5kIHJlamVjdCBwcmVzZXJ2ZSB0aGUgY291bnRlciDigJQgdGhleSBhdHRlc3QgdG8gYSBzdWJtaXNzaW9uCnJhdGhlciB0aGFuIG1ha2luZyBvbmUuAAAAAAAHdmVyc2lvbgAAAAAE",
        "AAAAAgAAACBMaWZlY3ljbGUgb2YgYSBzaW5nbGUgbWlsZXN0b25lLgAAAAAAAAAPTWlsZXN0b25lU3RhdHVzAAAAAAQAAAAAAAAAJlJlZ2lzdGVyZWQgYnV0IG5vIHByb29mIHN1Ym1pdHRlZCB5ZXQuAAAAAAAIUHJvcG9zZWQAAAAAAAAAPFByb29mIGhhc2ggc3VibWl0dGVkLCBhd2FpdGluZyB0aGUgcHJvamVjdCBvd25lcidzIGRlY2lzaW9uLgAAAAlTdWJtaXR0ZWQAAAAAAAAAAAAAKEFjY2VwdGVkIGJ5IHRoZSBwcm9qZWN0IG93bmVyLiBUZXJtaW5hbC4AAAAIQXBwcm92ZWQAAAAAAAAAKFJlamVjdGVkIGJ5IHRoZSBwcm9qZWN0IG93bmVyLiBUZXJtaW5hbC4AAAAIUmVqZWN0ZWQ=",
        "AAAABQAAAAAAAAAAAAAAEU1pbGVzdG9uZUFwcHJvdmVkAAAAAAAAAgAAAARxZGl0AAAAB2FwcHJvdmUAAAAABAAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAEAAAAAAAAADG1pbGVzdG9uZV9pZAAAABAAAAAAAAAAAAAAAAhhcHByb3ZlcgAAABMAAAAAAAAAAAAAAAd2ZXJzaW9uAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEU1pbGVzdG9uZVJlamVjdGVkAAAAAAAAAgAAAARxZGl0AAAABnJlamVjdAAAAAAABAAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAEAAAAAAAAADG1pbGVzdG9uZV9pZAAAABAAAAAAAAAAAAAAAAhhcHByb3ZlcgAAABMAAAAAAAAAAAAAAAd2ZXJzaW9uAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAEVByb2plY3RSZWdpc3RlcmVkAAAAAAAAAgAAAARxZGl0AAAACHJlZ2lzdGVyAAAAAgAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAC",
        "AAAAAAAAAENSZWplY3QgYSBzdWJtaXR0ZWQgbWlsZXN0b25lLiBPbmx5IHRoZSBwcm9qZWN0IG93bmVyIG1heSBjYWxsIHRoaXMuAAAAABByZWplY3RfbWlsZXN0b25lAAAAAwAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAAAAAAMbWlsZXN0b25lX2lkAAAAEAAAAAAAAAAIYXBwcm92ZXIAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAERBcHByb3ZlIGEgc3VibWl0dGVkIG1pbGVzdG9uZS4gT25seSB0aGUgcHJvamVjdCBvd25lciBtYXkgY2FsbCB0aGlzLgAAABFhcHByb3ZlX21pbGVzdG9uZQAAAAAAAAMAAAAAAAAACnByb2plY3RfaWQAAAAAABAAAAAAAAAADG1pbGVzdG9uZV9pZAAAABAAAAAAAAAACGFwcHJvdmVyAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAO5SZWdpc3RlciBhIHByb2plY3QgcmVmZXJlbmNlIG93bmVkIGJ5IGBvd25lcmAuCgpSZXF1aXJlcyBgb3duZXJgIGF1dGguIEVycm9ycyB3aXRoIFtgRXJyb3I6OlByb2plY3RFeGlzdHNgXSBpZiB0aGUgaWQgaXMKdGFrZW4g4oCUIGRlbGliZXJhdGVseSwgcmF0aGVyIHRoYW4gdXBzZXJ0aW5nLCBzbyBhIGNsaWVudCBjYW4gdHJlYXQgdGhhdAplcnJvciBhcyAiYWxyZWFkeSByZWdpc3RlcmVkIiBhbmQgY2Fycnkgb24uAAAAAAASY3JlYXRlX3Byb2plY3RfcmVmAAAAAAACAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAQAAAAAAAAAAVvd25lcgAAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAJxSZWFkIHRoZSBjdXJyZW50IHJlY29yZCBmb3IgYSBtaWxlc3RvbmUuCgpVbmF1dGhlbnRpY2F0ZWQ6IGFuIGFuY2hvcmVkIGhhc2ggaXMgcHVibGljIGJ5IGRlc2lnbiwgYW5kIHRoYXQgaXMgd2hhdAptYWtlcyBpdCBldmlkZW5jZSBhIHRoaXJkIHBhcnR5IGNhbiBjaGVjay4AAAAUZ2V0X21pbGVzdG9uZV9zdGF0dXMAAAACAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAQAAAAAAAAAAxtaWxlc3RvbmVfaWQAAAAQAAAAAQAAA+kAAAfQAAAAD01pbGVzdG9uZVJlY29yZAAAAAAD",
        "AAAAAAAAAR9BdHRhY2ggYSBwcm9vZiBoYXNoIHRvIGEgbWlsZXN0b25lIGFuZCBtb3ZlIGl0IHRvIFtgTWlsZXN0b25lU3RhdHVzOjpTdWJtaXR0ZWRgXS4KClJlcXVpcmVzIGBzdWJtaXR0ZXJgIGF1dGguIFRoZSBtaWxlc3RvbmUgZG9lcyBub3QgbmVlZCB0byBleGlzdCBiZWZvcmVoYW5kOwphbiB1bnNlZW4gbWlsZXN0b25lIGlzIGltcGxpY2l0bHkgYFByb3Bvc2VkYC4gQSBtaWxlc3RvbmUgdGhhdCBoYXMgYWxyZWFkeQpiZWVuIGFwcHJvdmVkIGlzIHRlcm1pbmFsIGFuZCBjYW5ub3QgYmUgcmUtc3VibWl0dGVkLgAAAAAWc3VibWl0X21pbGVzdG9uZV9wcm9vZgAAAAAABAAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAAAAAAMbWlsZXN0b25lX2lkAAAAEAAAAAAAAAAJc3VibWl0dGVyAAAAAAAAEwAAAAAAAAAKcHJvb2ZfaGFzaAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD" ]),
      options
    )
  }
  public readonly fromJSON = {
    reject_milestone: this.txFromJSON<Result<void>>,
        approve_milestone: this.txFromJSON<Result<void>>,
        create_project_ref: this.txFromJSON<Result<void>>,
        get_milestone_status: this.txFromJSON<Result<MilestoneRecord>>,
        submit_milestone_proof: this.txFromJSON<Result<void>>
  }
}