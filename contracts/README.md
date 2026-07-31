# QDIT Soroban contracts

Rust workspace for the QDIT builder task hub's on-chain components.

| Crate | Purpose |
| --- | --- |
| [`milestone_proof`](./milestone_proof) | Registers project references and records milestone proof hashes with an owner-gated approve/reject flow. |

Built against **soroban-sdk 27.0.4** and **stellar CLI 27.x**, targeting `wasm32v1-none`.

## `milestone_proof` interface

| Function | Auth | Notes |
| --- | --- | --- |
| `create_project_ref(project_id: Symbol, owner: Address)` | `owner` | Errors `ProjectExists` (1) if the id is taken. |
| `submit_milestone_proof(project_id: Symbol, milestone_id: Symbol, submitter: Address, proof_hash: BytesN<32>)` | `submitter` | Sets status `Submitted` and stamps `env.ledger().timestamp()`. |
| `approve_milestone(project_id: Symbol, milestone_id: Symbol, approver: Address)` | `approver`, must equal the project owner | Only valid from `Submitted`. |
| `reject_milestone(project_id: Symbol, milestone_id: Symbol, approver: Address)` | `approver`, must equal the project owner | Only valid from `Submitted`. |
| `get_milestone_status(project_id: Symbol, milestone_id: Symbol) -> MilestoneRecord` | none | Read-only; errors `MilestoneNotFound` (3). |

State machine: `Proposed -> Submitted -> Approved | Rejected`. A rejected milestone may be
re-submitted; an approved one is terminal.

Errors: `ProjectExists = 1`, `ProjectNotFound = 2`, `MilestoneNotFound = 3`,
`NotAuthorized = 4`, `InvalidStatus = 5`.

Records live in `persistent` storage and have their TTL extended to ~30 days on every write.

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

The command prints the contract id (`C...`). Save it as `MILESTONE_PROOF_CONTRACT_ID`
for the app's environment.

## Invoke

```sh
OWNER=$(stellar keys address qdit-deployer)

stellar contract invoke --id milestone_proof --source qdit-deployer --network testnet \
  -- create_project_ref --project_id proj_1 --owner "$OWNER"

stellar contract invoke --id milestone_proof --source qdit-deployer --network testnet \
  -- submit_milestone_proof --project_id proj_1 --milestone_id ms_1 \
     --submitter "$OWNER" --proof_hash <64-hex-chars>

stellar contract invoke --id milestone_proof --source qdit-deployer --network testnet \
  -- approve_milestone --project_id proj_1 --milestone_id ms_1 --approver "$OWNER"

stellar contract invoke --id milestone_proof --source qdit-deployer --network testnet \
  -- get_milestone_status --project_id proj_1 --milestone_id ms_1
```

Inspect the deployed interface at any time:

```sh
stellar contract info interface --id milestone_proof --network testnet
```
