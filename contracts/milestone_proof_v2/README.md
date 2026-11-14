# `milestone_proof_v2`

On-chain team roles, M-of-N milestone approval and Merkle batch anchoring. A new contract beside
[`milestone_proof`](../milestone_proof), not an upgrade of it: v1 and its records are
not touched, and the app and doqtri stay on v1. Testnet only for now: the current
contract id, its wasm hash and how to check it are in [`DEPLOYMENTS.md`](./DEPLOYMENTS.md),
and the TypeScript client is
[`@qdit/milestone-proof-v2-bindings`](../../packages/milestone-proof-v2-bindings).

It has no admin, no privileged override and no upgrade entry point. Every write
requires the acting address's signature and reads roles and the owner from storage,
never from an argument.

## Interface

| Function | Auth | Refused with |
| --- | --- | --- |
| `create_project(project_id, owner, threshold)` | `owner` | `ProjectExists`; `InvalidThreshold` on 0 |
| `add_member(project_id, owner, member, role)` | `owner` | `ProjectNotFound`, `NotAuthorized`, `MemberLimit`; `InvalidThreshold` when demoting an approver leaves too few |
| `remove_member(project_id, owner, member)` | `owner` | `ProjectNotFound`, `NotAuthorized`, `NotMember`; `InvalidThreshold` when removing an approver leaves too few |
| `set_threshold(project_id, owner, threshold)` | `owner` | `ProjectNotFound`, `NotAuthorized`; `InvalidThreshold` unless 1 to the approver count |
| `transfer_project_owner(project_id, current_owner, new_owner)` | **both** | `ProjectNotFound`, `NotAuthorized` |
| `submit_milestone_proof(project_id, milestone_id, submitter, proof_hash)` | `submitter`, role `Submitter` | `ProjectNotFound`, `NotMember`, `NotAuthorized`, `InvalidStatus` |
| `approve_milestone(project_id, milestone_id, approver, proof_hash)` | `approver`, role `Approver` | `ProjectNotFound`, `NotMember`, `NotAuthorized`, `MilestoneNotFound`, `InvalidStatus`, `ProofMismatch`, `AlreadyApproved` |
| `reject_milestone(project_id, milestone_id, approver, proof_hash)` | `approver`, role `Approver` | `ProjectNotFound`, `NotMember`, `NotAuthorized`, `MilestoneNotFound`, `InvalidStatus`, `ProofMismatch` |
| `get_project(project_id)` | none | `ProjectNotFound` |
| `get_members(project_id)` | none | `ProjectNotFound` |
| `get_milestone_status(project_id, milestone_id)` | none | `MilestoneNotFound` |
| `anchor_batch(project_id, batch_id, submitter, root, leaf_count)` | `submitter`, role `Submitter` | `ProjectNotFound`, `NotMember`, `NotAuthorized`, `InvalidBatch`, `BatchExists` |
| `get_batch(project_id, batch_id)` | none | `BatchNotFound` |
| `verify_inclusion(project_id, batch_id, milestone_id, version, proof_hash, index, path) -> bool` | none | `BatchNotFound` |

Every call also refuses an id over 64 characters with `IdTooLong`.

Errors: `ProjectExists = 1`, `ProjectNotFound = 2`, `MilestoneNotFound = 3`,
`NotAuthorized = 4`, `InvalidStatus = 5`, `IdTooLong = 6`, `NotMember = 7`,
`AlreadyApproved = 8`, `InvalidThreshold = 9`, `MemberLimit = 10`, `BatchExists = 11`,
`ProofMismatch = 12`, `BatchNotFound = 13`, `InvalidBatch = 14`. Off the roster is `NotMember`;
on it with the wrong role is `NotAuthorized`.

## Rules

- **Roles.** Each address holds one role, `Submitter` or `Approver`. `add_member` on an
  existing member changes their role. A roster holds at most 20 members.
- **The owner is not a member.** Owning a project controls the roster and threshold. To
  submit or approve, the owner has to add themselves with a role.
- **Threshold at creation (D-104).** `create_project` accepts a threshold above the
  current approver count, because a project starts with no approvers. A milestone can't
  reach Approved until enough approvers exist.
- **Keeping the threshold reachable (D-106).** Removing an approver, or changing them to
  another role, is refused if it leaves fewer approvers than the threshold.
- **Removed approvers (D-105).** An approval given before the approver was removed or
  demoted still counts, and their address stays in the set. They can't give a new
  approval. To cancel an approval from a removed key, resubmit the milestone. Because of
  this a set can hold up to 21 addresses, one more than the roster cap.
- **Resubmission.** It increments `version`, restamps `timestamp` and clears the
  approvers, so an approval never carries over to a new hash. It is allowed from
  Submitted or Rejected. Approved is terminal.
- **Approving a hash (D-108).** `approve_milestone` and `reject_milestone` name the hash
  the approver reviewed, and it is part of what they sign. If a resubmission replaced it
  first, the call is refused with `ProofMismatch`, so nobody approves a hash they didn't
  see. This differs from the signature in the SOW (section 3.7).
- **Rejection.** Any one approver can reject. The approvers set stays readable until a
  resubmission clears it.
- **Transfer (D-107).** Both owners sign, as in v1. The roster is unchanged, and the new
  owner gets no member role.

### Lowering a threshold

`set_threshold` changes no milestone by itself, because a write can't walk every
milestone. A milestone that now meets the lower threshold stays Submitted until the next
approval, which moves it to Approved.

If every current approver has already approved, they get `AlreadyApproved`. The milestone
stays Submitted until it is resubmitted or rejected, or until the owner adds a new
approver, whose approval finalises it.

### Known limits

- **Any `Submitter` can resubmit a milestone in progress**, including one another member
  submitted, which replaces `submitter` and clears its approvals. The remedy is the owner
  removing them.
- **The owner can make a submitter an approver**, who can then approve their own proof. A
  threshold of 2 or more still requires someone else.
- **Anyone can claim an unused `project_id`.** After `ProjectExists`, check the owner with
  `get_project`.
- **Ids may be empty**, as in v1.

## Merkle batches

`anchor_batch` stores one Merkle root for many milestone proofs, in one transaction.
`verify_inclusion` checks one milestone against it. The scheme, the proof format and
the shared test vectors are in [`docs/merkle/SPEC.md`](../../docs/merkle/SPEC.md).

- **A batch moves no milestone.** It is a timestamped commitment that its proof hashes
  existed. Approval stays per milestone, through `submit_milestone_proof` and
  `approve_milestone`.
- **Write once.** `batch_id` is the caller's, at most 64 bytes and unique per project.
  Reusing one is `BatchExists`, so an anchored root is never replaced.
- **1 to 65,536 leaves** (`MAX_BATCH_LEAVES`), else `InvalidBatch`. A proof holds at most
  16 hashes.
- **`false`, not an error, for a bad proof.** `verify_inclusion` rebuilds the leaf from
  `project_id`, `milestone_id`, `version` and `proof_hash`, takes every left/right side from `index`
  and the stored leaf count, and returns `false` for a wrong, short, long or
  out-of-range proof. Only an unknown batch is an error (`BatchNotFound`). It is
  read-only, so a simulation is enough and costs no fee.
- The contract never sees the leaves, so it can't refuse a batch that names the same
  milestone twice. `qdit-batch` refuses one before anchoring.

## Storage and TTL

Everything lives in persistent storage, one entry per key:

| Key | Holds | Bound |
| --- | --- | --- |
| `Project(project_id)` | owner, threshold | fixed size |
| `Members(project_id)` | roster, `Map<Address, Role>` | 20 members (`MAX_MEMBERS`, `MemberLimit`) |
| `Milestone(project_id, milestone_id)` | record, with its approvers `Vec` | approvers: 21, one more than the roster cap (see Removed approvers) |
| `Batch(project_id, batch_id)` | root, leaf count, submitter, ledger | fixed size; 1 to 65,536 leaves, proofs of at most 16 hashes |

Ids are at most 64 bytes. No entry holds a collection that grows without a bound,
and nothing is kept in instance storage.

**Every write extends TTL.** A write extends the entry it writes, the project's
record, its roster and the contract instance (which also covers the contract code) to
`TTL_EXTEND_TO`, 120 days (2,073,600 ledgers at 5 s). An entry is only extended
once its TTL is below `TTL_THRESHOLD`, 119 days, so a busy project pays the bump
at most once a day. 120 days stays under the network's ceiling of 3,110,400
ledgers (about 180 days), which the crate checks at compile time.

So a project that keeps getting writes never loses its record or roster, even if
neither is written again. Reads extend nothing: they are usually simulations, and
a simulation writes nothing.

### Idle entries need extending or restoring

An entry nobody writes for 120 days is archived. In practice:

- **An idle project.** No write for 120 days archives its record, roster and
  possibly the instance. Every call on it fails until they are restored.
- **A finished milestone or an old batch.** An Approved milestone or an anchored
  batch is never written again, so it is archived 120 days after its last write,
  even while the project stays busy. `get_milestone_status`, `get_batch` and
  `verify_inclusion` fail on it until it is restored.

Nothing is lost: an archived entry is restored with `stellar contract restore`
(or a `RestoreFootprint` operation) for its key, paid by whoever restores it, and
it reads as before. To keep one live ahead of time, extend it with
`stellar contract extend --durability persistent`.

## Events

Every write emits one event, and a refused call emits none. Topic 0 is `qdit`, topic 1
the verb, topic 2 the `project_id`. The data carries what `@qdit/verify replay` needs to
rebuild state without reading storage.

| Verb | Data |
| --- | --- |
| `create` | `owner`, `threshold` |
| `transfer` | `previous_owner`, `new_owner` |
| `add_member` | `member`, `role` (held after the call) |
| `remove_member` | `member`, `role` (held until the call) |
| `threshold` | `threshold` |
| `submit` | `milestone_id`, `submitter`, `proof_hash`, `version`, `timestamp` |
| `approve` | `milestone_id`, `approver`, `version`, `proof_hash`, `status` (after the call) |
| `reject` | `milestone_id`, `approver`, `version`, `proof_hash` |
| `batch` | `batch_id`, `submitter`, `root`, `leaf_count`, `timestamp` |

## Test

```sh
cd contracts
cargo test -p milestone_proof_v2
```
