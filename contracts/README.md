# QDIT Soroban contracts

Rust workspace for the QDIT builder task hub's on-chain components.

| Crate | Purpose |
| --- | --- |
| [`milestone_proof`](./milestone_proof) | Registers project references and records milestone proof hashes with an owner-gated approve/reject flow. |

Built against **soroban-sdk 27.0.4** and **stellar CLI 27.x**, targeting `wasm32v1-none`.

## `milestone_proof` interface

| Function | Auth | Notes |
| --- | --- | --- |
| `create_project_ref(project_id: String, owner: Address)` | `owner` | Errors `ProjectExists` (1) if the id is taken. |
| `submit_milestone_proof(project_id: String, milestone_id: String, submitter: Address, proof_hash: BytesN<32>)` | `submitter` | Sets status `Submitted`, increments `version`, stamps `env.ledger().timestamp()`. |
| `approve_milestone(project_id: String, milestone_id: String, approver: Address)` | `approver`, must equal the project owner | Only valid from `Submitted`. |
| `reject_milestone(project_id: String, milestone_id: String, approver: Address)` | `approver`, must equal the project owner | Only valid from `Submitted`. |
| `get_milestone_status(project_id: String, milestone_id: String) -> MilestoneRecord` | none | Read-only; errors `MilestoneNotFound` (3). |

State machine: `Proposed -> Submitted -> Approved | Rejected`. A rejected milestone may be
re-submitted; an approved one is terminal.

Errors: `ProjectExists = 1`, `ProjectNotFound = 2`, `MilestoneNotFound = 3`,
`NotAuthorized = 4`, `InvalidStatus = 5`, `IdTooLong = 6`.

### Why `String` and not `Symbol`

The app's ids are 36-character UUIDs. Soroban's `Symbol` caps at 32 characters and
its alphabet excludes `-`, so a UUID only fits by stripping its hyphens to land on
exactly 32 — no headroom, and a lossy-looking conversion at the call boundary.
`String` takes the id as the app already has it. Ids are capped at 64 characters
(`IdTooLong`) so a caller cannot make the ledger carry an unbounded key.

### `version`

`MilestoneRecord.version` counts submissions, starting at 1. A re-submission
overwrites `proof_hash`, so without the counter the ledger would show only the
latest hash with no evidence an earlier one existed. Approve and reject preserve
it — they attest to a submission rather than making one.

### Events

Every write emits one, and a failed call emits none. Uniform shape:

| Topic 0 | Topic 1 | Topic 2 | Data |
| --- | --- | --- | --- |
| `qdit` | `register` | `project_id` | `owner` |
| `qdit` | `submit` | `project_id` | `milestone_id`, `submitter`, `proof_hash`, `version` |
| `qdit` | `approve` | `project_id` | `milestone_id`, `approver`, `version` |
| `qdit` | `reject` | `project_id` | `milestone_id`, `approver`, `version` |

Topic 0 is constant so one predicate filters every event of this contract; topic 2
is indexed so a consumer can watch a single project without decoding each body.
The types are declared with `#[contractevent]`, so they appear in the contract
spec and `stellar contract bindings typescript` generates types for them.

Records live in `persistent` storage; every write extends the TTL of every key it
touches back out to ~90 days, topped up whenever fewer than ~30 days remain.

## Prerequisites

```sh
rustup target add wasm32v1-none
# stellar CLI 27.x: https://developers.stellar.org/docs/tools/cli
stellar --version
```

## Build

```sh
cd contracts

# Preferred: also optimizes the wasm and prints the hash.
stellar contract build

# Equivalent raw cargo build.
cargo build --target wasm32v1-none --release
```

Artifact: `contracts/target/wasm32v1-none/release/milestone_proof.wasm`.

## Test

```sh
cd contracts
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --all --check
```

## Deploy to testnet

One-time identity and funding:

```sh
stellar keys generate --global qdit-deployer --network testnet --fund
stellar keys address qdit-deployer
```

Deploy the built wasm:

```sh
cd contracts
stellar contract build

stellar contract deploy \
  --wasm target/wasm32v1-none/release/milestone_proof.wasm \
  --source qdit-deployer \
  --network testnet \
  --alias milestone_proof
```

The command prints the contract id (`C...`). Save it as
`NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID` in the app's environment.

## Deployed

| | |
| --- | --- |
| Network | Testnet (`Test SDF Network ; September 2015`) |
| Contract ID | [`CAZYR4UI5EYAIUDNXYAYDVHGMUOELJHQNETOAPN3SMR5BMH6XV2FJRH6`](https://stellar.expert/explorer/testnet/contract/CAZYR4UI5EYAIUDNXYAYDVHGMUOELJHQNETOAPN3SMR5BMH6XV2FJRH6) |
| WASM hash | `18e77bec96a4b2f346139fa8cecb65d75a08ef52432281565d50b954f23a2a8a` |
| WASM upload tx | [`2ac00d00…86da42`](https://stellar.expert/explorer/testnet/tx/2ac00d000b8455af51ca0e57fd844119781fd45b92826ce14a94086a8986da42) |
| Deploy tx | [`06f47068…f9ef1a48`](https://stellar.expert/explorer/testnet/tx/06f47068f44918c76f6c65721d03ea3d682b5da23101a4c4ef887698f9ef1a48) |
| Deployer | `GDBBTFMMV6RKPIGDYGV4DCBA2BUZKWOUNVRFLNQ3GLGA3LIC7JF5MY2B` (`qdit-deployer`) |
| Size | 8835 bytes optimized |

The **WASM hash is the point of this table**: anyone can rebuild this source with
`stellar contract build` and check the hash matches what is deployed. If it does
not, the deployed bytes are not this code.

Deployment is **not** upgradable — there is no admin address and no `upgrade`
entry point, by choice. A bug means deploying a new contract id and migrating
the `chain_contract_id` the app stores per project. Revisit before mainnet.

### TypeScript bindings

Generated from the deployed contract, never hand-written:

```sh
stellar contract bindings typescript --network testnet \
  --contract-id CAZYR4UI5EYAIUDNXYAYDVHGMUOELJHQNETOAPN3SMR5BMH6XV2FJRH6 \
  --output-dir /tmp/qdit-bindings
cp /tmp/qdit-bindings/src/index.ts ../web/src/lib/chain/bindings.ts
```

The file is ESLint-ignored and must be replaced wholesale when the contract
changes. Because the events are declared with `#[contractevent]` they are in the
contract spec, so the bindings carry their types too.

## Invoke

```sh
OWNER=$(stellar keys address qdit-deployer)

PROJECT=8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2   # a real project uuid
MILESTONE=c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7

stellar contract invoke --id milestone_proof --source qdit-deployer --network testnet \
  -- create_project_ref --project_id "$PROJECT" --owner "$OWNER"

stellar contract invoke --id milestone_proof --source qdit-deployer --network testnet \
  -- submit_milestone_proof --project_id "$PROJECT" --milestone_id "$MILESTONE" \
     --submitter "$OWNER" --proof_hash <64-hex-chars>

stellar contract invoke --id milestone_proof --source qdit-deployer --network testnet \
  -- approve_milestone --project_id "$PROJECT" --milestone_id "$MILESTONE" --approver "$OWNER"

stellar contract invoke --id milestone_proof --source qdit-deployer --network testnet \
  -- get_milestone_status --project_id "$PROJECT" --milestone_id "$MILESTONE"
```

`--proof_hash` is bare hex with no `0x` prefix.

Inspect the deployed interface at any time:

```sh
stellar contract info interface --id milestone_proof --network testnet
```
