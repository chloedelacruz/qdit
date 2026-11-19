# Batch vs individual anchoring: Stellar testnet benchmark

Run on 2026-11-19 against `milestone_proof_v2` on Stellar **testnet**, contract
[`CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB`](https://stellar.expert/explorer/testnet/contract/CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB),
the current deployment (`contracts/milestone_proof_v2/DEPLOYMENTS.md`), with Merkle
scheme v2 ([`SPEC.md`](./SPEC.md)). Every number below comes from a real, confirmed
transaction. The raw results are in
[`benchmark/testnet-2026-11-19.json`](./benchmark/testnet-2026-11-19.json), and every
transaction is linked in
[`benchmark/testnet-2026-11-19-transactions.md`](./benchmark/testnet-2026-11-19-transactions.md).

## What was compared

For N = 1, 10, 50 and 100 milestones, with the same N proof hashes each time:

- **Individual:** N `submit_milestone_proof` transactions, one per milestone, the way
  proofs are anchored today.
- **Batch:** one `anchor_batch` transaction carrying the Merkle root of the same N
  proofs.

Then `verify_inclusion` was simulated for the batch's last leaf, to price the
on-chain check.

## Results

| Milestones | Individual: tx | Individual: fee (XLM) | Batch: tx | Batch: fee (XLM) | Individual: fee per milestone (XLM) | Batch: fee per milestone (XLM) | Fee saved | Individual: ledgers | Batch: ledgers |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0.0964 | 1 | 0.0802 | 0.0964 | 0.0802 | 1.2× | 1 | 1 |
| 10 | 10 | 0.9641 | 1 | 0.0801 | 0.0964 | 0.0080 | 12.0× | 10 | 1 |
| 50 | 50 | 4.8184 | 1 | 0.0801 | 0.0964 | 0.0016 | 60.1× | 51 | 1 |
| 100 | 100 | 9.6368 | 1 | 0.0801 | 0.0964 | 0.0008 | 120.3× | 100 | 1 |

| Milestones | Individual: CPU instructions | Batch: CPU instructions | Individual: bytes written | Batch: bytes written | Individual: wall time (s) | Batch: wall time (s) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 946,837 | 927,253 | 448 | 372 | 9.6 | 5.6 |
| 10 | 9,468,370 | 927,253 | 4,480 | 372 | 55.6 | 5.6 |
| 50 | 47,341,850 | 927,253 | 22,400 | 372 | 259.2 | 5.5 |
| 100 | 94,683,700 | 927,253 | 44,800 | 372 | 505.4 | 4.6 |

| Milestones | Proof length (hashes) | `verify_inclusion` CPU instructions | Resource fee if sent (XLM) |
| ---: | ---: | ---: | ---: |
| 1 | 0 | 731,097 | 0.0007 |
| 10 | 2 | 791,632 | 0.0007 |
| 50 | 3 | 821,899 | 0.0007 |
| 100 | 4 | 850,870 | 0.0008 |

| Milestones | Batch tx | Individual txs |
| ---: | --- | --- |
| 1 | [`e38fd6c5…`](https://stellar.expert/explorer/testnet/tx/e38fd6c5eb313f0f32f06877a731679f0a0e382095fe52e88d0b5a3ffa6c90c0) | [`76c914a5…`](https://stellar.expert/explorer/testnet/tx/76c914a5a63f686d6ba1a8e95c1f1bbfdeff70d0ec94150945815f5039a3028d) |
| 10 | [`2788476d…`](https://stellar.expert/explorer/testnet/tx/2788476d46e73cef3dbf4e7bb69a62c8da6525e36f090d886dc864cd425913ed) | first [`66f56deb…`](https://stellar.expert/explorer/testnet/tx/66f56debf17a6b5fbd25ccd5db3c967f48a90f9ce420c27a06358bf5ef1c33aa), [all 10](./benchmark/testnet-2026-11-19-transactions.md#n--10) |
| 50 | [`1bdf330f…`](https://stellar.expert/explorer/testnet/tx/1bdf330fb68ba5cdcbb984c0638090cac81e95729a9b176ca230172cb66195ba) | first [`85649987…`](https://stellar.expert/explorer/testnet/tx/856499879f7df7dcdfe0d4cb2dc8f75cec735d8e8d8e55d333497ff698c5831a), [all 50](./benchmark/testnet-2026-11-19-transactions.md#n--50) |
| 100 | [`c2d5fede…`](https://stellar.expert/explorer/testnet/tx/c2d5fede27149ee4980ec0a9cdfb48c411e7b26b024a598351ba681de0a26621) | first [`b5ef0a2c…`](https://stellar.expert/explorer/testnet/tx/b5ef0a2ceeb2c23c2ed10df9d0819af61a2c8ccc2b37d26a313eb2d1c43f1da1), [all 100](./benchmark/testnet-2026-11-19-transactions.md#n--100) |

For scale, the v1 contract's
[`approve_milestone` at ledger 4126783](https://stellar.expert/explorer/testnet/tx/4d2f27982c7714f418b7506f6c51b04edc1a2976f2c74a05573d19173d31e5f5)
was charged 0.0010703 XLM. That is a different call on a contract that extends no TTL, so
it is a baseline for what a small v1 write cost, not a like-for-like row.

## Reading the numbers

- **A batch costs the same at every size.** The contract stores one root and a leaf
  count whatever N is, so the batch fee (801,232 stroops), CPU and bytes written don't
  change from 10 to 100 milestones. Individual anchoring grows linearly, at about
  963,700 stroops per milestone. Even a batch of one is cheaper, because a batch record
  is smaller than a milestone record.
- **Rent is almost all of the fee.** Every write extends its entry's TTL to 120 days
  (QDIT-15), and once a day also the project's shared entries, so each transaction
  prepays that storage. Read from the transaction metadata, rent was 795,492 of the
  batch's 801,232 stroops at N = 100 and 958,499 of the single N = 1 submission's
  964,431. That is why the fees are about 19 times the 2026-11-10 run's, on a contract
  that extended nothing. The saving from batching is the same shape as before, because
  both sides pay rent per entry written.
- **Ledgers spanned is the latency that matters.** A batch lands in one ledger.
  Sending 100 proofs one after another spanned 100 ledgers, about 8 minutes of chain
  time.
- **Wall time is client-side.** It is dominated by RPC round trips from the machine that
  ran the benchmark. Treat it as an illustration, not a property of the chain.
- **Checking is cheap and read-only.** `verify_inclusion` runs by simulation, with no
  key and no fee. Its cost grows with the proof length, which is logarithmic in N. The
  last leaf was measured, and with odd-node promotion it has a short path (4 hashes at
  N = 100). The longest path at N = 100 is 7 hashes.
- **What a batch gives up.** A batch anchors a commitment, not a state change. It moves
  no milestone through Submitted or Approved. Approval stays per milestone. See section
  1 of the spec.

Fees are testnet fees, with an inclusion-fee bid of 100 stroops per transaction and no
surge pricing. Mainnet resource prices differ, but the shape doesn't: one transaction
against N.

## Reproduce

```sh
cd packages && npm ci && npm run build
npm run bench -w qdit-batch -- --out results.json            # the current contract
node qdit-batch/src/bench-table.ts results.json              # the tables above
node qdit-batch/src/bench-table.ts --tx-list results.json    # the transaction list
```

`--contract C...` runs it against another deployment. `bench.ts` funds a fresh account
through friendbot, creates its own project, and makes that account the project's
Submitter, so it touches nobody else's records. A full run sends 167 transactions (two to set up the project) and
took about 14 minutes.

## Earlier run

The 2026-11-10 run, on the superseded contract `CCLOK4SW…QFH3` with Merkle scheme v1 and
no TTL extension, is kept in
[`benchmark/testnet-2026-11-10.json`](./benchmark/testnet-2026-11-10.json). It measured
a batch at 43,154 stroops and an individual submission at 50,734.
