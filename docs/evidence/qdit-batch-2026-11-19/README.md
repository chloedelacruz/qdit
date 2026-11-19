# qdit-batch on testnet: a 120-milestone batch, 2026-11-19

One `anchor_batch` transaction anchored 120 milestones on the current
`milestone_proof_v2` contract (Merkle scheme `qdit/merkle/v2`, D-124), and every
inclusion proof verified on chain and offline. The earlier 100-milestone run in
[`docs/merkle/BENCHMARK.md`](../../merkle/BENCHMARK.md) used a superseded contract and
scheme v1.

| | |
| --- | --- |
| Contract | [`CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB`](https://stellar.expert/explorer/testnet/contract/CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB) |
| Project id | `4862f6dd-f9ed-44bf-a5b9-fb68e64ceaef` (threshold 1) |
| Batch id | `week3-sample-120` |
| Leaves | 120 |
| Root | `73320bae8b8f93d65c818b3c264b74ccfcfda7b775f94beb6717cc06fbe92d7a` |
| `create_project` | [`37949a20…1a1832`](https://stellar.expert/explorer/testnet/tx/37949a20f73fb54ad6bd7d72552bea83f3237828d56294896f3796c7091a1832) |
| `add_member` (Submitter) | [`e8d295de…812d3c`](https://stellar.expert/explorer/testnet/tx/e8d295de307f809fc1b8ac07ab5c6478df610065658cdc22f90fd9ad35812d3c) |
| `anchor_batch` | [`2a9cc5f7…cbaea2`](https://stellar.expert/explorer/testnet/tx/2a9cc5f7bd27637d6a709a980ce2833ee4a6d056bc6672b8631a5125fccbaea2), ledger 5807495 |
| Fee charged | 804,703 stroops (0.0804703 XLM) for the whole batch |

The owner and submitter were throwaway Friendbot keys made for this run. Their
secrets were never written down.

## Files

- [`milestones.json`](./milestones.json): the `qdit-batch` input. The proof hashes are
  `sha256("qdit week 3 sample proof <i>")`, sample data and not real artifacts.
- [`batch.json`](./batch.json): what `qdit-batch anchor` wrote: root, every leaf, the
  anchor and the fee.
- [`setup.json`](./setup.json): the project, the two accounts and the setup
  transactions.
- [`proofs/00119-week3-sample-119.json`](./proofs/00119-week3-sample-119.json): one
  sample inclusion-proof file (`qdit-inclusion-proof/v2`), for the batch's last leaf.
  The other 119 can be rebuilt from `milestones.json` with `qdit-batch build
  --batch-id week3-sample-120` (add `--contract CAIBM…BFNB` to fill in `contract_id`).
  The rebuild gives the same root, so it is the same tree.
- [`qdit-batch-verify.txt`](./qdit-batch-verify.txt): `qdit-batch verify` over all 120
  files. Each one passed the local path check against the stored root and the
  contract's own `verify_inclusion`.

## Check it yourself

```sh
cd packages && npm ci && npm run build
node qdit-batch/dist/cli.js verify ../docs/evidence/qdit-batch-2026-11-19/proofs/*.json
QDIT_LIVE=1 npm test -w verify      # @qdit/verify checks the same file, offline and on chain
```
