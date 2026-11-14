# `v2-harness`

Drives every `milestone_proof_v2` call against the live **testnet** contract and writes a
tx-linked evidence log. It uses the generated client
([`@qdit/milestone-proof-v2-bindings`](../milestone-proof-v2-bindings)), so it runs against
the contract id in [`DEPLOYMENTS.md`](../../contracts/milestone_proof_v2/DEPLOYMENTS.md).

```sh
cd packages
npm ci
npm run harness
```

It needs network access and nothing else: no keys, no `.env`. Each run makes six throwaway
accounts (owner, submitter, three approvers, an outsider), funds them with Friendbot and
never writes their secrets down. Each run uses a fresh random project id, so runs never
collide. A run takes about two minutes.

## What it does

1. `create_project` at threshold 1, then `add_member` three approvers and a submitter, and
   `set_threshold` 2.
2. `submit_milestone_proof`, then `approve_milestone` by two separate approvers. The
   milestone reaches Approved.
3. `remove_member` an approver, `set_threshold` 1, and a second milestone approved at the
   lower threshold.
4. `anchor_batch` of three milestones built with `@qdit/merkle`, `get_batch`, then
   `verify_inclusion`: sent once so the check is on the ledger (true), and simulated with a
   wrong proof hash (false).
5. `transfer_project_owner`, signed by both owners (D-107).

And three refusals, each of which must fail simulation with the expected code:

| Call | Expected |
| --- | --- |
| Submit by an address that isn't on the roster | `NotMember` (#7) |
| The same approver approving twice | `AlreadyApproved` (#8) |
| The removed approver approving | `NotMember` (#7) |

Every write is checked to have succeeded on chain, and the wasm the contract runs is
fetched and hashed for the log. Any surprise stops the run with a non-zero exit, and no
evidence file is written.

## Output

`docs/evidence/v2-harness-<UTC date>.md`, with a Stellar Expert link for every sent
transaction, the error code and host error for every refusal, and the throwaway
addresses. A second run on the same day replaces the file.

A refused call is never sent, because a call that fails simulation can't be submitted
as it stands, so refusals have no transaction link. Their proof is the
`Error(Contract, #n)` the simulation returned.

Set `QDIT_RPC_URL` to use another testnet RPC. Testnet is reset from time to time, which
removes the contract and every transaction in a log; after a reset, redeploy (see
`DEPLOYMENTS.md`), regenerate the bindings and run the harness again.
