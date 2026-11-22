# qdit Instawards sprint: evidence of completion

This page collects the evidence the Statement of Work (section 6.1) promises for each
deliverable, with a link for every item. Everything ran on the Stellar **testnet**: every
transaction link opens on Stellar Expert, a public block explorer, and needs no account.

**At a glance**

| | |
| --- | --- |
| Source code | [github.com/chloedelacruz/qdit](https://github.com/chloedelacruz/qdit) (contracts in `contracts/`, tools in `packages/`) |
| New contract (v2), deployed in this sprint | [`CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB`](https://stellar.expert/explorer/testnet/contract/CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB) |
| Existing contract (v1), unchanged | [`CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG`](https://stellar.expert/explorer/testnet/contract/CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG) |
| Every target, pass or pending | [Delivery targets](../../evidence/delivery-targets.md) |
| Security self-review | [v2 self-review](../../security/v2-self-review.md) (not a third-party audit, as the SOW says) |

## Deliverable 1: on-chain team roles and M-of-N approval (`milestone_proof_v2`)

What it is: a new smart contract where a project has a team (submitters and approvers)
and a milestone is approved only when enough approvers have each signed.

| Evidence (SOW 6.1) | Where to see it |
| --- | --- |
| The v2 contract on Stellar Expert | [Contract page](https://stellar.expert/explorer/testnet/contract/CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB); deployment record with the code fingerprint: [`DEPLOYMENTS.md`](../../../contracts/milestone_proof_v2/DEPLOYMENTS.md) |
| Member added | [add approver1](https://stellar.expert/explorer/testnet/tx/07c05accd08882221963b18c4319e322c32dfe2d3b88d4e5f03cbf2461f48483) (harness run, 2026-11-14) |
| Member removed | [remove approver3](https://stellar.expert/explorer/testnet/tx/ba38ddb420afc79d459f5441f52004c89e0617d5c27d056d87b159272245cb1a) |
| Threshold changed | [set threshold to 2](https://stellar.expert/explorer/testnet/tx/ff953b1161962425ec4dcedf2ce2bddfc0fdcc6f40f4f2c958cc59d8f78ba715) |
| A 2-of-3 approval, two separate approver signatures | [first approver](https://stellar.expert/explorer/testnet/tx/42299ff9dd92a92bb5e80bc38d488b44d5eabbd05d29c8e45ec97cdb81ab070f), [second approver](https://stellar.expert/explorer/testnet/tx/f7f9abffa7778e62f324af06db75c59f9f68977b282ac090028baadd94e8d5a2): the milestone becomes Approved only after the second |
| Refused: a non-member tries to submit (`NotMember`) | [failed transaction](https://stellar.expert/explorer/testnet/tx/861331acc5a9823895da7c3504cc0072e5a13ba4ea36227b09ffb59be6839ac7) (QA run, 2026-11-22) |
| Refused: a removed approver tries to approve (`NotMember`) | [failed transaction](https://stellar.expert/explorer/testnet/tx/bf50ee71789182215293af8a3dfe8cee9f155144278a312f37b825c43e5992fc) |
| Refused: the same approver approves twice (`AlreadyApproved`) | [failed transaction](https://stellar.expert/explorer/testnet/tx/caf989565aad62f0773c25f9f1aecc3e2678bedb632ae604397a09fe9ff758a7) |
| The full runs, every step linked | [Harness run, 2026-11-14](../../evidence/v2-harness-2026-11-14.md) (every contract call); [QA run, 2026-11-22](../../evidence/qa-2026-11-22/README.md) (5 projects with a threshold of 2 or more, 27 milestones approved through it) |
| Merged pull requests | [#18 contract core](https://github.com/chloedelacruz/qdit/pull/18), [#48 storage lifetime](https://github.com/chloedelacruz/qdit/pull/48), [#50 testnet deploy, bindings and harness](https://github.com/chloedelacruz/qdit/pull/50) |
| A CI run with at least 60 passing contract tests | [CI run on `main`](https://github.com/chloedelacruz/qdit/actions/runs/45075980468/job/137373170597): 140 contract tests pass (26 v1, 114 v2) |

## Deliverable 2: Merkle batch anchoring

What it is: many records anchored in one transaction. The contract stores one
fingerprint (a Merkle root) for the whole batch, and each record gets a small proof file
that shows it was in the batch.

| Evidence (SOW 6.1) | Where to see it |
| --- | --- |
| At least 10 anchored batches, one with 100+ milestones | [QA run](../../evidence/qa-2026-11-22/README.md): 10 batches, each with its transaction; the largest, [128 records in one transaction](https://stellar.expert/explorer/testnet/tx/c57d2544553fdec10bbb0f9bf967ea2c031ff7c3bac81c2088c62498162e0742). Also the [week 3 sample batch of 120](../../evidence/qdit-batch-2026-11-19/README.md) |
| A sample inclusion-proof file from `qdit-batch`, verified on chain and offline | [Sample proof file](../../evidence/qdit-batch-2026-11-19/proofs/00119-week3-sample-119.json), its [verification log](../../evidence/qdit-batch-2026-11-19/qdit-batch-verify.txt) (all 120 proofs: `local true  contract true`), and the same proof as a [printable certificate](../../evidence/qdit-batch-2026-11-19/certificates/00119-week3-sample-119.html) |
| At least 100 proofs verified on chain and offline | [QA run](../../evidence/qa-2026-11-22/README.md): 235 proofs, each checked offline and against the contract, 0 failed; every proof file is in the [batches folder](../../evidence/qa-2026-11-22/batches) |
| The Merkle specification and shared test vectors | [Specification](../../merkle/SPEC.md); [test vectors](../../merkle/vectors.json), used by both the contract (Rust) and the library (TypeScript) |
| The published fee benchmark, every row linked | [Benchmark](../../merkle/BENCHMARK.md): at 100 milestones one batch costs 120 times less than 100 single transactions; [every transaction](../../merkle/benchmark/testnet-2026-11-19-transactions.md) |
| Merged pull requests | [#50 batch contract calls](https://github.com/chloedelacruz/qdit/pull/50), [#52 library, CLI, benchmark](https://github.com/chloedelacruz/qdit/pull/52), [#53 certificates](https://github.com/chloedelacruz/qdit/pull/53) |

## Deliverable 3: the open-source verifier, `@qdit/verify` v0.1

What it is: a small free tool anyone can run to check a qdit record directly against the
blockchain, without trusting qdit's website or database.

| Evidence (SOW 6.1) | Where to see it |
| --- | --- |
| The npm page and source | **Pending publication.** npm page: [npmjs.com/package/@qdit/verify](https://www.npmjs.com/package/@qdit/verify) (live once released). Source: [`packages/verify`](../../../packages/verify) (MIT licence) |
| A CI job that installs the published package in a clean environment and verifies a v2 threshold-approved milestone and a batch proof on testnet | **Pending publication.** The job is ready: [`release-verify.yml`](../../../.github/workflows/release-verify.yml), "clean install, verify testnet records". Its run link is added here when it has run |
| A replay snapshot of the sprint test projects | [Snapshot](../../evidence/replay-snapshot.json) and its [comparison with the contract](../../evidence/replay-compare.json): 21 projects, 212 milestones and 19 batches rebuilt from the contract's events, 0 differences. The public testnet service keeps events for about 7 days, so the earliest projects (2026-11-14) could no longer be replayed; the snapshot says so itself (see [Delivery targets](../../evidence/delivery-targets.md#notes)) |

## Check it yourself

You need [Node.js](https://nodejs.org) 22.18 or later. Each command prints its result and
ends with exit code 0 when the record checks out. Nothing is signed and nothing costs a
fee: the tool only reads the blockchain.

1. **Is this milestone approved by two separate approvers?**

   ```sh
   npx @qdit/verify milestone --project ad605dca-7cab-491d-9d62-0d196ebc54b7 --milestone milestone-1
   ```

   Look for `"ok": true`, `"status": "Approved"` and two addresses under `"approvers"`.

2. **Was this record in the 128-record batch?**

   ```sh
   curl -sO https://raw.githubusercontent.com/chloedelacruz/qdit/main/docs/evidence/qa-2026-11-22/batches/qa-1/records/proofs/00127-record-127.json
   npx @qdit/verify proof 00127-record-127.json
   ```

   Look for `"ok": true` and `"contractSays": true`: the contract itself confirmed it.

3. **Does the rebuilt history match the contract?**

   ```sh
   npx @qdit/verify replay --compare --allow-incomplete --out snapshot.json
   ```

   Look for `"diffs": []`.

Until the package is on npm, run the same commands from a copy of the repository:
`cd packages && npm ci && npm run build`, then use `node verify/dist/cli.js` in place of
`npx @qdit/verify`.
