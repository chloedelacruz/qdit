<p align="center">
  <img src="web/public/icon-512.png" alt="qdit" width="120" height="120" />
</p>

<h1 align="center">qdit</h1>

<p align="center">
  <strong>Builder operations → milestone approvals → on-chain proof</strong>
</p>

<p align="center">
  Run projects, tasks, milestones and deployments in one hub, then anchor every
  milestone's proof hash on <a href="https://stellar.org">Stellar</a> so “approved vs
  actually shipped” is ledger-true.
</p>

<p align="center">
  <a href="https://drive.google.com/file/d/1auBXzTmkw0Lvs7eq_WAqJD12DT0kDx1e/view?usp=sharing"><img src="https://img.shields.io/badge/▶_Demo_video-EA4335?style=for-the-badge&logo=googledrive&logoColor=white" alt="Demo video" /></a>
  <a href="https://docs.google.com/presentation/d/1WNYg2brDl0bo-e9BkYXfPY9PjTfNUpK-TKeA31Zbid4/edit?usp=sharing"><img src="https://img.shields.io/badge/Pitch_deck-F4B400?style=for-the-badge&logo=googleslides&logoColor=white" alt="Pitch deck" /></a>
</p>

<p align="center">
  <a href="https://stellar.expert/explorer/testnet/contract/CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG"><img src="https://img.shields.io/badge/Stellar-Testnet_Contract-7D00FF?style=for-the-badge&logo=stellar&logoColor=white" alt="Stellar testnet" /></a>
</p>

<p align="center">
  <a href="https://drive.google.com/file/d/1auBXzTmkw0Lvs7eq_WAqJD12DT0kDx1e/view?usp=sharing">Demo video</a> ·
  <a href="https://docs.google.com/presentation/d/1WNYg2brDl0bo-e9BkYXfPY9PjTfNUpK-TKeA31Zbid4/edit?usp=sharing">Pitch deck</a> ·
  <a href="https://stellar.expert/explorer/testnet/contract/CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG">Testnet contract on Stellar Expert</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/Soroban-7D00FF?style=flat-square&logo=stellar&logoColor=white" alt="Soroban" />
  <img src="https://img.shields.io/badge/Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/Freighter-0B0D10?style=flat-square&logo=stellar&logoColor=white" alt="Freighter" />
</p>

---

## Problem

Builder teams plan and track in Linear, Notion, Jira and a spreadsheet — then claim
delivery to a grant program, a client or a DAO.

That creates a trust gap:

- **“Done” is a database column.** Whoever owns the tracker can set it, unset it and
  backdate it, and nobody outside the workspace can tell.
- **Approval leaves no receipt.** A reviewer clicks approve; the evidence is a screenshot
  in a thread that outlives nothing.
- **Reporting is re-typed by hand.** The tracker, the grant report and the ledger are
  three separate stories about the same work.
- **Proof does not survive the team.** Vendor churn, a lapsed seat, a migrated workspace —
  the history goes with the tool.

In short: **project management has no independently verifiable record of what shipped.**

## Solution

**qdit** is a builder task hub — with Stellar as the proof layer.

| Layer | What it does |
| --- | --- |
| **Hub + board** | Projects, tasks, milestones, deployments and proofs, project-scoped by default |
| **Milestone state machine** | Each milestone tracks lifecycle: Proposed → Submitted → Approved \| Rejected |
| **Approval flow** | Approve/reject reserved to the project owner, enforced in Postgres *and* on chain |
| **milestone_proof (Soroban)** | Anchor SHA-256 milestone hashes on Stellar with owner auth |
| **Public receipt** | Proof digest, transaction hash, signer, network and ledger stay on screen and on the ledger — not in your database |

**Result:** every approved milestone leaves a hash anyone can verify against the ledger.
Approved vs shipped stops being a claim and becomes a fact.

## Vision

Most builder programs pay against milestones. Most milestones are attested by a
screenshot.

**qdit** closes the gap:

1. Run the real work — board, tasks, milestones, deployments — in one project-scoped hub.
2. Move a milestone through the contract's own state machine, so the database can never
   reach a state the chain refuses to reproduce.
3. Hash the milestone's state and anchor it on Soroban, signed by the builder's own wallet.
4. Publish the digest, not the data, so a reviewer can verify a milestone was in a given
   state at a given time without access to the workspace.

> Approved vs shipped becomes a receipt, not a marketing claim.

---

## Demo, deck and data

| Asset | Link |
| --- | --- |
| **Demo video** — end-to-end walkthrough | [Watch on Google Drive](https://drive.google.com/file/d/1auBXzTmkw0Lvs7eq_WAqJD12DT0kDx1e/view?usp=sharing) |
| **Pitch deck** — 14 slides, problem → architecture → proof | [Open in Google Slides](https://docs.google.com/presentation/d/1WNYg2brDl0bo-e9BkYXfPY9PjTfNUpK-TKeA31Zbid4/edit?usp=sharing) |
| **Live testnet transaction** — `approve_milestone`, ledger 4126783 | [View on Stellar Expert](https://stellar.expert/explorer/testnet/tx/4d2f27982c7714f418b7506f6c51b04edc1a2976f2c74a05573d19173d31e5f5) |
| **Deployed contract** — `milestone_proof`, 6 functions | [View on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG) |

---

## Features

### On-chain registry (`contracts/`)

- **Milestone proofs** — SHA-256 hash per `(project_id, milestone_id)`, `version` increments on every re-submission
- **Approval lifecycle** — `Proposed → Submitted → Approved | Rejected`, approve/reject reserved to the project owner
- **Owner auth** — every write requires `require_auth()`; a transfer requires **both** the outgoing and incoming owner
- **Persistent storage + TTL** — ~30-day threshold, extended to ~90 days on every write
- **Events** — `(qdit, register|transfer|submit|approve|reject)` with **indexed `project_id` topic**

### App (`web/`)

- Project-scoped **board**: tasks, milestones, deployments, proofs, drag-and-drop, role-gated controls
- Supabase Auth via **wallet sign-in (SEP-10)** + 30 RLS policies over 8 tables
- **Anchoring** and **payments** built browser-side: prepare → wallet signs → server verifies and submits
- `/wallet` — connect, disconnect, XLM balance from Horizon, send a Testnet payment
- Typed URL filter state, so a filtered view is shareable and survives a refresh

**Responsive down to phone width.** Below `lg` (1024px) the sidebar becomes a sheet behind
a menu button and every panel stacks to one column. List rows shed optional columns using
**container** queries rather than viewport breakpoints, because the same row renders
full-width on `/tasks` and inside a half-width dashboard panel:

<img src="docs/screenshots/submission/mobile.png" alt="The qdit dashboard at phone width, sidebar collapsed behind a menu button and panels stacked" width="300" />

### Data layer (`supabase/`)

- 11 plain-SQL migrations, 8 tables, 7 enums, triggers, indexes, 30 RLS policies
- `queries.ts` is the only read path; every function returns `Page<T>` so no view renders an unbounded list by accident
- `actions.ts` re-validates with the same zod schema the client used and returns `{ ok, error, fieldErrors }` instead of throwing

---

## Deployed contracts

The app runs against **testnet**. Mainnet is not deployed yet — the contract has no admin
address and no `upgrade` entry point, so that decision is deliberately still open.

### Stellar Testnet — sandbox

| Field | Value |
| --- | --- |
| **Network** | Stellar Testnet (`Test SDF Network ; September 2015`) |
| **Contract ID** | [`CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG`](https://stellar.expert/explorer/testnet/contract/CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG) |
| **CLI alias** | `milestone_proof` |
| **WASM hash** | `d4bbe221cbe9837cf277448d0fe3aa99cf0dd9213a98db15b671a34dadf2a8b4` |
| **Deployer** | `GC5N7WGWHHZEJ2PEIYAREWKGNQSWR3CME2HXBXKOJ65F3MPL27R774JZ` |
| **Size** | 10777 bytes optimized (11899 unoptimized) · 6 exported functions |

**Explorer links**

- [Contract on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG)
- [Deploy transaction (Expert)](https://stellar.expert/explorer/testnet/tx/afcf108fc640fac527e474f9593c050712a9b860ea5351bc43951f465d780ddb)
- [WASM upload transaction (Expert)](https://stellar.expert/explorer/testnet/tx/1d1483f02b3e2233cb60d67ac4ad1e0fe57b96b5fa43d71867daf5c5d7d92cf6)

The **WASM hash is the point of that table**: anyone can rebuild this source with
`stellar contract build` and check the hash matches what is deployed. If it does not,
the deployed bytes are not this code.

Deployment is **not** upgradable — no admin address, no `upgrade` entry point, by choice.
A bug means deploying a new contract id and migrating the `chain_contract_id` the app
stores per project. That migration is near-free while `projects.chain_contract_id` is null
everywhere and `milestone_anchors` is empty, and grows with every registered project.

### Verified live on this deployment

Beyond the 26 contract unit tests, checked against the deployed contract itself:

- `create_project_ref` emits its event and sets the owner.
- `transfer_project_owner` **cannot be assembled without the incoming owner's signature** —
  the CLI refuses with `Missing signing key for account G…`. That is the two-signature rule
  holding in production, not just in `mock_auths`.
- After a transfer, the previous owner gets `Error(Contract, #4)` `NotAuthorized` on the
  same project, so rights genuinely move rather than being shared.

> A caution learned while checking this: `stellar contract invoke` silently signs **every**
> auth entry it holds a local key for. A transfer between two identities that are both in
> your keystore therefore looks like it needed one signature. It did not — use an address
> you hold no key for to see the requirement.

---

## Next phase — the open decisions

Each item is a known open decision — a scope call rather than a task waiting to be done.
Nothing here blocks the current build; the order is what the next goal makes relevant.

### 1. Owner handover from the app (not the CLI)

- `transfer_project_owner` is reachable only from the Stellar CLI today
- A handover needs two signatures, so the UI has to hold a half-signed envelope between two people
- Until then a wrong-but-controlled owner address is fixable only by someone with CLI access

### 2. Settle the upgrade path before mainnet

- No admin address and no `upgrade` entry point, by choice
- A bug therefore means a new contract id and a per-project migration of `chain_contract_id`
- Cost scales with how many projects are already registered — check that before assuming a redeploy is cheap

### 3. Make chain state visible everywhere

- Anchor state and `stale` mismatches show on the milestone, but not on the board or dashboard
- Version history per milestone, read back from the ledger rather than the database
- A public audit page per project, readable logged out

### 4. Harden the public API surface

- Rate-limit `/api/verify-tx` before onboarding at any scale
- `/api/balance` is behind the auth gate so it cannot be used as an open proxy — keep it that way

### 5. Invitations with delivery

- `add_project_member_by_*` grants access; it does not send an invitation, so the person must already have an account
- An admin can currently distinguish “no account” from “already a member” — inherent to inviting with no delivery
- Adding delivery lets the email path invert: send to any address and stop answering the existence question

### 6. Mobile + polish

- The sidebar already becomes a sheet below `lg`; the rest of the density pass is desktop-first
- Light-mode contrast pass, keyboard shortcuts
- Mainnet fee estimates documented before the mainnet deploy

**Priority order:** upgrade path → handover → chain visibility → rate limiting →
invitations → mobile. The two contract decisions come first because they are the only
ones that get more expensive the longer they wait.

---

## Stellar wallet integration (testnet)

End-to-end wallet flow on **Stellar Testnet**, signed with Freighter and verified
on-chain. Source images live in
[`docs/screenshots/stellar_wallet_integration/`](docs/screenshots/stellar_wallet_integration).

| Field | Value |
| --- | --- |
| Network | Stellar Testnet (`Test SDF Network ; September 2015`) |
| Wallet | [`GCZFICVAJ4KEI45HPFDI27HH4SG7XBYNUDSJRKKRIERF6GLY3HV6QM4F`](https://stellar.expert/explorer/testnet/account/GCZFICVAJ4KEI45HPFDI27HH4SG7XBYNUDSJRKKRIERF6GLY3HV6QM4F) |
| Contract | [`CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG`](https://stellar.expert/explorer/testnet/contract/CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG) |

### 1. Wallet setup

Freighter installed, switched to **Stellar Testnet**, and funded from Friendbot
with **10,000 XLM**.

<img src="docs/screenshots/stellar_wallet_integration/wallet_setup.png" alt="Freighter on Stellar Testnet funded with 10,000 XLM" width="360" />

| Field | Value |
| --- | --- |
| Network | Stellar Testnet |
| Account | [`GCZFICVAJ4KEI45HPFDI27HH4SG7XBYNUDSJRKKRIERF6GLY3HV6QM4F`](https://stellar.expert/explorer/testnet/account/GCZFICVAJ4KEI45HPFDI27HH4SG7XBYNUDSJRKKRIERF6GLY3HV6QM4F) |
| Created | 2026-08-13 20:51:51 UTC (Friendbot) |
| Initial balance | 10,000 XLM |

The app links the same Friendbot for an unfunded account rather than erroring —
`friendbotUrl()` in `src/lib/wallet.ts`, reached from the `funded: false` state.

### 2. Wallet connection

The wallet is the credential: connecting it is how you sign in, and an address
the app has never seen leads to `/register` rather than to a session.

**Wallet options available.** `connectWallet()` opens the kit's chooser rather than
hard-wiring one extension — Freighter, Albedo and xBull are detected and ready, and the
ones that are not installed offer an install link instead of failing silently:

![The Connect Wallet chooser on the qdit landing page, listing Freighter, Albedo, xBull, Fordefi and Rabet](docs/screenshots/stellar_wallet_integration/wallet_options_available.png)

**Wallet connected.** Once a wallet is chosen, `/wallet` shows the connected address read
back from the extension, the network it is on, and a disconnect control:

![The qdit wallet page showing a connected Testnet address with balance tiles and the send form](docs/screenshots/stellar_wallet_integration/wallet_connected.png)

The landing page before connecting, for contrast — the wallet is the only way in:

![The qdit landing page, live on Stellar Testnet, with Connect wallet as the way in](docs/screenshots/stellar_wallet_integration/connect_wallet.png)

| Behaviour | Code |
| --- | --- |
| **Connect** — opens the kit's chooser, returns the public key | `connectWallet()` in `src/lib/wallet.ts` |
| Challenge exchange — SEP-10 signature, then a Supabase session | `src/app/api/auth/wallet/` |
| **Disconnect** — drops the kit's stored address; sign-out does both | `disconnectWallet()`, called from `/wallet` and from sign-out |
| Live address changes | `onWalletState()` (kit `STATE_UPDATED` event) |
| Connected address, balance and send form | `/wallet` — `src/app/(app)/wallet/page.tsx` |

The address on `/wallet` is read back from the wallet rather than stored, so the
page cannot claim a connection the extension does not agree with.
`@creit.tech/stellar-wallets-kit` is imported inside each function because it
touches `localStorage` during module evaluation, which breaks server rendering
of client components.

Sessions themselves stay with Supabase: a wallet session is an ordinary one with an
ordinary `auth.uid()`, and no RLS policy has ever seen a wallet. The address is bound
to the account once, at registration, and cannot be changed afterwards.

### 3. Balance handling

The connected account's XLM balance, read from testnet Horizon by `GET /api/balance` and
shown as **three tiles rather than one** — Total, Spendable and Reserve:

![The wallet page balance section showing Total XLM, Spendable and Reserve tiles](docs/screenshots/stellar_wallet_integration/wallet_connected.png)

The same account confirmed independently on Stellar Expert:

![Account balance on Stellar Expert testnet](docs/screenshots/stellar_wallet_integration/balance_handling.png)

| Field | Value |
| --- | --- |
| Balance | `9,999.9059307 XLM` — 10,000 minus fees for 3 payments |
| Total payments | 3 |
| Reported as | `balance`, `reserve`, `spendable` |

Three figures, not one: the protocol will not let an account drop below a
minimum tied to its subentry count, so `spendable` — balance minus reserve minus
fee headroom — is the only one that answers “how much can I send”, and it is the
number the send form enforces. A 404 from Horizon comes back as `funded: false`
rather than an error, because on Testnet that is one Friendbot click from being
funded.

Amounts are `bigint` stroops throughout (`src/lib/stellar.ts`). Seven decimal places do
not survive a round trip through a float, and a rounding error in a balance is a wrong
balance.

### 4. Transaction flow

A milestone approval anchored on-chain — `approve_milestone` invoked on the
deployed `milestone_proof` contract, signed in the browser with Freighter:

![Successful transaction on Stellar Expert testnet](docs/screenshots/stellar_wallet_integration/transaction.png)

| Field | Value |
| --- | --- |
| **Status** | ✅ Successful |
| **Transaction hash** | [`4d2f27982c7714f418b7506f6c51b04edc1a2976f2c74a05573d19173d31e5f5`](https://stellar.expert/explorer/testnet/tx/4d2f27982c7714f418b7506f6c51b04edc1a2976f2c74a05573d19173d31e5f5) |
| Ledger | 4126783 |
| Processed | 2026-08-13 21:08:02 UTC |
| Source account | [`GCZFIC…V6QM4F`](https://stellar.expert/explorer/testnet/account/GCZFICVAJ4KEI45HPFDI27HH4SG7XBYNUDSJRKKRIERF6GLY3HV6QM4F) |
| Invoked | `approve_milestone(project_id, milestone_id, approver)` on [`CBP3NKXC…MB7M4OHVG`](https://stellar.expert/explorer/testnet/contract/CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG) |
| Max fee | 0.0020525 XLM |
| Fee charged | 0.0010703 XLM |
| Transaction size | 976 bytes |

**The result is shown back to the user, not just written to a ledger.** The proof registry
at `/proofs` verifies any transaction hash against Horizon and renders the outcome in the
app — result, transaction, source account, ledger, timestamp and operation count, each
hash carrying a copy button and a link to the explorer:

![The qdit proof registry verifying the anchoring transaction: Result Succeeded, ledger 4,126,783](docs/screenshots/stellar_wallet_integration/transaction_result.png)

`Succeeded` is asserted, not assumed: a transaction can be included in a ledger and still
have failed, so `/api/verify-tx` reports the two states separately rather than treating
"found" as an endorsement. The milestone row keeps the same receipt after anchoring —
a transaction that leaves nothing behind is indistinguishable from one that never
happened, so the hash stays put rather than flashing past in a toast.

Failures are shown the same way. Simulation runs *before* the wallet is asked to
sign, so a contract error surfaces as a message instead of a paid-for failed
transaction, and a rejected signature is reported as a rejection
(`isRejectedError()`) rather than as a crash.

Payments split the same way anchoring does, and for the same reason — the key is in the
browser:

```text
preparePayment  → server: validate, load the account, build unsigned XDR
(wallet)        → browser: sign the XDR string, nothing else
sendPayment     → server: re-verify the envelope, submit to Horizon
```

`assertPayment` re-derives the destination, amount, asset and source from the signed
envelope before submitting. A wallet signs whatever it is handed, and the client could
have swapped the string — so the receipt on screen cannot describe a different
transaction from the one that was sent. Paying an address that does not exist yet is
silently a `createAccount` rather than a `payment`; nothing about a payment is written
to Postgres, because the ledger is the record.

---

## Tech stack

| Layer | Package | Badge |
| --- | --- | --- |
| Smart contracts | [soroban-sdk](https://crates.io/crates/soroban-sdk) `27.0.4` | ![Soroban](https://img.shields.io/badge/soroban--sdk-27.0.4-7D00FF?logo=rust&logoColor=white) |
| Contract language | [Rust](https://www.rust-lang.org/) — `wasm32v1-none` | ![Rust](https://img.shields.io/badge/Rust-stable-black?logo=rust) |
| CLI / deploy | [Stellar CLI](https://developers.stellar.org/docs/tools/cli) `27.x` | ![Stellar](https://img.shields.io/badge/stellar--cli-27.x-7D00FF?logo=stellar&logoColor=white) |
| Frontend | [Next.js](https://nextjs.org/) `16` + [React](https://react.dev/) `19` | ![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs) |
| Language | [TypeScript](https://www.typescriptlang.org/) | ![TS](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white) |
| Database + auth | [Supabase](https://supabase.com/) — Postgres, RLS, `@supabase/ssr` | ![Supabase](https://img.shields.io/badge/Supabase-Postgres_+_RLS-3FCF8E?logo=supabase&logoColor=white) |
| Chain client | [@stellar/stellar-sdk](https://www.npmjs.com/package/@stellar/stellar-sdk) | ![SDK](https://img.shields.io/badge/stellar--sdk-16-7D00FF?logo=stellar&logoColor=white) |
| Wallet | [@creit.tech/stellar-wallets-kit](https://www.npmjs.com/package/@creit.tech/stellar-wallets-kit) + Freighter | ![Freighter](https://img.shields.io/badge/Freighter-wallet-0B0D10?logo=stellar&logoColor=white) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) `v4` + [shadcn/ui](https://ui.shadcn.com/) on Radix | ![Tailwind](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white) |
| Forms | [react-hook-form](https://react-hook-form.com/) + [zod](https://zod.dev/) `4` | ![zod](https://img.shields.io/badge/zod-4-3E67B1?logo=zod&logoColor=white) |
| Tests | [Vitest](https://vitest.dev/) + [Playwright](https://playwright.dev/) | ![Tests](https://img.shields.io/badge/Vitest_+_Playwright-6E9F18?logo=vitest&logoColor=white) |
| Fonts | Geist · Geist Mono | ![Fonts](https://img.shields.io/badge/fonts-Geist-000000?logo=vercel&logoColor=white) |

---

## Repository layout

```text
qdit/                            # git repo root
├── web/                         # PRIMARY app (Next.js hub + wallet + anchoring)
│   ├── src/app/                 # routes: (app) shell, api/, login, register
│   ├── src/lib/                 # queries · actions · filters · wallet · chain/
│   └── e2e/                     # Playwright specs + seed contract
├── contracts/                   # Soroban milestone_proof (Rust workspace)
├── supabase/                    # SQL migrations, RLS policies, local config
├── docs/screenshots/            # Wallet integration evidence
├── materials/                   # Brand source material
├── .github/workflows/
└── README.md
```

---

## Architecture

```text
   Browser                  web/ (Next.js server)          Stores
 ┌────────────┐            ┌────────────────────┐      ┌──────────────────┐
 │ Freighter  │  sign XDR  │ queries · actions  │ RLS  │ Supabase Postgres│
 │  wallet    │◄──────────►│ api/balance        ├─────►│ 8 tables · 30    │
 └─────┬──────┘            │ api/auth/wallet    │      │ policies         │
       │ SEP-10            └─────────┬──────────┘      └──────────────────┘
       │                             │ build · simulate · verify · submit
       │                             ▼
       │                   ┌────────────────────┐      ┌──────────────────┐
       └──────────────────►│ Soroban RPC        ├─────►│ milestone_proof  │
                           │ Horizon            │      │ (Stellar Testnet)│
                           └────────────────────┘      └──────────────────┘
```

Because the wallet signs in the browser, anchoring is three steps rather than one server
action:

```text
prepareMilestoneAnchor   server: authorize, hash, build + simulate → XDR
  ↓
signTransaction          browser: the wallet signs that string, nothing else
  ↓
submitMilestoneAnchor    server: verify the envelope, submit, poll, record
```

**Step 3's verification is not optional.** Without it a user could sign an arbitrary
transaction and have the server record it as an authentic anchor. `assertInvocation` in
`src/lib/chain/client.ts` parses the envelope and refuses anything that is not exactly one
`invokeHostFunction` against the expected contract and function, and `signer_address` is
read out of the verified transaction rather than from `profiles.wallet_address`.

The chain never sees a milestone's content — only a SHA-256 of it, so anyone can verify a
milestone was in a given state at a given time without being handed the data.
`src/lib/milestone-hash.ts` defines exactly what that digest covers; changing it
invalidates every anchor already on the ledger, silently, so `milestone-hash.test.ts` pins
the encoding.

Anchoring is **additive**: it never writes `milestones.status`. A milestone can be approved
in the app and not yet anchored, or anchored under a hash that no longer matches — the UI
shows both and marks a mismatch `stale` rather than hiding it. Making the chain write a
precondition would mean nobody without a funded wallet could move a milestone at all.

---

## Contract interface

| Function | Auth | Description |
| --- | --- | --- |
| `create_project_ref(project_id, owner)` | owner | Register a project on chain; errors `ProjectExists` (1) if the id is taken |
| `transfer_project_owner(project_id, current_owner, new_owner)` | **both** | Hand a project over; milestone records untouched |
| `submit_milestone_proof(project_id, milestone_id, submitter, proof_hash)` | submitter | Sets status `Submitted`, increments `version`, stamps the ledger timestamp |
| `approve_milestone(project_id, milestone_id, approver)` | approver = owner | Only valid from `Submitted` |
| `reject_milestone(project_id, milestone_id, approver)` | approver = owner | Only valid from `Submitted` |
| `get_milestone_status(project_id, milestone_id)` | none | Read anchored milestone state; errors `MilestoneNotFound` (3) |

**Milestone statuses:** `Proposed` · `Submitted` · `Approved` · `Rejected` — a rejected
milestone may be re-submitted; an approved one is terminal.

**Errors:** `ProjectExists = 1` · `ProjectNotFound = 2` · `MilestoneNotFound = 3` ·
`NotAuthorized = 4` · `InvalidStatus = 5` · `IdTooLong = 6`

**Events:** topic 0 is always `qdit` so one predicate filters the contract; topic 2 is the
indexed `project_id` so a consumer can watch one project without decoding each body.
Declared with `#[contractevent]`, so they appear in the contract spec and
`stellar contract bindings typescript` generates their types.

**Storage:** `persistent`; every write extends the TTL of every key it touches back out to
~90 days, topped up whenever fewer than ~30 remain.

**Ids are `String`, not `Symbol`** — the app's ids are 36-character UUIDs, and `Symbol`
caps at 32 with an alphabet excluding `-`. Ids are capped at 64 characters (`IdTooLong`)
so a caller cannot make the ledger carry an unbounded key.

**A transfer needs two signatures** — the outgoing signature proves the right to give the
project away; the incoming one proves the destination is an address someone actually
controls. Requiring only the first would let a single typo strand a project forever, since
there is no admin and no upgrade path. It does **not** recover a lost key: a lost key
cannot sign as `current_owner`.

---

## Quick start — app (`web/`)

Prerequisites: Node.js 20.9+, a Supabase project (or the
[Supabase CLI](https://supabase.com/docs/guides/cli) for a local stack), and
[Freighter](https://www.freighter.app/) set to **Stellar Testnet**.

```bash
cd web                         # install from web/, not the repo root
cp .env.example .env.local     # fill in your Supabase project values
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) → `/login` → connect Freighter →
register a username and email. Fund the account from Friendbot if it is new, then
`/wallet` shows the balance and can send a Testnet payment.

```bash
npm run lint
npm run typecheck
npm test                       # Vitest
npm run build
```

`npm install` from the repo root *appears* to work, because Node resolves upward.
Install from `web/`.

Database, with the Supabase CLI:

```bash
supabase start           # local stack
supabase db reset        # apply migrations + seed
```

Migrations are plain SQL under `supabase/migrations/`. Apply new ones with the CLI, which
writes `supabase_migrations.schema_migrations`; pasting SQL into the dashboard editor does
not, and the repo then has no record of a change that is live.
`src/lib/types/database.ts` is **hand-written** — change it in the same commit as any
migration, because nothing regenerates it.

> **Never apply `supabase/seed.sql` to a hosted project.** It creates local-stack accounts
> with a plaintext password and its header says so.

End-to-end tests build and serve the app themselves on port 3100, against the real
Supabase project with RLS enforced — there are no fixtures, and credentials come from
`E2E_EMAIL` / `E2E_PASSWORD` in `.env.local`:

```bash
cd web
npx playwright install chromium   # once
npm run test:e2e
```

### Network selection

The app defaults to **testnet**. Two env vars decide the chain layer:

```bash
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID=CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG
```

**Leave the contract id empty and anchoring is absent rather than broken** — the controls
simply do not render, which is how CI builds it.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key — RLS is what protects the data, not this key |
| `NEXT_PUBLIC_SITE_URL` | `http://127.0.0.1:3000` locally |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` |
| `NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID` | deployed contract id, or empty to disable anchoring |
| `SUPABASE_SECRET_KEY` | server-only; required for wallet sign-in |
| `STELLAR_AUTH_SERVER_SECRET` | server-only; signs the SEP-10 challenge. An ordinary keypair, generated once and never funded |

Every variable is documented inline in [`web/.env.example`](./web/.env.example).
`NEXT_PUBLIC_*` values are inlined at build time, so changing them in a hosting dashboard
has no effect until a new build runs — redeploy after editing them.

---

## Quick start — contract

Prerequisites:

- Rust stable + `rustup target add wasm32v1-none`
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli) 27.x

```bash
cd contracts
cargo test
cargo clippy --all-targets -- -D warnings
cargo fmt --all --check

stellar contract build
```

WASM: `contracts/target/wasm32v1-none/release/milestone_proof.wasm`

`clippy`, `rustfmt` and the `wasm32v1-none` target all come from
`contracts/rust-toolchain.toml`, so a `rustup`-managed install picks them up on first use.
A bare `cargo` (Chocolatey, distro package) can run `cargo test` — the tests register the
contract natively rather than as WASM — but nothing else.

### Deploy (testnet)

```bash
# one-time identity
stellar keys generate qdit-deployer --network testnet --fund

stellar contract deploy \
  --wasm target/wasm32v1-none/release/milestone_proof.wasm \
  --source qdit-deployer \
  --network testnet \
  --alias milestone_proof
```

The command prints the contract id (`C…`). Save it as
`NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID` in the app's environment.

### Deploy (mainnet)

Not deployed to mainnet yet — settle the upgrade path first. When it is, the command is
the same against `--network mainnet` with a funded real account. Simulate first; a
simulation is free and needs no key.

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/milestone_proof.wasm \
  --source-account <YOUR_KEY> \
  --network mainnet
```

### Invoke (live contract)

```bash
CONTRACT=CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG
OWNER=$(stellar keys address qdit-deployer)

PROJECT=8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2   # a real project uuid
MILESTONE=c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7

stellar contract invoke --id $CONTRACT --source qdit-deployer --network testnet -- \
  create_project_ref --project_id "$PROJECT" --owner "$OWNER"

stellar contract invoke --id $CONTRACT --source qdit-deployer --network testnet -- \
  submit_milestone_proof --project_id "$PROJECT" --milestone_id "$MILESTONE" \
    --submitter "$OWNER" --proof_hash <64-hex-chars>

stellar contract invoke --id $CONTRACT --source qdit-deployer --network testnet -- \
  approve_milestone --project_id "$PROJECT" --milestone_id "$MILESTONE" --approver "$OWNER"

stellar contract invoke --id $CONTRACT --source qdit-deployer --network testnet -- \
  get_milestone_status --project_id "$PROJECT" --milestone_id "$MILESTONE"
```

`--proof_hash` is bare hex with no `0x` prefix. Inspect the deployed interface at any time
with `stellar contract info interface --id $CONTRACT --network testnet`.

TypeScript bindings are generated from the deployed contract, never hand-written —
`src/lib/chain/bindings.ts` is ESLint-ignored and must be replaced wholesale:

```bash
stellar contract bindings typescript --network testnet \
  --contract-id $CONTRACT --output-dir /tmp/qdit-bindings
cp /tmp/qdit-bindings/src/index.ts web/src/lib/chain/bindings.ts
```

---

## CI

GitHub Actions (`.github/workflows/ci.yml`), three jobs:

1. **web** — `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` (Vitest), `npm run build` with an empty contract id, so the build never depends on a deployed contract
2. **contracts** — `cargo fmt --all --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
3. **wasm** — pinned Stellar CLI, `stellar contract build`, upload the artifact

Every job green on `main`, each step gated in order — a failed lint never reaches a build:

![GitHub Actions run with all three jobs green: web lint/typecheck/build, contracts fmt/clippy/test, contracts build wasm](docs/screenshots/submission/ci.png)

The Playwright suite is deliberately not in CI: it runs against the real hosted Supabase
project with RLS enforced, so it needs `E2E_EMAIL` / `E2E_PASSWORD` and a database that
write specs are allowed to mutate.

### Test output

```bash
cd web && npm test          # Vitest — pure logic, no browser or database
cd contracts && cargo test  # Soroban contract, registered natively
```

![Terminal output: Vitest 183 passed across 9 files, then cargo test 26 passed](docs/screenshots/submission/tests.png)

| Suite | Covers | Result |
| --- | --- | --- |
| Vitest — 9 files | Milestone state machine, filter round trip, strkey validators, milestone hash encoding, SEP-10 challenge, registration tickets, envelope assertions | **183 passed** |
| Soroban — `cargo test` | Auth rules, the approval state machine, two-signature transfer, event emission, id length limits, version counting | **26 passed** |
| Playwright — not in CI | Auth gate, every read, the write and approval flows, mobile nav | 140 passed, 1 skipped |

The milestone rules matter most: `updateMilestoneStatus` mirrors what `milestone_proof`
enforces on-chain, and a silent divergence between the two is the expensive kind, so
`constants.test.ts` pins the TypeScript transitions against the Rust implementation.

---

## Roadmap (near-term)

- [ ] Settle the contract upgrade path, then deploy to mainnet
- [ ] Drive `transfer_project_owner` from the app rather than the CLI (two signatures, one UI)
- [ ] Public audit page per project — verify a milestone from the ledger, logged out
- [ ] Rate-limit `/api/verify-tx` before onboarding at any scale
- [ ] Surface anchor state on the board and dashboard, not only on the milestone
- [ ] Invitation delivery, so the email path can stop answering the account-existence question
