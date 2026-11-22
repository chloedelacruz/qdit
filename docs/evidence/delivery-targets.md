# Delivery targets (SOW 3.6 and 6.3)

All targets are met.

Each target from the Instawards SOW, whether it is met, and where to check it. Every
transaction is on Stellar **testnet** and opens on Stellar Expert. Contract:
[`CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB`](https://stellar.expert/explorer/testnet/contract/CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB)
(`milestone_proof_v2`, WASM `bce764f4…6a900`).

The QA run is [`qa-2026-11-22/`](./qa-2026-11-22/README.md): five projects driven by
`packages/v2-harness/src/seed.ts`, every approved milestone and every inclusion proof then
checked with `@qdit/verify`. Its README links every transaction.

| Target | Result | Evidence |
| --- | --- | --- |
| `milestone_proof_v2` deployed on testnet, new contract id | **Pass** | [`DEPLOYMENTS.md`](../../contracts/milestone_proof_v2/DEPLOYMENTS.md): deploy tx [`d979fe53…a295fd`](https://stellar.expert/explorer/testnet/tx/d979fe5311e70cdc54ad70cdc5ae597f30cb1462c3aec92aad7dc1cf6aa295fd), 2026-11-14 |
| At least 60 contract tests passing in CI (baseline 26) | **Pass**: 140 (26 v1, 114 v2) | [CI run on `main`, contracts job](https://github.com/chloedelacruz/qdit/actions/runs/45075980468/job/137373170597): `test result: ok. 26 passed` and `test result: ok. 114 passed` |
| At least 5 test projects with a threshold of 2 or more | **Pass**: 5 | QA run: qa-1, qa-2, qa-3 and qa-5 at 2 of 3 or 2 of 2, qa-4 at 3 of 4 |
| At least 20 milestones approved through a multi-approver threshold | **Pass**: 27 | QA run: every one has its approvals linked and was re-checked with `verifyMilestone` (status Approved, version and proof hash as submitted, approvers at least the threshold) |
| The 3 negative authorization cases refused on chain | **Pass**: 3 of 3 | QA run, qa-1: non-member submit `NotMember` [`861331ac…839ac7`](https://stellar.expert/explorer/testnet/tx/861331acc5a9823895da7c3504cc0072e5a13ba4ea36227b09ffb59be6839ac7), duplicate approval `AlreadyApproved` [`caf98956…f758a7`](https://stellar.expert/explorer/testnet/tx/caf989565aad62f0773c25f9f1aecc3e2678bedb632ae604397a09fe9ff758a7), removed approver `NotMember` [`bf50ee71…5992fc`](https://stellar.expert/explorer/testnet/tx/bf50ee71789182215293af8a3dfe8cee9f155144278a312f37b825c43e5992fc). Also in the [2026-11-14 harness run](./v2-harness-2026-11-14.md) |
| At least 10 batches anchored, one of at least 100 milestones | **Pass**: 10 in the QA run, the largest 128 leaves | QA run, two batches per project; qa-1's `records` batch has 128 leaves. The contract holds 19 batches in all (QA run, the [week 3 sample](./qdit-batch-2026-11-19/README.md) of 120 leaves, the [benchmark](../merkle/BENCHMARK.md) and earlier attempts) |
| At least 100 inclusion proofs verified on chain and offline | **Pass**: 235, 0 failed | QA run: every proof file is under `qa-2026-11-22/batches/`, each checked with `verifyInclusion` offline and on chain (stored root, and the contract's own `verify_inclusion`) |
| Batch-versus-single fee benchmark at 1, 10, 50 and 100 milestones, every row linked | **Pass** | [`docs/merkle/BENCHMARK.md`](../merkle/BENCHMARK.md) and its [transaction list](../merkle/benchmark/testnet-2026-11-19-transactions.md) |
| Merkle test vectors shared by the Rust and TypeScript implementations | **Pass** | [`docs/merkle/vectors.json`](../merkle/vectors.json), loaded by the contract tests and by `packages/merkle` |
| Replay snapshot matches the contract's getters for the test projects | **Pass** for every project still in the RPC's event window; see the note | [`replay-snapshot.json`](./replay-snapshot.json) and [`replay-compare.json`](./replay-compare.json): 465 events, 21 projects, 75 members, 212 milestones and 19 batches compared, 0 differences |
| `@qdit/verify` v0.1 published on npm under MIT (verifyMilestone, verifyInclusion, replay) | **Pass** | [npmjs.com/package/@qdit/verify](https://www.npmjs.com/package/@qdit/verify) 0.1.0, with npm provenance; [release run](https://github.com/chloedelacruz/qdit/actions/runs/45082736052), whose [clean-install job](https://github.com/chloedelacruz/qdit/actions/runs/45082736052/job/137394463238) verified a 2-of-3 milestone and a batch proof on testnet with the published package |

## Notes

**Replay and RPC retention.** Soroban RPC keeps contract events for about 7 days
(120,960 ledgers on the public testnet RPC). The snapshot was taken on 2026-11-22 and
covers ledgers 5751719 to 5872678. Events from the deploy ledger (5728090) up to 5751718,
2026-11-14 to 2026-11-15, had already left the window, so the snapshot says
`"complete": false` and names that gap rather than pass a partial history off as whole.
The projects of the 2026-11-14 harness run fall in the gap and are not in the snapshot;
every project created inside the window, including all five QA projects, the week 3 sample
and the benchmark, was replayed in full and matched its getters with zero differences.

**Earlier attempts.** Two QA seed attempts before the recorded run stopped early because
of a bug in the seed script (fixed); their project ids are listed in the QA run's README.
They are not counted above.
