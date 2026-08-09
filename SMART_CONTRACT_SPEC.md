# Smart Contract Methodology Spec

A replication guide derived from the Doqtri project. It describes the pattern used to
anchor off-chain content on Stellar/Soroban: what the contract does, how it is
structured, how it is tested, built, deployed, and how the web app connects to it.

Everything below is generalized so it can be lifted into another project. Doqtri's
concrete names (`DoqtriRegistry`, `doc_id`, `NodeStatus`) are kept as running examples,
with the abstraction noted at each step.

---

## 1. What the pattern is

**Content-hash anchoring with an owner-gated registry.**

The chain never stores user content. It stores:

1. A **hash** of the content (SHA-256, 32 bytes) under a caller-chosen string ID.
2. A **monotonic version counter** that increments on every anchored change.
3. A **child record map** for sub-entities of that document (Doqtri: mindmap nodes),
   each carrying a lifecycle status plus free-form metadata strings.
4. **Events** on every write, always carrying the parent ID, so an off-chain indexer
   can resync from the ledger alone.

Value proposition: the ledger becomes an append-only audit trail proving *when* a given
version of a document existed and *what state* its sub-items were in, without publishing
the content itself.

**When to reuse this:** any "prove it happened / prove this is the version we agreed on"
use case — document versioning, build/deploy attestation, milestone tracking, certificate
issuance, supply-chain checkpoints.

**When not to:** if you need on-chain queries over the content, per-item ownership
transfer, tokens, or multi-party approval. This pattern is deliberately single-owner and
write-cheap.

---

## 2. Technology choices

| Layer | Choice in Doqtri | Notes for replication |
| --- | --- | --- |
| Chain | Stellar Testnet (Soroban) | Cheap writes, Rust contracts, no gas-price volatility |
| Contract SDK | `soroban-sdk = "22"` | Pin the major version; the host API shifts between majors |
| Contract language | Rust, `#![no_std]` | Required — Soroban contracts are `no_std` WASM |
| Build target | `wasm32v1-none` | Newer Soroban target; older docs say `wasm32-unknown-unknown` |
| CLI | `stellar-cli` 25.x | Build, deploy, invoke, generate TS bindings |
| Frontend | Next.js App Router + React 19 + TypeScript | Any framework works; the wallet notes in §8 are framework-specific |
| Wallet | `@creit.tech/stellar-wallets-kit` | Multi-wallet (Freighter, Albedo, Hana, Lobstr, Rabet, xBull, Klever, OneKey, Bitget) |
| Chain client | `@stellar/stellar-sdk` v16 | For RPC, tx assembly, Horizon reads |
| App DB / auth | Supabase (Postgres + Auth + Storage, RLS) | Holds the actual content; chain holds only hashes |

---

## 3. Repository layout

```text
<repo>/
├── Cargo.toml            # workspace root: members + release profile + patches
├── contract/
│   ├── Cargo.toml        # cdylib crate
│   └── src/
│       ├── lib.rs        # contract: types, storage, functions, events
│       └── test.rs       # unit tests (mod test; declared at bottom of lib.rs)
├── <app>/frontend/       # Next.js app
│   ├── lib/wallet.ts     # wallet kit access
│   ├── lib/wallet-auth.ts# wallet address -> app session mapping
│   ├── lib/<x>-hash.ts   # content hashing + staleness check
│   └── app/api/auth/wallet/route.ts
├── <app>/backend/        # SQL migrations, prompts
└── .github/workflows/ci.yml
```

Keep the contract crate **outside** the frontend tree and at the workspace root level.
The WASM artifact then lands at `target/wasm32v1-none/release/<crate_name>.wasm` (note:
workspace root `target/`, not `contract/target/`).

### Workspace `Cargo.toml`

```toml
[workspace]
resolver = "2"
members = ["contract"]

[profile.release]
opt-level = "z"        # optimize for size — WASM upload cost scales with bytes
overflow-checks = true # keep ON; arithmetic must trap, not wrap
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
```

`opt-level = "z"` + `lto` + `strip` are the standard Soroban size triple. Do **not**
disable `overflow-checks` to save bytes — a silently wrapping version counter is a
correctness bug.

**Dependency pin gotcha (real, hit in this project):** `ed25519-dalek` 3.x broke
`CryptoRng` against the `ChaCha20Rng` used by `soroban-env-host` 22. Fix applied:

```toml
[patch.crates-io]
ed25519-dalek = { git = "https://github.com/dalek-cryptography/curve25519-dalek", rev = "8016d6d9b9cdbaa681f24147e0b9377cc8cef934" }
```

If `cargo test` fails on trait mismatches inside the Soroban host, check this class of
transitive-crypto-crate conflict first.

### Contract `Cargo.toml`

```toml
[package]
name = "<crate-name>"      # underscores in the WASM filename
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]    # required for WASM output
doctest = false

[dependencies]
soroban-sdk = "22"

[dev-dependencies]
soroban-sdk = { version = "22", features = ["testutils"] }
```

---

## 4. Contract design

### 4.1 Skeleton

```rust
#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    String,
};
```

Four macro roles:

- `#[contracterror]` — a `#[repr(u32)]` enum of failure codes, returned inside `Result`.
- `#[contracttype]` — every struct/enum crossing the host boundary (args, returns, stored
  values, storage keys).
- `#[contract]` — the unit struct that names the contract.
- `#[contractimpl]` — the `impl` block whose public methods become the ABI.

### 4.2 Errors

```rust
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    DocumentAlreadyExists = 1,
    DocumentNotFound = 2,
    NodeNotFound = 3,
}
```

Rules:
- Explicit discriminants, starting at 1. **Never renumber** after deploy — clients map
  codes to messages.
- Only add variants at the end.
- Every fallible entry point returns `Result<T, Error>`, never panics for expected
  failure. Panics burn the fee and give the client no typed information.

### 4.3 Domain types

```rust
/// Lifecycle of a sub-item, from plan to verified deployment.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NodeStatus { Planned, Building, Built, Verified }

/// An anchored document: who owns it, its latest content hash, and version.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Document {
    pub owner: Address,
    pub content_hash: BytesN<32>,
    pub version: u32,
    pub node_count: u32,
    pub updated_at: u64,
}

/// Status record for a single sub-item.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NodeRecord {
    pub status: NodeStatus,
    pub tool: String,        // which builder produced it
    pub artifact_ref: String,// workflow ID, URL, or hash of the output
    pub updated_at: u64,
}
```

Type choices that matter:

- `BytesN<32>` for the hash — fixed width, no length validation needed at runtime.
- `u32` for counters, `u64` for `env.ledger().timestamp()`.
- `Address` for the owner — this is what `require_auth()` operates on.
- Soroban `String` (not `&str`/`std::string::String`) for IDs and free-form metadata.
- **Denormalized `node_count` on the parent.** Soroban has no key enumeration; if you
  want a count you must maintain it yourself on write.
- `updated_at` stored on both records so a reader can order events without an indexer.

### 4.4 Storage keys

```rust
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Doc(String),
    Node(String, String),   // (doc_id, node_id) — composite key
}
```

A single key enum keyed by variant is the idiomatic Soroban namespace. Composite keys
are just multi-field variants — this is how you get a "map of maps" without nested maps
(which would force reading and rewriting the entire map on every node update).

### 4.5 TTL / state archival

```rust
const DAY_IN_LEDGERS: u32 = 17280;          // ~5s per ledger
const TTL_THRESHOLD: u32 = DAY_IN_LEDGERS * 30;
const TTL_EXTEND: u32   = DAY_IN_LEDGERS * 90;
```

Soroban archives persistent entries that run out of TTL; restoring costs the user a fee.
The convention applied everywhere in this contract:

```rust
env.storage().persistent().set(&key, &value);
env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
```

Read as: "if fewer than 30 days of life remain, top it back up to 90 days." Bump the TTL
on **every** write to a key, including writes that only touch the parent record.

Storage tier guidance:
- `persistent()` — user data that must survive (used here for both keys).
- `instance()` — contract-wide config/admin, shares the contract's own TTL.
- `temporary()` — cheap, short-lived (nonces, rate limits). Cannot be restored.

### 4.6 Write functions

Every write follows the same five-step shape:

```rust
pub fn update_document(env: Env, doc_id: String, new_hash: BytesN<32>) -> Result<u32, Error> {
    // 1. load-or-fail
    let key = DataKey::Doc(doc_id.clone());
    let mut doc: Document = env.storage().persistent()
        .get(&key)
        .ok_or(Error::DocumentNotFound)?;

    // 2. authorize against stored state, not against a caller-supplied argument
    doc.owner.require_auth();

    // 3. mutate
    doc.content_hash = new_hash;
    doc.version += 1;
    doc.updated_at = env.ledger().timestamp();

    // 4. persist + extend TTL
    env.storage().persistent().set(&key, &doc);
    env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);

    // 5. emit
    env.events().publish((symbol_short!("doqtri"), symbol_short!("update")), doc_id);
    Ok(doc.version)
}
```

**The critical auth rule:** on creation, authorize the `owner` argument
(`owner.require_auth()`, because there is no stored state yet). On every subsequent
write, authorize `doc.owner` **loaded from storage**. Never trust an owner address passed
in as a parameter on an update path — that is the difference between an owner-gated
registry and a free-for-all.

Creation guards against overwrite instead of upserting:

```rust
if env.storage().persistent().has(&key) {
    return Err(Error::DocumentAlreadyExists);
}
```

This turns "already exists" into a typed signal the client uses for idempotent retry
(§7.2) rather than a silent clobber of someone else's record.

Child-record writes must also load the parent for authorization, and maintain the
denormalized counter exactly once:

```rust
let node_key = DataKey::Node(doc_id.clone(), node_id);
let is_new = !env.storage().persistent().has(&node_key);
// ... set record + extend ttl ...
if is_new {
    doc.node_count += 1;
    env.storage().persistent().set(&doc_key, &doc);
    env.storage().persistent().extend_ttl(&doc_key, TTL_THRESHOLD, TTL_EXTEND);
}
```

Note this makes `set_node_status` an upsert with a lifecycle-free transition model: any
status may follow any other. If your domain needs enforced transitions
(`Planned → Building → Built`), add an explicit check and an `InvalidTransition` error
variant — Doqtri deliberately does not, so a node can be corrected backwards.

### 4.7 Read functions

```rust
pub fn get_document(env: Env, doc_id: String) -> Result<Document, Error> {
    env.storage().persistent()
        .get(&DataKey::Doc(doc_id))
        .ok_or(Error::DocumentNotFound)
}
```

No auth — anchored hashes are public by design, which is what makes the audit story work.
Reads via simulation are free.

### 4.8 Event convention

This is the highest-leverage design decision in the contract, and it is deliberate:

```rust
env.events().publish((symbol_short!("doqtri"), symbol_short!("register")), doc_id);
env.events().publish((symbol_short!("doqtri"), symbol_short!("update")),   doc_id);
env.events().publish((symbol_short!("doqtri"), symbol_short!("node")),     doc_id);
```

- Topic 0 = a constant app namespace, so an indexer can filter every event of this
  contract with one predicate.
- Topic 1 = the action verb.
- **Payload is always the parent ID, for all three actions**, including node writes.

Consequence: an indexer subscribing to `(app, *)` gets a stream of parent IDs to refresh,
and pulls the details with `get_document` / `get_node`. It never has to decode
per-action payload shapes. Emitting the new version number from `update_document` was
explicitly rejected for this reason — the uniform payload is worth more than the extra
field.

`symbol_short!` caps at **9 characters**. Keep the namespace and verbs short
(`register`, `update`, `node`), or use `Symbol::new(&env, "...")` at the cost of more
bytes.

---

## 5. Testing

Tests live in `contract/src/test.rs`, declared with `mod test;` at the bottom of `lib.rs`,
and start with `#![cfg(test)]`.

Harness:

```rust
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String, Symbol};

fn setup(env: &Env) -> (DoqtriRegistryClient<'_>, Address) {
    let contract_id = env.register(DoqtriRegistry, ());
    let client = DoqtriRegistryClient::new(env, &contract_id);
    let owner = Address::generate(env);
    (client, owner)
}

fn hash(env: &Env, seed: u8) -> BytesN<32> { BytesN::from_array(env, &[seed; 32]) }
```

`#[contractimpl]` generates `<Name>Client` with two method families:
- `client.foo(&args)` — panics on error, for happy paths.
- `client.try_foo(&args)` — returns `Result`, for asserting typed errors:
  `assert_eq!(result, Err(Ok(Error::DocumentAlreadyExists)))`.

The required test matrix (all present in this project):

| Test | Proves |
| --- | --- |
| `test_register_document` | Happy path, initial version 1, fields persisted |
| `test_duplicate_register_fails` | Creation guard returns `DocumentAlreadyExists` |
| `test_update_increments_version` | Counter is monotonic across repeated updates |
| `test_update_missing_document_fails` | Typed `DocumentNotFound`, not a panic |
| `test_node_lifecycle` | Full status walk; `node_count` increments **once** per unique child |
| `test_multiple_nodes_counted` | Denormalized counter is correct across N children |
| `test_get_missing_node_fails` | Typed `NodeNotFound` |
| `test_auth_is_required` | **No `mock_all_auths()`** — host rejects the unauthorized call |
| `test_events_emit_doc_id` | Every action emits the agreed topics + parent-ID payload |
| `test_ui_write_path` | End-to-end sequence mirroring exactly what the UI does |

Two of these carry most of the value and are the ones usually missing elsewhere:

**Auth negative test.** Every other test calls `env.mock_all_auths()`. This one must not,
so that a regression removing `require_auth()` actually fails the suite:

```rust
#[test]
fn test_auth_is_required() {
    let env = Env::default();          // no mock_all_auths
    let (client, owner) = setup(&env);
    let result = client.try_register_document(&owner, &doc_id, &hash(&env, 1));
    assert!(result.is_err());
}
```

**Event contract test.** The off-chain indexer depends on the topic/payload shape, so it
is pinned by assertion. Note the host keeps events per invocation, so assert after each
write rather than collecting at the end:

```rust
use soroban_sdk::testutils::Events;
use soroban_sdk::{symbol_short, TryFromVal};

let assert_last = |action: Symbol| {
    let events = env.events().all();
    let ev = events.last().unwrap();
    let topics = &ev.1;
    assert_eq!(Symbol::try_from_val(&env, &topics.get(0).unwrap()).unwrap(), symbol_short!("doqtri"));
    assert_eq!(Symbol::try_from_val(&env, &topics.get(1).unwrap()).unwrap(), action);
    assert_eq!(String::try_from_val(&env, &ev.2).unwrap(), doc_id);
};
```

Also keep a **UI-mirroring test** (`test_ui_write_path`) that runs the client's real
sequence including the deliberate failure: register → duplicate register fails →
update → node writes → assert final state. It is the regression net for the idempotency
strategy in §7.2.

A `contract/test_snapshots/` directory is generated by the SDK on test runs (host state
snapshots). Commit it — diffs there flag unintended host-level behavior changes.

---

## 6. Build, deploy, CI

### Local

```bash
rustup target add wasm32v1-none
cargo test -p <crate-name>          # from repo root

cd contract
stellar contract build              # -> ../target/wasm32v1-none/release/<crate_name>.wasm
```

### Deploy to testnet

```bash
stellar keys generate alice --network testnet --fund

stellar contract deploy \
  --wasm ../target/wasm32v1-none/release/<crate_name>.wasm \
  --source alice \
  --network testnet \
  --alias <alias>
```

Record and publish, per deploy: **network, contract ID, WASM hash, deploy tx hash,
WASM-upload tx hash**. Doqtri puts these in a README table with explorer links — the WASM
hash is what lets a third party verify the deployed bytes match the source.

### Invoke from CLI

```bash
CONTRACT=C...

stellar contract invoke --id $CONTRACT --source alice --network testnet -- \
  register_document --owner alice --doc_id "launch-plan" \
  --content_hash 0101010101010101010101010101010101010101010101010101010101010101

stellar contract invoke --id $CONTRACT --source alice --network testnet -- \
  set_node_status --doc_id "launch-plan" --node_id "weekly-report" \
  --status '"Built"' --tool "n8n" --artifact_ref "wf_8Xk2p"

stellar contract invoke --id $CONTRACT --source alice --network testnet -- \
  get_document --doc_id "launch-plan"
```

Enum args are passed as JSON strings: `--status '"Built"'` (note the nested quoting).
`BytesN<32>` is passed as bare hex, no `0x`.

### CI (`.github/workflows/ci.yml`)

Three independent jobs, `concurrency` group with `cancel-in-progress`:

1. **Contract tests** — `dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2`,
   `cargo test -p <crate>`.
2. **Build WASM** — same toolchain plus `targets: wasm32v1-none`, pinned Stellar CLI
   downloaded from the GitHub release tarball, `stellar contract build`, then
   `actions/upload-artifact` with `if-no-files-found: error`.
3. **App** — Node 22, `npm ci`, unit tests, build, with secrets injected as env and a
   placeholder fallback so the build still runs on PRs without secret access.

Pin the CLI version explicitly (`STELLAR_CLI_VERSION: "25.2.0"`), and use
`cache-targets: false` on the WASM job so the host-target cache doesn't collide.

```yaml
- name: Install Stellar CLI
  env:
    STELLAR_CLI_VERSION: "25.2.0"
  run: |
    set -euo pipefail
    asset="stellar-cli-${STELLAR_CLI_VERSION}-x86_64-unknown-linux-gnu.tar.gz"
    url="https://github.com/stellar/stellar-cli/releases/download/v${STELLAR_CLI_VERSION}/${asset}"
    curl -fsSL "$url" -o /tmp/stellar-cli.tar.gz
    tar -xzf /tmp/stellar-cli.tar.gz -C /tmp
    sudo install -m 755 /tmp/stellar /usr/local/bin/stellar
    stellar --version
```

---

## 7. Off-chain side

### 7.1 Hashing — the bridge between app and chain

Content lives in the app database; only its digest goes on chain. Hashing is
**server-side and synchronous**, using `node:crypto`, and it also drives an in-app
staleness check:

```ts
import { createHash } from "node:crypto";

export function hashMarkdown(markdown: string): string {
  return createHash("sha256").update(markdown, "utf8").digest("hex");
}

/** A missing hash counts as stale: no evidence of what the artifact was built from. */
export function isMindmapStale(markdown: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return true;
  return storedHash !== hashMarkdown(markdown);
}
```

Three rules worth carrying over:

1. **Keep this module server-only.** Importing it from a client component pulls Node
   built-ins into the browser bundle. Compute staleness on the server and hand the client
   a boolean.
2. **Fix the encoding explicitly** (`utf8`). The digest is a cross-system contract; an
   implicit encoding difference silently invalidates every anchor.
3. **Absent hash = stale.** Fail toward "re-verify", never toward "assume valid".

The contract wants `BytesN<32>`; this produces a 64-char hex string. Convert with
`Buffer.from(hex, "hex")` at the call boundary.

### 7.2 Idempotent write strategy

The client cannot know whether a `doc_id` is already anchored without a round trip, so
the write path is defined as **register-then-fallback**:

```
try register_document(owner, doc_id, hash)
  └─ Error::DocumentAlreadyExists → update_document(doc_id, hash)
```

This is exactly why the contract returns a typed error rather than upserting, and it is
locked in by `test_ui_write_path`. Retries are safe: a re-sent register lands on update,
and update is idempotent in effect (it bumps the version, but never corrupts state).

### 7.3 Storage split

| Data | Where | Why |
| --- | --- | --- |
| Full content, generated artifacts, layout | App DB (Supabase, RLS-scoped) | Private, mutable, queryable, no chain cost |
| SHA-256 of content | Chain, `content_hash` | Public proof of a specific version |
| Version counter | Chain | Tamper-evident ordering |
| Sub-item status + tool + artifact ref | Chain, `NodeRecord` | The "planned vs shipped" audit claim |
| Wallet ↔ account mapping | App DB / auth | Off-chain identity concern |

---

## 8. Wallet integration

### 8.1 Kit access, lazily imported

`@creit.tech/stellar-wallets-kit` reads `localStorage` **during module evaluation**.
`"use client"` does not mean "browser only" — the framework still renders client
components on the server for initial HTML — so a top-level import crashes every route
that reaches the module with `localstorage?.getItem is not a function`.

Fix: import the kit inside each function, keep everything async, and keep the
browser check inside the function body.

```ts
"use client";

type Kit = typeof import("@creit.tech/stellar-wallets-kit/sdk").StellarWalletsKit;
let initialized = false;

async function kit(): Promise<Kit | null> {
  if (typeof window === "undefined") return null;

  const [{ StellarWalletsKit }, { defaultModules }, { Networks, SwkAppDarkTheme }] =
    await Promise.all([
      import("@creit.tech/stellar-wallets-kit/sdk"),
      import("@creit.tech/stellar-wallets-kit/modules/utils"),
      import("@creit.tech/stellar-wallets-kit/types"),
    ]);

  if (!initialized) {
    StellarWalletsKit.init({
      modules: defaultModules(),
      network: Networks.TESTNET,   // pin the network in one place
      theme: SwkAppDarkTheme,
    });
    initialized = true;
  }
  return StellarWalletsKit;
}

export async function connectWallet(): Promise<string> {
  const wallets = await kit();
  if (!wallets) throw new Error("Wallet connection needs a browser.");
  const { address } = await wallets.authModal();
  return address;
}

export async function disconnectWallet(): Promise<void> {
  const wallets = await kit();
  await wallets?.disconnect();
}

export async function onWalletState(cb: (address: string | undefined) => void) {
  const [wallets, { KitEventType }] = await Promise.all([
    kit(), import("@creit.tech/stellar-wallets-kit/types"),
  ]);
  if (!wallets) return () => {};
  return wallets.on(KitEventType.STATE_UPDATED, (e) => cb(e.payload.address));
}

/** Pure formatting — deliberately does not touch the kit. */
export function shortenAddress(a: string): string {
  return a.length < 10 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`;
}
```

Keep pure helpers (address formatting) out of the async kit path so components can import
them freely.

### 8.2 Wallet → app session bridge

Doqtri does not build a custom JWT layer. It maps a Stellar public key onto a
deterministic Supabase user:

```ts
/** Deterministic app email for a public key. */
export function walletEmail(address: string): string {
  return `${address.toLowerCase()}@stellar.<app>.local`;
}

/** Server-only password derived from a service secret + the address. */
export function walletPassword(address: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createHmac("sha256", secret).update(`<app>-wallet:${address}`).digest("hex");
}

export function isStellarPublicKey(a: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(a);   // Ed25519 public key, base32
}
```

The API route (`POST /api/auth/wallet`) then:

1. Validates the address shape with the regex above.
2. Tries `signInWithPassword(email, derivedPassword)`.
3. On failure, creates the user via the admin client with `email_confirm: true` and
   `user_metadata.wallet_address`.
4. If creation reports "already exists" (message match or HTTP 422), looks the user up
   and resets the password to the derived value — this self-heals accounts created before
   a secret rotation.
5. Returns `access_token` / `refresh_token` for the browser to `setSession`.

The client component connects, POSTs the address, calls `supabase.auth.setSession`,
then `router.refresh()` and navigates to the authenticated area.

> **Security note, stated plainly.** This scheme authenticates *possession of a wallet
> address*, not control of its private key — the route accepts any well-formed `G...`
> string and mints a session for it. It is acceptable for a testnet demo, and it is
> **not** acceptable for production or for anything holding real value. To harden it,
> add a challenge-response step: server issues a nonce, client signs it with the wallet
> (`signMessage` / `signAuthEntry` via the kit), server verifies the Ed25519 signature
> against the claimed public key before minting a session. Everything else in this
> section stays the same. Also note `walletPassword` derives from
> `SUPABASE_SERVICE_ROLE_KEY`, so rotating that secret invalidates every derived password
> — step 4 above is what makes that rotation survivable.

### 8.3 Contract calls from the frontend

**Status in the source project:** not implemented in the current `doqtri/frontend/`. The
frontend does wallet connect/disconnect and the session bridge only; there is no
`NEXT_PUBLIC_CONTRACT_ID`, no bindings directory, and no contract call site. `@stellar/stellar-sdk`
is installed but unused. The README's "Ship panel / vault sync / typed bindings" section
describes a legacy `web/` frontend that is not in this repository — treat that as a design
target, not as code to copy.

The intended shape, to build fresh:

1. Generate a typed client from the deployed contract:
   ```bash
   stellar contract bindings typescript \
     --network testnet --contract-id $CONTRACT --output-dir ./lib/bindings
   ```
2. Read `NEXT_PUBLIC_CONTRACT_ID` from env — never hardcode it in production builds.
3. Build → simulate → sign with the kit's `signTransaction` → submit via RPC → poll for
   confirmation.
4. Reads (`get_document`, `get_node`) go through simulation only: no signature, no fee.
5. UX states to implement: not-connected, account-not-funded (Friendbot link on testnet),
   pending spinner, success with an explorer link, and distinct errors for
   wallet-rejected / unfunded / wrong-network.

---

## 9. Replication checklist

**Contract**
- [ ] Workspace `Cargo.toml` with size-optimized release profile, `overflow-checks = true`
- [ ] `contract/` crate, `crate-type = ["cdylib"]`, `soroban-sdk` pinned to a major
- [ ] `#![no_std]`
- [ ] `#[contracterror]` enum, explicit discriminants from 1, append-only
- [ ] `#[contracttype]` domain structs; `BytesN<32>` for hashes, `Address` for owner
- [ ] `DataKey` enum with composite variants for child records
- [ ] TTL constants; `extend_ttl` after **every** `set`, on every key touched
- [ ] Create path: existence guard → typed `AlreadyExists` error
- [ ] Update paths: `require_auth()` on the **stored** owner
- [ ] Denormalized child counter incremented only when the child key is new
- [ ] Events: `(app_namespace, verb)` topics, parent ID as payload, uniform across actions
- [ ] All public reads unauthenticated and returning typed `NotFound`

**Tests**
- [ ] `mod test;` + `#![cfg(test)]`, `testutils` dev-dependency
- [ ] `setup()` + deterministic `hash(seed)` helpers
- [ ] Happy path, duplicate-create, missing-record, counter correctness
- [ ] One auth test **without** `mock_all_auths`
- [ ] Event topic/payload assertions after each write
- [ ] A test mirroring the exact client write sequence, including the expected failure

**Ops**
- [ ] `rustup target add wasm32v1-none`
- [ ] CI: cargo test, WASM build with a pinned CLI version, artifact upload
- [ ] Deploy record published: network, contract ID, WASM hash, both tx hashes

**App**
- [ ] Server-only hashing module, explicit encoding, missing-hash-is-stale
- [ ] Register-then-fallback-to-update idempotency
- [ ] Wallet kit imported lazily inside functions, network pinned once
- [ ] Wallet → session bridge **with signature verification** (do not ship §8.2 as-is)
- [ ] `NEXT_PUBLIC_CONTRACT_ID` from env
- [ ] Typed bindings generated from the deployed contract, not hand-written

---

## 10. Known gaps in the source implementation

Carry these forward as things to fix, not to copy:

1. **No signature verification in wallet auth** (§8.2) — the biggest one.
2. **Frontend never calls the contract.** The chain layer is CLI-only today; the README
   describes UI features that live in a `web/` directory absent from the repo.
3. **No admin/upgrade path.** No `upgrade`, no admin address, no pause. A bug means
   deploying a new contract ID and migrating. Add `env.deployer().update_current_contract_wasm`
   behind an admin `require_auth()` if you need upgradability — decide before mainnet.
4. **No ownership transfer or deletion.** `owner` is fixed at registration; documents and
   nodes cannot be removed, only superseded.
5. **No status-transition validation.** Any `NodeStatus` can follow any other.
6. **Unbounded string inputs.** `doc_id`, `tool`, and `artifact_ref` have no length caps;
   the only limit is transaction size and the fee the caller pays.
7. **No enumeration.** You cannot list a document's nodes on chain — the indexer must
   reconstruct that from events. This is inherent to the design, hence the uniform event
   payload in §4.8.
