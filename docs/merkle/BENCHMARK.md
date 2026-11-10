# Batch vs individual anchoring: Stellar testnet benchmark

Run on 2026-11-10 against `milestone_proof_v2` on Stellar **testnet**, contract
[`CCLOK4SW7DYO7EMUDPE2YSP32VADA3MF6ULKBM2X6H4DS3OXOV4ZQFH3`](https://stellar.expert/explorer/testnet/contract/CCLOK4SW7DYO7EMUDPE2YSP32VADA3MF6ULKBM2X6H4DS3OXOV4ZQFH3),
built from this repository at the commit that added `anchor_batch`. Every number below
comes from a real, confirmed transaction. The raw results, with every transaction hash,
are in [`benchmark/testnet-2026-11-10.json`](./benchmark/testnet-2026-11-10.json).

## What was compared

For N = 1, 10, 50 and 100 milestones, with the same N proof hashes each time:

- **Individual:** N `submit_milestone_proof` transactions, one per milestone, the way
  proofs are anchored today.
- **Batch:** one `anchor_batch` transaction carrying the Merkle root of the same N
  proofs (`docs/merkle/SPEC.md`).

Then `verify_inclusion` was simulated for the batch's last leaf, to price the
on-chain check.

## Results

| Milestones | Individual: tx | Individual: fee (XLM) | Batch: tx | Batch: fee (XLM) | Fee saved | Individual: ledgers | Batch: ledgers |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0.0051 | 1 | 0.0043 | 1.2× | 1 | 1 |
| 10 | 10 | 0.0507 | 1 | 0.0043 | 11.8× | 30 | 1 |
| 50 | 50 | 0.2537 | 1 | 0.0043 | 58.8× | 157 | 1 |
| 100 | 100 | 0.5073 | 1 | 0.0043 | 117.6× | 306 | 1 |

| Milestones | Individual: CPU instructions | Batch: CPU instructions | Individual: bytes written | Batch: bytes written | Individual: wall time (s) | Batch: wall time (s) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 864,848 | 847,089 | 448 | 372 | 30.8 | 20.2 |
| 10 | 8,648,480 | 847,089 | 4,480 | 372 | 178.8 | 13.1 |
| 50 | 43,242,400 | 847,089 | 22,400 | 372 | 821.7 | 21.1 |
| 100 | 86,484,800 | 847,089 | 44,800 | 372 | 1558.6 | 17.3 |

| Milestones | Proof length (hashes) | `verify_inclusion` CPU instructions | Resource fee if sent (XLM) |
| ---: | ---: | ---: | ---: |
| 1 | 0 | 708,863 | 0.0007 |
| 10 | 2 | 769,446 | 0.0007 |
| 50 | 3 | 799,737 | 0.0007 |
| 100 | 4 | 828,724 | 0.0008 |

## Reading the numbers

- **A batch costs the same at every size.** The contract stores one root and a leaf
  count whatever N is, so the batch transaction's fee (43,154 stroops), CPU and bytes
  written don't change from 1 to 100 milestones. Individual anchoring grows linearly,
  at 50,734 stroops per milestone. Even a batch of one is cheaper, because a batch
  record is smaller than a milestone record.
- **Ledgers spanned is the latency that matters.** A batch lands in one ledger.
  Sending 100 proofs one after another spanned 306 ledgers, about 25 minutes of chain
  time.
- **Wall time is client-side.** It is dominated by RPC round trips from the machine
  that ran the benchmark (1.5 to 5 seconds per call on this run). Treat it as an
  illustration, not a property of the chain.
- **Checking is cheap and read-only.** `verify_inclusion` runs by simulation, with no
  key and no fee. Its cost grows with the proof length, which is logarithmic in N. The
  last leaf was measured, and with odd-node promotion it has a short path (4 hashes at
  N = 100). The longest path at N = 100 is 7 hashes.
- **What a batch gives up.** A batch anchors a commitment, not a state change. It
  moves no milestone through Submitted or Approved. Approval stays per milestone. See
  section 1 of the spec.

Fees are testnet fees, with an inclusion-fee bid of 100 stroops per transaction and no
surge pricing. Mainnet resource prices differ, but the shape doesn't: one transaction
against N.

## Reproduce

```sh
cd contracts && stellar contract build --package milestone_proof_v2
stellar contract deploy --wasm target/wasm32v1-none/release/milestone_proof_v2.wasm \
  --source-account <funded testnet identity> --network testnet

cd ../packages && npm ci && npm run build
node qdit-batch/src/bench.ts --contract <C...> --out results.json
node qdit-batch/src/bench-table.ts results.json      # prints the tables above
```

`bench.ts` funds a fresh account through friendbot, creates its own project, and makes
that account the project's Submitter, so it touches nobody else's records.
