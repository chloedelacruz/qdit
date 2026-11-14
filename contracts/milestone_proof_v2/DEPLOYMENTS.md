# `milestone_proof_v2` deployments

Testnet only. v2 is a new contract beside [`milestone_proof`](../milestone_proof), and
v1 and its records are untouched. Like v1, v2 has no admin and no upgrade entry point,
so a fix ships as a new contract id: the newest row below is the current one.

## Current

| | |
| --- | --- |
| Network | Testnet (`Test SDF Network ; September 2015`) |
| Contract ID | [`CDDIVHDM66BHZ3ZWHTYXSD5KHL4S5SJOALDSHR3UATRZ655POIKSBT6N`](https://stellar.expert/explorer/testnet/contract/CDDIVHDM66BHZ3ZWHTYXSD5KHL4S5SJOALDSHR3UATRZ655POIKSBT6N) |
| WASM hash | `8b1d6944c94a7bcfb3119d6b0444418ad2c10f855237e9408f954beafd3e3548` |
| WASM upload tx | [`3077b36b…323d17`](https://stellar.expert/explorer/testnet/tx/3077b36b51676ba206bed8b6ca61d3a4a8c4abe6031d469b3a87ea1614323d17) |
| Deploy tx | [`0db66be1…43857b`](https://stellar.expert/explorer/testnet/tx/0db66be185c999a410d0f9cfd57b2e3ef71d3cfd6379f6d02cefdbe6d243857b) |
| Deployed | 2026-11-14 |
| Source | `main` at `37af7a6` (QDIT-15: TTL on every write) |
| Deployer | `GDSB6DG33VYIQYRLWBM5XB6H2T2BQQOCQTODQXXSGK7Q44CSA5SAIJZG` (`qdit-v2-testnet-deployer`, a Friendbot-funded testnet key) |
| rustc | `1.96.0 (ac68faa20 2026-05-25)`, pinned in [`contracts/rust-toolchain.toml`](../rust-toolchain.toml) |
| stellar CLI | `27.0.0 (5a7c5fe76530bf4248477ac812fc757146b98cc4)`, pinned in CI |
| soroban-sdk | `27.0.4` (`contracts/Cargo.lock`) |
| Size | 21999 bytes optimized (24491 unoptimized) |
| Exported functions | 14 |

The TypeScript client for this id is
[`packages/milestone-proof-v2-bindings`](../../packages/milestone-proof-v2-bindings).

## Check the hash

The WASM hash is the point of the table: rebuilding this source with the versions
above has to give the same hash, or the deployed bytes are not this code.

From a checkout where `contracts/milestone_proof_v2` and `contracts/Cargo.lock` are as
at `37af7a6`, and the toolchain pin is in place:

```sh
cd contracts
stellar --version          # 27.0.0
rustc --version            # 1.96.0, from rust-toolchain.toml
stellar contract build --package milestone_proof_v2
# Wasm Hash: 8b1d6944c94a7bcfb3119d6b0444418ad2c10f855237e9408f954beafd3e3548

stellar contract fetch --id CDDIVHDM66BHZ3ZWHTYXSD5KHL4S5SJOALDSHR3UATRZ655POIKSBT6N \
  --network testnet --out-file /tmp/onchain.wasm
shasum -a 256 /tmp/onchain.wasm   # the same hash
```

The build doesn't depend on the checkout's path: a copy built in another directory
gave the same hash. CI builds and uploads the same wasm on every push to `main`
(the `contracts — build wasm` job, artifact `milestone_proof_v2-wasm`).

## Deploy a new one

Upload, then deploy from the hash, so both transactions are on record:

```sh
cd contracts
stellar contract build --package milestone_proof_v2
stellar keys generate qdit-v2-testnet-deployer --network testnet --fund   # once; Friendbot
stellar contract upload --wasm target/wasm32v1-none/release/milestone_proof_v2.wasm \
  --source-account qdit-v2-testnet-deployer --network testnet
stellar contract deploy --wasm-hash <hash> \
  --source-account qdit-v2-testnet-deployer --network testnet --alias milestone_proof_v2
```

Then add a row to this file, move the old one to Superseded, and regenerate the
bindings (see their README). Never deploy from a mainnet key, and never commit a
secret: the CLI keeps keys in `~/.config/stellar/identity/`.

## Superseded

| Contract ID | Why |
| --- | --- |
| [`CCLOK4SW7DYO7EMUDPE2YSP32VADA3MF6ULKBM2X6H4DS3OXOV4ZQFH3`](https://stellar.expert/explorer/testnet/contract/CCLOK4SW7DYO7EMUDPE2YSP32VADA3MF6ULKBM2X6H4DS3OXOV4ZQFH3) | Deployed 2026-11-10 for the batch benchmark ([`docs/merkle/BENCHMARK.md`](../../docs/merkle/BENCHMARK.md)), before QDIT-15. Its writes don't extend TTL. Left as the benchmark's record; use nothing else on it. |
