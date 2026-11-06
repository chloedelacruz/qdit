# `milestone_proof_v2`

On-chain team roles and M-of-N milestone approval. A new contract beside
[`milestone_proof`](../milestone_proof), not an upgrade of it: v1 and its records are
not touched, and the app and doqtri stay on v1. Testnet only for now.

It has no admin, no privileged override and no upgrade entry point. Every write
requires the acting address's signature and reads roles and the owner from storage,
never from an argument.

## Interface

| Function | Auth | Refused with |
| --- | --- | --- |
| `create_project(project_id, owner, threshold)` | `owner` | `ProjectExists`; `InvalidThreshold` unless 1 to 20 |
| `add_member(project_id, owner, member, role)` | `owner` | `ProjectNotFound`, `NotAuthorized`, `MemberLimit`; `InvalidThreshold` when demoting an approver leaves too few |
| `remove_member(project_id, owner, member)` | `owner` | `ProjectNotFound`, `NotAuthorized`, `NotMember`; `InvalidThreshold` when removing an approver leaves too few |
| `set_threshold(project_id, owner, threshold)` | `owner` | `ProjectNotFound`, `NotAuthorized`; `InvalidThreshold` unless 1 to the approver count |
| `transfer_project_owner(project_id, current_owner, new_owner)` | **both** | `ProjectNotFound`, `NotAuthorized` |
| `submit_milestone_proof(project_id, milestone_id, submitter, proof_hash)` | `submitter`, role `Submitter` | `ProjectNotFound`, `NotMember`, `NotAuthorized`, `InvalidStatus` |
| `approve_milestone(project_id, milestone_id, approver)` | `approver`, role `Approver` | `ProjectNotFound`, `NotMember`, `NotAuthorized`, `MilestoneNotFound`, `InvalidStatus`, `AlreadyApproved` |
| `reject_milestone(project_id, milestone_id, approver)` | `approver`, role `Approver` | `ProjectNotFound`, `NotMember`, `NotAuthorized`, `MilestoneNotFound`, `InvalidStatus` |
| `get_project(project_id)` | none | `ProjectNotFound` |
| `get_members(project_id)` | none | `ProjectNotFound` |
| `get_milestone_status(project_id, milestone_id)` | none | `MilestoneNotFound` |

Every call also refuses an id over 64 characters with `IdTooLong`.

Errors: `ProjectExists = 1`, `ProjectNotFound = 2`, `MilestoneNotFound = 3`,
`NotAuthorized = 4`, `InvalidStatus = 5`, `IdTooLong = 6`, `NotMember = 7`,
`AlreadyApproved = 8`, `InvalidThreshold = 9`, `MemberLimit = 10`. Code 11 is reserved
for `BatchExists`. Off the roster is `NotMember`; on it with the wrong role is
`NotAuthorized`.

## Rules

- **Roles.** Each address holds one role, `Submitter` or `Approver`. `add_member` on an
  existing member changes their role. A roster holds at most 20 members.
- **The owner is not a member.** Owning a project controls the roster and threshold. To
  submit or approve, the owner has to add themselves with a role.
- **Threshold at creation (D-104).** `create_project` accepts a threshold above the
  current approver count, because a project starts with no approvers. A milestone can't
  reach Approved until enough approvers exist. The cap of 20 exists because no roster
  could reach more, and it bounds every approvers set.
- **Keeping the threshold reachable (D-106).** Removing an approver, or changing them to
  another role, is refused if it leaves fewer approvers than the threshold.
- **Removed approvers (D-105).** An approval given before the approver was removed still
  counts, and their address stays in the set. They can't give a new approval. To cancel
  an approval from a removed key, resubmit the milestone.
- **Resubmission.** It increments `version`, restamps `timestamp` and clears the
  approvers, so approvals always refer to the hash being approved. It is allowed from
  Submitted or Rejected. Approved is terminal.
- **Rejection.** Any one approver can reject. The approvers set stays readable until a
  resubmission clears it.
- **Transfer (D-107).** Both owners sign, as in v1. The roster is unchanged, and the new
  owner gets no member role.

### Lowering a threshold

`set_threshold` changes no milestone by itself, because a write can't walk every
milestone. A milestone that now meets the lower threshold stays Submitted until the next
approval, which moves it to Approved.

If every current approver has already approved, nobody can give that approval: they get
`AlreadyApproved`, and the milestone stays Submitted until it is resubmitted or rejected.

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
| `submit` | `milestone_id`, `submitter`, `proof_hash`, `version` |
| `approve` | `milestone_id`, `approver`, `version`, `status` (after the call) |
| `reject` | `milestone_id`, `approver`, `version` |

## Test

```sh
cd contracts
cargo test -p milestone_proof_v2
```
