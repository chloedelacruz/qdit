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

All 14 contract functions, in this order:

1. `create_project` at threshold 1, then `add_member` three approvers and a submitter
   (`get_members` shows 4), and `set_threshold` 2.
2. `submit_milestone_proof`, then `approve_milestone` by two separate approvers. The
   milestone reaches Approved, version 1, 2 approvals.
3. `remove_member` an approver. A second milestone is submitted, then
   `reject_milestone`ed (Rejected), resubmitted with a revised proof (version 2),
   `set_threshold` 1, and approved at the lower threshold (Approved, version 2).
4. A third milestone is submitted. `anchor_batch` of the three, built with `@qdit/merkle`
   and each leaf carrying the version the contract recorded, then `get_batch`.
   `verify_inclusion` for the version-2 milestone is sent so the check is on the ledger
   (true), and simulated as version 1 (false) and with the rejected proof hash (false).
5. `transfer_project_owner`, signed by both owners (D-107), then `get_project`.

And four refusals:

| Call | Expected |
| --- | --- |
| Submit by an address that isn't on the roster | `NotMember` (#7) |
| The same approver approving twice | `AlreadyApproved` (#8) |
| The removed approver approving | `NotMember` (#7) |
| Anchoring a batch id that is already used | `BatchExists` (#11) |

Each refusal must first fail simulation with its code. Then it is signed and sent
anyway, so it lands on the ledger as a failed transaction: a failing simulation gives no
footprint, so the transaction borrows the footprint and resources of the same call made
valid (another signer, or another batch id plus the used one's key). The harness reads
the failed transaction's diagnostic events and checks they carry the same code.

Every write is checked to have succeeded on chain, every status, count and root it logs
is asserted, and the wasm the contract runs is fetched and hashed for the log. Any
surprise stops the run with a non-zero exit, and no evidence file is written.

## Output

`docs/evidence/v2-harness-<UTC date>.md`, with a Stellar Expert link for every sent
transaction and every failed refusal, the simulation's host error for each refusal, and
the throwaway addresses. A second run on the same day replaces the file.

Set `QDIT_RPC_URL` to use another testnet RPC. Testnet is reset from time to time, which
removes the contract and every transaction in a log; after a reset, redeploy (see
`DEPLOYMENTS.md`), regenerate the bindings and run the harness again.
