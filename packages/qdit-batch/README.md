# `qdit-batch`

Build a Merkle batch of milestone proofs, anchor its root on Stellar in **one**
`anchor_batch` transaction, and write a portable inclusion-proof file for every
milestone. Built on [`@qdit/merkle`](../merkle). The scheme is in
[`docs/merkle/SPEC.md`](../../docs/merkle/SPEC.md).

It targets `milestone_proof_v2`, which is testnet only. The app and doqtri stay on v1.

## Setup

```sh
cd packages
npm ci
npm run build
# then either
node qdit-batch/dist/cli.js --help
# or, with no build step (Node 22.18+ runs the TypeScript directly)
node qdit-batch/src/cli.ts --help
```

## Input

One project and the milestones to batch, in leaf order. `proof_hash` is each
milestone's existing 32-byte proof hash, the value `submit_milestone_proof` takes.
See [`examples/milestones.json`](./examples/milestones.json).

```json
{
  "project_id": "8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2",
  "milestones": [
    { "milestone_id": "c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7", "proof_hash": "<64 hex>" }
  ]
}
```

A milestone id that repeats, an id over 64 bytes, or an empty list is refused before
anything is sent.

## Commands

### `build`: tree and proofs, no network

```sh
qdit-batch build --input milestones.json --batch-id sprint-12 --out batch-sprint-12
```

### `anchor`: one transaction for the whole batch

```sh
export QDIT_SECRET_KEY=S...        # the submitter's key, never a flag
qdit-batch anchor --input milestones.json --batch-id sprint-12 \
  --contract C... --out batch-sprint-12
```

The signing key must hold the `Submitter` role in the project. After the transaction
lands, `anchor` reads the batch back with `get_batch` and stops if the stored root or
leaf count differs from the tree it sent. Only then does it write the files, with the
transaction hash, ledger and timestamp recorded. A reused `--batch-id` is refused by
the contract with `BatchExists`, so an anchored root is never replaced.

### `verify`: check proof files against the chain

```sh
qdit-batch verify batch-sprint-12/proofs/*.json
```

For each file it reads the stored root and leaf count with `get_batch`, checks the path
locally against that root, and also asks the contract's own `verify_inclusion`. Both
checks must pass. These are simulations: no key, no fee. The command exits 1 if any
file fails.

`--offline` checks only that the file agrees with itself. It never trusts the file's
`root` field as proof of anything.

## Output

```
batch-sprint-12/
  batch.json                 root, leaf count, every leaf, the anchor and its fee
  proofs/
    00000-<milestone>.json   qdit-inclusion-proof/v1, one per milestone
    00001-<milestone>.json
```

A proof file is everything a third party needs: project, batch, milestone, proof hash,
index, leaf count, sibling path, root, contract id, network and anchor. The format is
in section 7 of the spec.

## Network

`--network testnet` is the default. For any other network, pass `--network <name>
--rpc-url <url> --passphrase "<network passphrase>"`.

## Benchmark

`src/bench.ts` compares one `submit_milestone_proof` per milestone with a single
`anchor_batch`, at 1, 10, 50 and 100 milestones, on testnet. The published run is in
[`docs/merkle/BENCHMARK.md`](../../docs/merkle/BENCHMARK.md): at 100 milestones a batch
is one transaction in one ledger, against 100 transactions over 306 ledgers, and costs
117.6 times less.

```sh
node src/bench.ts --contract <C...> --out results.json
node src/bench-table.ts results.json
```
