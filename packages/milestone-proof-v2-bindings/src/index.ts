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
    contractId: "CDDIVHDM66BHZ3ZWHTYXSD5KHL4S5SJOALDSHR3UATRZ655POIKSBT6N",
  }
} as const

/**
 * Codes 1 to 6 mean what they mean in v1, so a client can share its handling.
 */
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
   * Caller is authenticated but may not do this: not the project owner, or
   * a member whose role does not allow the call.
   */
  4: {message:"NotAuthorized"},
  /**
   * The milestone is not in a status that permits this transition.
   */
  5: {message:"InvalidStatus"},
  /**
   * An identifier is longer than the id limit.
   */
  6: {message:"IdTooLong"},
  /**
   * Caller is authenticated but is not on the project's roster.
   */
  7: {message:"NotMember"},
  /**
   * This address has already approved this version of the milestone.
   */
  8: {message:"AlreadyApproved"},
  /**
   * The threshold is out of bounds, or this change would break it.
   */
  9: {message:"InvalidThreshold"},
  /**
   * The project's roster is full.
   */
  10: {message:"MemberLimit"},
  /**
   * A batch with this id is already anchored for this project.
   */
  11: {message:"BatchExists"},
  /**
   * The approver named a hash other than the milestone's current one.
   */
  12: {message:"ProofMismatch"},
  /**
   * No batch is anchored under this id for this project.
   */
  13: {message:"BatchNotFound"},
  /**
   * A batch's leaf count is 0 or over `MAX_BATCH_LEAVES`.
   */
  14: {message:"InvalidBatch"}
}










/**
 * What a member may do. Each address holds one role.
 */
export type Role = {tag: "Submitter", values: void} | {tag: "Approver", values: void};

/**
 * Persistent storage keys.
 */
export type DataKey = {tag: "Project", values: readonly [string]} | {tag: "Members", values: readonly [string]} | {tag: "Milestone", values: readonly [string, string]} | {tag: "Batch", values: readonly [string, string]};


/**
 * A registered project.
 */
export interface Project {
  owner: string;
  /**
 * Approvals a milestone needs to become [`MilestoneStatus::Approved`].
 */
threshold: u32;
}


/**
 * An anchored Merkle batch (`docs/merkle/SPEC.md`). Written once, never
 * replaced.
 */
export interface BatchRecord {
  /**
 * Leaves in the tree. Inclusion proofs derive their sides from it.
 */
leaf_count: u32;
  /**
 * Ledger sequence of the anchoring.
 */
ledger: u32;
  /**
 * Merkle root over the batch's milestone leaves.
 */
root: Buffer;
  /**
 * Address that anchored the batch.
 */
submitter: string;
  /**
 * Ledger timestamp of the anchoring.
 */
timestamp: u64;
}


/**
 * The on-chain record for one milestone of one project.
 */
export interface MilestoneRecord {
  /**
 * Addresses that approved this version, in order. Holds no duplicates.
 */
approvers: Array<string>;
  /**
 * Hash of the off-chain proof artifact.
 */
proof_hash: Buffer;
  status: MilestoneStatus;
  /**
 * Address that submitted this version.
 */
submitter: string;
  /**
 * Ledger timestamp of this version's submission.
 */
timestamp: u64;
  /**
 * Submissions so far, starting at 1. Monotonic.
 */
version: u32;
}

/**
 * Lifecycle of a single milestone.
 */
export type MilestoneStatus = {tag: "Proposed", values: void} | {tag: "Submitted", values: void} | {tag: "Approved", values: void} | {tag: "Rejected", values: void};

export interface Client {
  /**
   * Construct and simulate a get_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read an anchored batch's root, leaf count, submitter and ledger.
   */
  get_batch: ({project_id, batch_id}: {project_id: string, batch_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<BatchRecord>>>

  /**
   * Construct and simulate a add_member transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Add `member` with `role`, or change the role of an existing member.
   * 
   * Owner-signed. Refused with [`Error::MemberLimit`] on a full roster, and
   * with [`Error::InvalidThreshold`] if it changes an approver's role and
   * leaves fewer approvers than the threshold (D-106).
   */
  add_member: ({project_id, owner, member, role}: {project_id: string, owner: string, member: string, role: Role}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_members transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read a project's roster and each member's role.
   */
  get_members: ({project_id}: {project_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Map<string, Role>>>>

  /**
   * Construct and simulate a get_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read a project's owner and threshold.
   */
  get_project: ({project_id}: {project_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Project>>>

  /**
   * Construct and simulate a anchor_batch transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Anchor the Merkle root of a batch of milestone proofs in one call.
   * 
   * `submitter` must hold the `Submitter` role. `batch_id` is the caller's
   * and unique per project: reusing one is refused with
   * [`Error::BatchExists`], so an anchored root is never replaced.
   * `leaf_count` must be 1 to [`MAX_BATCH_LEAVES`], else
   * [`Error::InvalidBatch`]. No milestone changes status.
   */
  anchor_batch: ({project_id, batch_id, submitter, root, leaf_count}: {project_id: string, batch_id: string, submitter: string, root: Buffer, leaf_count: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_member transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove `member` from the roster.
   * 
   * Owner-signed. Refused with [`Error::NotMember`] if they aren't on it, and
   * with [`Error::InvalidThreshold`] if it leaves fewer approvers than the
   * threshold.
   */
  remove_member: ({project_id, owner, member}: {project_id: string, owner: string, member: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_threshold transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set how many approvals a milestone needs.
   * 
   * Owner-signed. `threshold` must be at least 1 and at most the current
   * approver count, else [`Error::InvalidThreshold`]. It changes no milestone
   * by itself: see "Lowering a threshold" in the crate README.
   */
  set_threshold: ({project_id, owner, threshold}: {project_id: string, owner: string, threshold: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a project owned by `owner`.
   * 
   * `threshold` must be at least 1. It may exceed the current approver count,
   * because a project has no approvers yet when it is created (D-104). A
   * milestone can't reach Approved until enough approvers exist.
   */
  create_project: ({project_id, owner, threshold}: {project_id: string, owner: string, threshold: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reject_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reject a submitted milestone. Any one approver can do this, and the
   * milestone can then be resubmitted. `proof_hash` works as it does for
   * [`Self::approve_milestone`].
   */
  reject_milestone: ({project_id, milestone_id, approver, proof_hash}: {project_id: string, milestone_id: string, approver: string, proof_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a verify_inclusion transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Check that a milestone proof is a leaf of an anchored batch.
   * 
   * Read-only. The leaf is rebuilt from `project_id`, `milestone_id` and
   * `proof_hash`. `path` is the sibling hashes, leaf level first, and every
   * side is derived from `index` and the stored leaf count. A wrong or
   * malformed proof is `false`; an unknown batch is [`Error::BatchNotFound`].
   */
  verify_inclusion: ({project_id, batch_id, milestone_id, proof_hash, index, path}: {project_id: string, batch_id: string, milestone_id: string, proof_hash: Buffer, index: u32, path: Array<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<boolean>>>

  /**
   * Construct and simulate a approve_milestone transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Record `approver`'s approval of a submitted milestone.
   * 
   * `approver` must hold the `Approver` role. The milestone becomes Approved
   * once the size of its approvers set reaches the threshold. An approval
   * given before the approver was removed still counts (D-105).
   * 
   * `proof_hash` is the hash the approver reviewed, and it is part of what they
   * sign. If it is no longer current, because a resubmission landed first, the
   * call is refused with [`Error::ProofMismatch`] (D-108).
   */
  approve_milestone: ({project_id, milestone_id, approver, proof_hash}: {project_id: string, milestone_id: string, approver: string, proof_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_milestone_status transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read a milestone's status, version, proof hash, submitter, submission
   * time and approvers.
   */
  get_milestone_status: ({project_id, milestone_id}: {project_id: string, milestone_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<MilestoneRecord>>>

  /**
   * Construct and simulate a submit_milestone_proof transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Attach a proof hash to a milestone and move it to
   * [`MilestoneStatus::Submitted`].
   * 
   * `submitter` must hold the `Submitter` role. A resubmission increments the
   * version and clears earlier approvals, so an approval never carries over to
   * a new hash. An Approved milestone can't be resubmitted.
   */
  submit_milestone_proof: ({project_id, milestone_id, submitter, proof_hash}: {project_id: string, milestone_id: string, submitter: string, proof_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a transfer_project_owner transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Hand a project to a new owner (D-107).
   * 
   * **Both parties must sign**, as in v1: the outgoing owner proves the right
   * to give it away, and the incoming owner proves the address is controlled.
   * The roster is unchanged, and the new owner gets no member role.
   */
  transfer_project_owner: ({project_id, current_owner, new_owner}: {project_id: string, current_owner: string, new_owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAAAAAAAEBSZWFkIGFuIGFuY2hvcmVkIGJhdGNoJ3Mgcm9vdCwgbGVhZiBjb3VudCwgc3VibWl0dGVyIGFuZCBsZWRnZXIuAAAACWdldF9iYXRjaAAAAAAAAAIAAAAAAAAACnByb2plY3RfaWQAAAAAABAAAAAAAAAACGJhdGNoX2lkAAAAEAAAAAEAAAPpAAAH0AAAAAtCYXRjaFJlY29yZAAAAAAD",
        "AAAAAAAAAQVBZGQgYG1lbWJlcmAgd2l0aCBgcm9sZWAsIG9yIGNoYW5nZSB0aGUgcm9sZSBvZiBhbiBleGlzdGluZyBtZW1iZXIuCgpPd25lci1zaWduZWQuIFJlZnVzZWQgd2l0aCBbYEVycm9yOjpNZW1iZXJMaW1pdGBdIG9uIGEgZnVsbCByb3N0ZXIsIGFuZAp3aXRoIFtgRXJyb3I6OkludmFsaWRUaHJlc2hvbGRgXSBpZiBpdCBjaGFuZ2VzIGFuIGFwcHJvdmVyJ3Mgcm9sZSBhbmQKbGVhdmVzIGZld2VyIGFwcHJvdmVycyB0aGFuIHRoZSB0aHJlc2hvbGQgKEQtMTA2KS4AAAAAAAAKYWRkX21lbWJlcgAAAAAABAAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAZtZW1iZXIAAAAAABMAAAAAAAAABHJvbGUAAAfQAAAABFJvbGUAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAC9SZWFkIGEgcHJvamVjdCdzIHJvc3RlciBhbmQgZWFjaCBtZW1iZXIncyByb2xlLgAAAAALZ2V0X21lbWJlcnMAAAAAAQAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAEAAAPpAAAD7AAAABMAAAfQAAAABFJvbGUAAAAD",
        "AAAAAAAAACVSZWFkIGEgcHJvamVjdCdzIG93bmVyIGFuZCB0aHJlc2hvbGQuAAAAAAAAC2dldF9wcm9qZWN0AAAAAAEAAAAAAAAACnByb2plY3RfaWQAAAAAABAAAAABAAAD6QAAB9AAAAAHUHJvamVjdAAAAAAD",
        "AAAAAAAAAWhBbmNob3IgdGhlIE1lcmtsZSByb290IG9mIGEgYmF0Y2ggb2YgbWlsZXN0b25lIHByb29mcyBpbiBvbmUgY2FsbC4KCmBzdWJtaXR0ZXJgIG11c3QgaG9sZCB0aGUgYFN1Ym1pdHRlcmAgcm9sZS4gYGJhdGNoX2lkYCBpcyB0aGUgY2FsbGVyJ3MKYW5kIHVuaXF1ZSBwZXIgcHJvamVjdDogcmV1c2luZyBvbmUgaXMgcmVmdXNlZCB3aXRoCltgRXJyb3I6OkJhdGNoRXhpc3RzYF0sIHNvIGFuIGFuY2hvcmVkIHJvb3QgaXMgbmV2ZXIgcmVwbGFjZWQuCmBsZWFmX2NvdW50YCBtdXN0IGJlIDEgdG8gW2BNQVhfQkFUQ0hfTEVBVkVTYF0sIGVsc2UKW2BFcnJvcjo6SW52YWxpZEJhdGNoYF0uIE5vIG1pbGVzdG9uZSBjaGFuZ2VzIHN0YXR1cy4AAAAMYW5jaG9yX2JhdGNoAAAABQAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAAAAAAIYmF0Y2hfaWQAAAAQAAAAAAAAAAlzdWJtaXR0ZXIAAAAAAAATAAAAAAAAAARyb290AAAD7gAAACAAAAAAAAAACmxlYWZfY291bnQAAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAL1SZW1vdmUgYG1lbWJlcmAgZnJvbSB0aGUgcm9zdGVyLgoKT3duZXItc2lnbmVkLiBSZWZ1c2VkIHdpdGggW2BFcnJvcjo6Tm90TWVtYmVyYF0gaWYgdGhleSBhcmVuJ3Qgb24gaXQsIGFuZAp3aXRoIFtgRXJyb3I6OkludmFsaWRUaHJlc2hvbGRgXSBpZiBpdCBsZWF2ZXMgZmV3ZXIgYXBwcm92ZXJzIHRoYW4gdGhlCnRocmVzaG9sZC4AAAAAAAANcmVtb3ZlX21lbWJlcgAAAAAAAAMAAAAAAAAACnByb2plY3RfaWQAAAAAABAAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAGbWVtYmVyAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAPRTZXQgaG93IG1hbnkgYXBwcm92YWxzIGEgbWlsZXN0b25lIG5lZWRzLgoKT3duZXItc2lnbmVkLiBgdGhyZXNob2xkYCBtdXN0IGJlIGF0IGxlYXN0IDEgYW5kIGF0IG1vc3QgdGhlIGN1cnJlbnQKYXBwcm92ZXIgY291bnQsIGVsc2UgW2BFcnJvcjo6SW52YWxpZFRocmVzaG9sZGBdLiBJdCBjaGFuZ2VzIG5vIG1pbGVzdG9uZQpieSBpdHNlbGY6IHNlZSAiTG93ZXJpbmcgYSB0aHJlc2hvbGQiIGluIHRoZSBjcmF0ZSBSRUFETUUuAAAADXNldF90aHJlc2hvbGQAAAAAAAADAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAQAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACXRocmVzaG9sZAAAAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAPFSZWdpc3RlciBhIHByb2plY3Qgb3duZWQgYnkgYG93bmVyYC4KCmB0aHJlc2hvbGRgIG11c3QgYmUgYXQgbGVhc3QgMS4gSXQgbWF5IGV4Y2VlZCB0aGUgY3VycmVudCBhcHByb3ZlciBjb3VudCwKYmVjYXVzZSBhIHByb2plY3QgaGFzIG5vIGFwcHJvdmVycyB5ZXQgd2hlbiBpdCBpcyBjcmVhdGVkIChELTEwNCkuIEEKbWlsZXN0b25lIGNhbid0IHJlYWNoIEFwcHJvdmVkIHVudGlsIGVub3VnaCBhcHByb3ZlcnMgZXhpc3QuAAAAAAAADmNyZWF0ZV9wcm9qZWN0AAAAAAADAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAQAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACXRocmVzaG9sZAAAAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAKVSZWplY3QgYSBzdWJtaXR0ZWQgbWlsZXN0b25lLiBBbnkgb25lIGFwcHJvdmVyIGNhbiBkbyB0aGlzLCBhbmQgdGhlCm1pbGVzdG9uZSBjYW4gdGhlbiBiZSByZXN1Ym1pdHRlZC4gYHByb29mX2hhc2hgIHdvcmtzIGFzIGl0IGRvZXMgZm9yCltgU2VsZjo6YXBwcm92ZV9taWxlc3RvbmVgXS4AAAAAAAAQcmVqZWN0X21pbGVzdG9uZQAAAAQAAAAAAAAACnByb2plY3RfaWQAAAAAABAAAAAAAAAADG1pbGVzdG9uZV9pZAAAABAAAAAAAAAACGFwcHJvdmVyAAAAEwAAAAAAAAAKcHJvb2ZfaGFzaAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAVdDaGVjayB0aGF0IGEgbWlsZXN0b25lIHByb29mIGlzIGEgbGVhZiBvZiBhbiBhbmNob3JlZCBiYXRjaC4KClJlYWQtb25seS4gVGhlIGxlYWYgaXMgcmVidWlsdCBmcm9tIGBwcm9qZWN0X2lkYCwgYG1pbGVzdG9uZV9pZGAgYW5kCmBwcm9vZl9oYXNoYC4gYHBhdGhgIGlzIHRoZSBzaWJsaW5nIGhhc2hlcywgbGVhZiBsZXZlbCBmaXJzdCwgYW5kIGV2ZXJ5CnNpZGUgaXMgZGVyaXZlZCBmcm9tIGBpbmRleGAgYW5kIHRoZSBzdG9yZWQgbGVhZiBjb3VudC4gQSB3cm9uZyBvcgptYWxmb3JtZWQgcHJvb2YgaXMgYGZhbHNlYDsgYW4gdW5rbm93biBiYXRjaCBpcyBbYEVycm9yOjpCYXRjaE5vdEZvdW5kYF0uAAAAABB2ZXJpZnlfaW5jbHVzaW9uAAAABgAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAAAAAAIYmF0Y2hfaWQAAAAQAAAAAAAAAAxtaWxlc3RvbmVfaWQAAAAQAAAAAAAAAApwcm9vZl9oYXNoAAAAAAPuAAAAIAAAAAAAAAAFaW5kZXgAAAAAAAAEAAAAAAAAAARwYXRoAAAD6gAAA+4AAAAgAAAAAQAAA+kAAAABAAAAAw==",
        "AAAAAAAAAdFSZWNvcmQgYGFwcHJvdmVyYCdzIGFwcHJvdmFsIG9mIGEgc3VibWl0dGVkIG1pbGVzdG9uZS4KCmBhcHByb3ZlcmAgbXVzdCBob2xkIHRoZSBgQXBwcm92ZXJgIHJvbGUuIFRoZSBtaWxlc3RvbmUgYmVjb21lcyBBcHByb3ZlZApvbmNlIHRoZSBzaXplIG9mIGl0cyBhcHByb3ZlcnMgc2V0IHJlYWNoZXMgdGhlIHRocmVzaG9sZC4gQW4gYXBwcm92YWwKZ2l2ZW4gYmVmb3JlIHRoZSBhcHByb3ZlciB3YXMgcmVtb3ZlZCBzdGlsbCBjb3VudHMgKEQtMTA1KS4KCmBwcm9vZl9oYXNoYCBpcyB0aGUgaGFzaCB0aGUgYXBwcm92ZXIgcmV2aWV3ZWQsIGFuZCBpdCBpcyBwYXJ0IG9mIHdoYXQgdGhleQpzaWduLiBJZiBpdCBpcyBubyBsb25nZXIgY3VycmVudCwgYmVjYXVzZSBhIHJlc3VibWlzc2lvbiBsYW5kZWQgZmlyc3QsIHRoZQpjYWxsIGlzIHJlZnVzZWQgd2l0aCBbYEVycm9yOjpQcm9vZk1pc21hdGNoYF0gKEQtMTA4KS4AAAAAAAARYXBwcm92ZV9taWxlc3RvbmUAAAAAAAAEAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAQAAAAAAAAAAxtaWxlc3RvbmVfaWQAAAAQAAAAAAAAAAhhcHByb3ZlcgAAABMAAAAAAAAACnByb29mX2hhc2gAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAFlSZWFkIGEgbWlsZXN0b25lJ3Mgc3RhdHVzLCB2ZXJzaW9uLCBwcm9vZiBoYXNoLCBzdWJtaXR0ZXIsIHN1Ym1pc3Npb24KdGltZSBhbmQgYXBwcm92ZXJzLgAAAAAAABRnZXRfbWlsZXN0b25lX3N0YXR1cwAAAAIAAAAAAAAACnByb2plY3RfaWQAAAAAABAAAAAAAAAADG1pbGVzdG9uZV9pZAAAABAAAAABAAAD6QAAB9AAAAAPTWlsZXN0b25lUmVjb3JkAAAAAAM=",
        "AAAAAAAAAR9BdHRhY2ggYSBwcm9vZiBoYXNoIHRvIGEgbWlsZXN0b25lIGFuZCBtb3ZlIGl0IHRvCltgTWlsZXN0b25lU3RhdHVzOjpTdWJtaXR0ZWRgXS4KCmBzdWJtaXR0ZXJgIG11c3QgaG9sZCB0aGUgYFN1Ym1pdHRlcmAgcm9sZS4gQSByZXN1Ym1pc3Npb24gaW5jcmVtZW50cyB0aGUKdmVyc2lvbiBhbmQgY2xlYXJzIGVhcmxpZXIgYXBwcm92YWxzLCBzbyBhbiBhcHByb3ZhbCBuZXZlciBjYXJyaWVzIG92ZXIgdG8KYSBuZXcgaGFzaC4gQW4gQXBwcm92ZWQgbWlsZXN0b25lIGNhbid0IGJlIHJlc3VibWl0dGVkLgAAAAAWc3VibWl0X21pbGVzdG9uZV9wcm9vZgAAAAAABAAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAAAAAAMbWlsZXN0b25lX2lkAAAAEAAAAAAAAAAJc3VibWl0dGVyAAAAAAAAEwAAAAAAAAAKcHJvb2ZfaGFzaAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAPtIYW5kIGEgcHJvamVjdCB0byBhIG5ldyBvd25lciAoRC0xMDcpLgoKKipCb3RoIHBhcnRpZXMgbXVzdCBzaWduKiosIGFzIGluIHYxOiB0aGUgb3V0Z29pbmcgb3duZXIgcHJvdmVzIHRoZSByaWdodAp0byBnaXZlIGl0IGF3YXksIGFuZCB0aGUgaW5jb21pbmcgb3duZXIgcHJvdmVzIHRoZSBhZGRyZXNzIGlzIGNvbnRyb2xsZWQuClRoZSByb3N0ZXIgaXMgdW5jaGFuZ2VkLCBhbmQgdGhlIG5ldyBvd25lciBnZXRzIG5vIG1lbWJlciByb2xlLgAAAAAWdHJhbnNmZXJfcHJvamVjdF9vd25lcgAAAAAAAwAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAAAAAANY3VycmVudF9vd25lcgAAAAAAABMAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAABAAAAEtDb2RlcyAxIHRvIDYgbWVhbiB3aGF0IHRoZXkgbWVhbiBpbiB2MSwgc28gYSBjbGllbnQgY2FuIHNoYXJlIGl0cyBoYW5kbGluZy4AAAAAAAAAAAVFcnJvcgAAAAAAAA4AAAAtQSBwcm9qZWN0IHdpdGggdGhpcyBpZCBpcyBhbHJlYWR5IHJlZ2lzdGVyZWQuAAAAAAAADVByb2plY3RFeGlzdHMAAAAAAAABAAAAJ05vIHByb2plY3QgaXMgcmVnaXN0ZXJlZCB1bmRlciB0aGlzIGlkLgAAAAAPUHJvamVjdE5vdEZvdW5kAAAAAAIAAAA7Tm8gbWlsZXN0b25lIHJlY29yZCBleGlzdHMgZm9yIHRoaXMgcHJvamVjdC9taWxlc3RvbmUgcGFpci4AAAAAEU1pbGVzdG9uZU5vdEZvdW5kAAAAAAAAAwAAAHNDYWxsZXIgaXMgYXV0aGVudGljYXRlZCBidXQgbWF5IG5vdCBkbyB0aGlzOiBub3QgdGhlIHByb2plY3Qgb3duZXIsIG9yCmEgbWVtYmVyIHdob3NlIHJvbGUgZG9lcyBub3QgYWxsb3cgdGhlIGNhbGwuAAAAAA1Ob3RBdXRob3JpemVkAAAAAAAABAAAAD5UaGUgbWlsZXN0b25lIGlzIG5vdCBpbiBhIHN0YXR1cyB0aGF0IHBlcm1pdHMgdGhpcyB0cmFuc2l0aW9uLgAAAAAADUludmFsaWRTdGF0dXMAAAAAAAAFAAAAKkFuIGlkZW50aWZpZXIgaXMgbG9uZ2VyIHRoYW4gdGhlIGlkIGxpbWl0LgAAAAAACUlkVG9vTG9uZwAAAAAAAAYAAAA7Q2FsbGVyIGlzIGF1dGhlbnRpY2F0ZWQgYnV0IGlzIG5vdCBvbiB0aGUgcHJvamVjdCdzIHJvc3Rlci4AAAAACU5vdE1lbWJlcgAAAAAAAAcAAABAVGhpcyBhZGRyZXNzIGhhcyBhbHJlYWR5IGFwcHJvdmVkIHRoaXMgdmVyc2lvbiBvZiB0aGUgbWlsZXN0b25lLgAAAA9BbHJlYWR5QXBwcm92ZWQAAAAACAAAAD5UaGUgdGhyZXNob2xkIGlzIG91dCBvZiBib3VuZHMsIG9yIHRoaXMgY2hhbmdlIHdvdWxkIGJyZWFrIGl0LgAAAAAAEEludmFsaWRUaHJlc2hvbGQAAAAJAAAAHVRoZSBwcm9qZWN0J3Mgcm9zdGVyIGlzIGZ1bGwuAAAAAAAAC01lbWJlckxpbWl0AAAAAAoAAAA6QSBiYXRjaCB3aXRoIHRoaXMgaWQgaXMgYWxyZWFkeSBhbmNob3JlZCBmb3IgdGhpcyBwcm9qZWN0LgAAAAAAC0JhdGNoRXhpc3RzAAAAAAsAAABBVGhlIGFwcHJvdmVyIG5hbWVkIGEgaGFzaCBvdGhlciB0aGFuIHRoZSBtaWxlc3RvbmUncyBjdXJyZW50IG9uZS4AAAAAAAANUHJvb2ZNaXNtYXRjaAAAAAAAAAwAAAA0Tm8gYmF0Y2ggaXMgYW5jaG9yZWQgdW5kZXIgdGhpcyBpZCBmb3IgdGhpcyBwcm9qZWN0LgAAAA1CYXRjaE5vdEZvdW5kAAAAAAAADQAAADVBIGJhdGNoJ3MgbGVhZiBjb3VudCBpcyAwIG9yIG92ZXIgYE1BWF9CQVRDSF9MRUFWRVNgLgAAAAAAAAxJbnZhbGlkQmF0Y2gAAAAO",
        "AAAABQAAAGNFbWl0dGVkIHdoZW4gYSBtZW1iZXIgaXMgYWRkZWQgb3IgdGhlaXIgcm9sZSBjaGFuZ2VzLiBgcm9sZWAgaXMgdGhlIHJvbGUKdGhleSBob2xkIGFmdGVyIHRoaXMgY2FsbC4AAAAAAAAAAAtNZW1iZXJBZGRlZAAAAAACAAAABHFkaXQAAAAKYWRkX21lbWJlcgAAAAAAAwAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAEAAAAAAAAABm1lbWJlcgAAAAAAEwAAAAAAAAAAAAAABHJvbGUAAAfQAAAABFJvbGUAAAAAAAAAAg==",
        "AAAABQAAAEhFbWl0dGVkIHdoZW4gYSBNZXJrbGUgYmF0Y2ggcm9vdCBpcyBhbmNob3JlZC4gVGhlIGxlYXZlcyBzdGF5IG9mZiBjaGFpbi4AAAAAAAAADUJhdGNoQW5jaG9yZWQAAAAAAAACAAAABHFkaXQAAAAFYmF0Y2gAAAAAAAAGAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAQAAAAAQAAAAAAAAAIYmF0Y2hfaWQAAAAQAAAAAAAAAAAAAAAJc3VibWl0dGVyAAAAAAAAEwAAAAAAAAAAAAAABHJvb3QAAAPuAAAAIAAAAAAAAAAAAAAACmxlYWZfY291bnQAAAAAAAQAAAAAAAAAAAAAAAl0aW1lc3RhbXAAAAAAAAAGAAAAAAAAAAI=",
        "AAAABQAAADNgcm9sZWAgaXMgdGhlIHJvbGUgdGhlIG1lbWJlciBoZWxkIHVudGlsIHRoaXMgY2FsbC4AAAAAAAAAAA1NZW1iZXJSZW1vdmVkAAAAAAAAAgAAAARxZGl0AAAADXJlbW92ZV9tZW1iZXIAAAAAAAADAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAQAAAAAQAAAAAAAAAGbWVtYmVyAAAAAAATAAAAAAAAAAAAAAAEcm9sZQAAB9AAAAAEUm9sZQAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADlByb2plY3RDcmVhdGVkAAAAAAACAAAABHFkaXQAAAAGY3JlYXRlAAAAAAADAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAQAAAAAQAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAAAAAAJdGhyZXNob2xkAAAAAAAABAAAAAAAAAAC",
        "AAAABQAAAD5BIHN1Ym1pc3Npb24gYWxzbyBjbGVhcnMgdGhlIGFwcHJvdmVycyBvZiBhbnkgZWFybGllciB2ZXJzaW9uLgAAAAAAAAAAAA5Qcm9vZlN1Ym1pdHRlZAAAAAAAAgAAAARxZGl0AAAABnN1Ym1pdAAAAAAABgAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAEAAAAAAAAADG1pbGVzdG9uZV9pZAAAABAAAAAAAAAAAAAAAAlzdWJtaXR0ZXIAAAAAAAATAAAAAAAAAAAAAAAKcHJvb2ZfaGFzaAAAAAAD7gAAACAAAAAAAAAAAAAAAAd2ZXJzaW9uAAAAAAQAAAAAAAAAAAAAAAl0aW1lc3RhbXAAAAAAAAAGAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEFRocmVzaG9sZENoYW5nZWQAAAACAAAABHFkaXQAAAAJdGhyZXNob2xkAAAAAAAAAgAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAEAAAAAAAAACXRocmVzaG9sZAAAAAAAAAQAAAAAAAAAAg==",
        "AAAABQAAAIhPbmUgYXBwcm92YWwuIGBzdGF0dXNgIGlzIHRoZSBtaWxlc3RvbmUncyBzdGF0dXMgYWZ0ZXIgaXQ6IEFwcHJvdmVkIHdoZW4gdGhpcwphcHByb3ZhbCByZWFjaGVkIHRoZSB0aHJlc2hvbGQsIG90aGVyd2lzZSBzdGlsbCBTdWJtaXR0ZWQuAAAAAAAAABFNaWxlc3RvbmVBcHByb3ZlZAAAAAAAAAIAAAAEcWRpdAAAAAdhcHByb3ZlAAAAAAYAAAAAAAAACnByb2plY3RfaWQAAAAAABAAAAABAAAAAAAAAAxtaWxlc3RvbmVfaWQAAAAQAAAAAAAAAAAAAAAIYXBwcm92ZXIAAAATAAAAAAAAAAAAAAAHdmVyc2lvbgAAAAAEAAAAAAAAACtUaGUgaGFzaCB0aGUgYXBwcm92ZXIgbmFtZWQgYW5kIHNpZ25lZCBmb3IuAAAAAApwcm9vZl9oYXNoAAAAAAPuAAAAIAAAAAAAAAAAAAAABnN0YXR1cwAAAAAH0AAAAA9NaWxlc3RvbmVTdGF0dXMAAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEU1pbGVzdG9uZVJlamVjdGVkAAAAAAAAAgAAAARxZGl0AAAABnJlamVjdAAAAAAABQAAAAAAAAAKcHJvamVjdF9pZAAAAAAAEAAAAAEAAAAAAAAADG1pbGVzdG9uZV9pZAAAABAAAAAAAAAAAAAAAAhhcHByb3ZlcgAAABMAAAAAAAAAAAAAAAd2ZXJzaW9uAAAAAAQAAAAAAAAAK1RoZSBoYXNoIHRoZSBhcHByb3ZlciBuYW1lZCBhbmQgc2lnbmVkIGZvci4AAAAACnByb29mX2hhc2gAAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAABQAAACVFbWl0dGVkIHdoZW4gYSBwcm9qZWN0IGNoYW5nZXMgaGFuZHMuAAAAAAAAAAAAABdQcm9qZWN0T3duZXJUcmFuc2ZlcnJlZAAAAAACAAAABHFkaXQAAAAIdHJhbnNmZXIAAAADAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAQAAAAAQAAAAAAAAAOcHJldmlvdXNfb3duZXIAAAAAABMAAAAAAAAAAAAAAAluZXdfb3duZXIAAAAAAAATAAAAAAAAAAI=",
        "AAAAAgAAADJXaGF0IGEgbWVtYmVyIG1heSBkby4gRWFjaCBhZGRyZXNzIGhvbGRzIG9uZSByb2xlLgAAAAAAAAAAAARSb2xlAAAAAgAAAAAAAAAAAAAACVN1Ym1pdHRlcgAAAAAAAAAAAAAAAAAACEFwcHJvdmVy",
        "AAAAAgAAABhQZXJzaXN0ZW50IHN0b3JhZ2Uga2V5cy4AAAAAAAAAB0RhdGFLZXkAAAAABAAAAAEAAAAYYHByb2plY3RfaWQgLT4gUHJvamVjdGAuAAAAB1Byb2plY3QAAAAAAQAAABAAAAABAAAAOWBwcm9qZWN0X2lkIC0+IE1hcDxBZGRyZXNzLCBSb2xlPmAsIHRoZSBwcm9qZWN0J3Mgcm9zdGVyLgAAAAAAAAdNZW1iZXJzAAAAAAEAAAAQAAAAAQAAADBgKHByb2plY3RfaWQsIG1pbGVzdG9uZV9pZCkgLT4gTWlsZXN0b25lUmVjb3JkYC4AAAAJTWlsZXN0b25lAAAAAAAAAgAAABAAAAAQAAAAAQAAAChgKHByb2plY3RfaWQsIGJhdGNoX2lkKSAtPiBCYXRjaFJlY29yZGAuAAAABUJhdGNoAAAAAAAAAgAAABAAAAAQ",
        "AAAAAQAAABVBIHJlZ2lzdGVyZWQgcHJvamVjdC4AAAAAAAAAAAAAB1Byb2plY3QAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAREFwcHJvdmFscyBhIG1pbGVzdG9uZSBuZWVkcyB0byBiZWNvbWUgW2BNaWxlc3RvbmVTdGF0dXM6OkFwcHJvdmVkYF0uAAAACXRocmVzaG9sZAAAAAAAAAQ=",
        "AAAAAQAAAE9BbiBhbmNob3JlZCBNZXJrbGUgYmF0Y2ggKGBkb2NzL21lcmtsZS9TUEVDLm1kYCkuIFdyaXR0ZW4gb25jZSwgbmV2ZXIKcmVwbGFjZWQuAAAAAAAAAAALQmF0Y2hSZWNvcmQAAAAABQAAAEBMZWF2ZXMgaW4gdGhlIHRyZWUuIEluY2x1c2lvbiBwcm9vZnMgZGVyaXZlIHRoZWlyIHNpZGVzIGZyb20gaXQuAAAACmxlYWZfY291bnQAAAAAAAQAAAAhTGVkZ2VyIHNlcXVlbmNlIG9mIHRoZSBhbmNob3JpbmcuAAAAAAAABmxlZGdlcgAAAAAABAAAAC5NZXJrbGUgcm9vdCBvdmVyIHRoZSBiYXRjaCdzIG1pbGVzdG9uZSBsZWF2ZXMuAAAAAAAEcm9vdAAAA+4AAAAgAAAAIEFkZHJlc3MgdGhhdCBhbmNob3JlZCB0aGUgYmF0Y2guAAAACXN1Ym1pdHRlcgAAAAAAABMAAAAiTGVkZ2VyIHRpbWVzdGFtcCBvZiB0aGUgYW5jaG9yaW5nLgAAAAAACXRpbWVzdGFtcAAAAAAAAAY=",
        "AAAAAQAAADVUaGUgb24tY2hhaW4gcmVjb3JkIGZvciBvbmUgbWlsZXN0b25lIG9mIG9uZSBwcm9qZWN0LgAAAAAAAAAAAAAPTWlsZXN0b25lUmVjb3JkAAAAAAYAAABEQWRkcmVzc2VzIHRoYXQgYXBwcm92ZWQgdGhpcyB2ZXJzaW9uLCBpbiBvcmRlci4gSG9sZHMgbm8gZHVwbGljYXRlcy4AAAAJYXBwcm92ZXJzAAAAAAAD6gAAABMAAAAlSGFzaCBvZiB0aGUgb2ZmLWNoYWluIHByb29mIGFydGlmYWN0LgAAAAAAAApwcm9vZl9oYXNoAAAAAAPuAAAAIAAAAAAAAAAGc3RhdHVzAAAAAAfQAAAAD01pbGVzdG9uZVN0YXR1cwAAAAAkQWRkcmVzcyB0aGF0IHN1Ym1pdHRlZCB0aGlzIHZlcnNpb24uAAAACXN1Ym1pdHRlcgAAAAAAABMAAAAuTGVkZ2VyIHRpbWVzdGFtcCBvZiB0aGlzIHZlcnNpb24ncyBzdWJtaXNzaW9uLgAAAAAACXRpbWVzdGFtcAAAAAAAAAYAAAAtU3VibWlzc2lvbnMgc28gZmFyLCBzdGFydGluZyBhdCAxLiBNb25vdG9uaWMuAAAAAAAAB3ZlcnNpb24AAAAABA==",
        "AAAAAgAAACBMaWZlY3ljbGUgb2YgYSBzaW5nbGUgbWlsZXN0b25lLgAAAAAAAAAPTWlsZXN0b25lU3RhdHVzAAAAAAQAAAAAAAAAJlJlZ2lzdGVyZWQgYnV0IG5vIHByb29mIHN1Ym1pdHRlZCB5ZXQuAAAAAAAIUHJvcG9zZWQAAAAAAAAAK1Byb29mIGhhc2ggc3VibWl0dGVkLCBjb2xsZWN0aW5nIGFwcHJvdmFscy4AAAAACVN1Ym1pdHRlZAAAAAAAAAAAAAAkVGhlIHRocmVzaG9sZCB3YXMgcmVhY2hlZC4gVGVybWluYWwuAAAACEFwcHJvdmVkAAAAAAAAADlBbiBhcHByb3ZlciByZWplY3RlZCB0aGlzIHZlcnNpb24uIEl0IG1heSBiZSByZXN1Ym1pdHRlZC4AAAAAAAAIUmVqZWN0ZWQ=" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_batch: this.txFromJSON<Result<BatchRecord>>,
        add_member: this.txFromJSON<Result<void>>,
        get_members: this.txFromJSON<Result<Map<string, Role>>>,
        get_project: this.txFromJSON<Result<Project>>,
        anchor_batch: this.txFromJSON<Result<void>>,
        remove_member: this.txFromJSON<Result<void>>,
        set_threshold: this.txFromJSON<Result<void>>,
        create_project: this.txFromJSON<Result<void>>,
        reject_milestone: this.txFromJSON<Result<void>>,
        verify_inclusion: this.txFromJSON<Result<boolean>>,
        approve_milestone: this.txFromJSON<Result<void>>,
        get_milestone_status: this.txFromJSON<Result<MilestoneRecord>>,
        submit_milestone_proof: this.txFromJSON<Result<void>>,
        transfer_project_owner: this.txFromJSON<Result<void>>
  }
}