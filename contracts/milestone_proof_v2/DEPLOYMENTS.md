# `milestone_proof_v2` deployments

Testnet only. v2 is a new contract beside [`milestone_proof`](../milestone_proof), and
v1 and its records are untouched. Like v1, v2 has no admin and no upgrade entry point,
so a fix ships as a new contract id: the newest row below is the current one.

## Current

| | |
| --- | --- |
| Network | Testnet (`Test SDF Network ; September 2015`) |
| Contract ID | [`CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB`](https://stellar.expert/explorer/testnet/contract/CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB) |
| WASM hash | `bce764f43120e4ea74b692d2051b33e8be8aba6553eb23e9d9e7101605e6a900` |
| WASM upload tx | [`a9500ede…5c23fa`](https://stellar.expert/explorer/testnet/tx/a9500edeeb8e7588b29cdbc4b90186c9e8254b804ae8a695b6f41d55d55c23fa) |
| Deploy tx | [`d979fe53…a295fd`](https://stellar.expert/explorer/testnet/tx/d979fe5311e70cdc54ad70cdc5ae597f30cb1462c3aec92aad7dc1cf6aa295fd) |
| Deployed | 2026-11-14 |
| Source | `d22a406` (Merkle scheme v2, D-124), on top of `main` at `37af7a6` (QDIT-15: TTL on every write) |
| Deployer | `GDSB6DG33VYIQYRLWBM5XB6H2T2BQQOCQTODQXXSGK7Q44CSA5SAIJZG` (`qdit-v2-testnet-deployer`, a Friendbot-funded testnet key) |
| rustc | `1.96.0 (ac68faa20 2026-05-25)`, pinned in [`contracts/rust-toolchain.toml`](../rust-toolchain.toml) |
| stellar CLI | `27.0.0 (5a7c5fe76530bf4248477ac812fc757146b98cc4)`, pinned in CI |
| soroban-sdk | `27.0.4` (`contracts/Cargo.lock`) |
| Merkle scheme | `qdit/merkle/v2` ([`docs/merkle/SPEC.md`](../../docs/merkle/SPEC.md)) |
| Size | 22121 bytes optimized (24622 unoptimized) |
| Exported functions | 14 |

The TypeScript client for this id is
[`packages/milestone-proof-v2-bindings`](../../packages/milestone-proof-v2-bindings).

## Check the hash

The WASM hash is the point of the table: rebuilding this source with the versions
above has to give the same hash, or the deployed bytes are not this code.

From a checkout where `contracts/milestone_proof_v2`, `contracts/Cargo.lock` and
`contracts/rust-toolchain.toml` are as at `d22a406`:

```sh
cd contracts
stellar --version          # 27.0.0
rustc --version            # 1.96.0, from rust-toolchain.toml
stellar contract build --package milestone_proof_v2
# Wasm Hash: bce764f43120e4ea74b692d2051b33e8be8aba6553eb23e9d9e7101605e6a900

stellar contract fetch --id CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB \
  --network testnet --out-file /tmp/onchain.wasm
shasum -a 256 /tmp/onchain.wasm   # the same hash
```

The build doesn't depend on the checkout's path: a copy built in another directory
gave the same hash. CI builds the wasm on every push to `main` and uploads it (the
`contracts — build wasm` job, artifact `milestone_proof_v2-wasm`), so its hash can be
compared by hand. CI doesn't check it: the hash changes with every source change,
until the next deploy.

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
| [`CDDIVHDM66BHZ3ZWHTYXSD5KHL4S5SJOALDSHR3UATRZ655POIKSBT6N`](https://stellar.expert/explorer/testnet/contract/CDDIVHDM66BHZ3ZWHTYXSD5KHL4S5SJOALDSHR3UATRZ655POIKSBT6N) | Deployed 2026-11-14 from `37af7a6` (wasm `8b1d6944…3548`, deploy tx [`0db66be1…`](https://stellar.expert/explorer/testnet/tx/0db66be185c999a410d0f9cfd57b2e3ef71d3cfd6379f6d02cefdbe6d243857b)). Has TTL, but uses Merkle scheme v1, whose leaf has no version. Replaced the same day under D-124. |
| [`CCLOK4SW7DYO7EMUDPE2YSP32VADA3MF6ULKBM2X6H4DS3OXOV4ZQFH3`](https://stellar.expert/explorer/testnet/contract/CCLOK4SW7DYO7EMUDPE2YSP32VADA3MF6ULKBM2X6H4DS3OXOV4ZQFH3) | Deployed 2026-11-10 for the batch benchmark ([`docs/merkle/BENCHMARK.md`](../../docs/merkle/BENCHMARK.md)), before QDIT-15. Its writes don't extend TTL. Left as the benchmark's record; use nothing else on it. |
