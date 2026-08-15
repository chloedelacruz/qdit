# Submission checklist — Levels 1 to 6

Audited against the repository on **2026-08-15**. Every ✅ below is something a judge can
open and check; every ❌ is genuinely absent, not merely undocumented.

**Where the repo stands:** Levels 1 and 2 are complete. Level 3 needs one item. Levels 4
to 6 need real users, a mainnet deployment and a security review — work that takes
calendar time, not an afternoon of writing.

| Level | Complete | Blocking |
| --- | --- | --- |
| 1 | 6 / 6 | — |
| 2 | 4 / 4 | — |
| 3 | 9 / 10 | Live demo link |
| 4 | 7 / 10 | Analytics · 10+ wallet interactions · feedback summary |
| 5 | 5 / 9 | 50+ users · analytics · feedback iteration (live demo shared with L3) |
| 6 | 4 / 11 | Mainnet · 20+ mainnet users · audit · launch post · user guide · community link |

---

## Standing facts

Figures the levels keep asking for, in one place. Update here first.

| Fact | Value | Verify |
| --- | --- | --- |
| Commits | **90** | `git rev-list --count HEAD` |
| Vitest | **183 passed**, 9 files | `cd web && npm test` |
| Soroban tests | **26 passed** | `cd contracts && cargo test` |
| Playwright | 140 passed, 1 skipped | not in CI — needs `.env.local` |
| CI jobs | **3, green** | `.github/workflows/ci.yml` |
| Testnet contract | `CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG` | [Stellar Expert](https://stellar.expert/explorer/testnet/contract/CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG) |
| WASM hash | `d4bbe221cbe9837cf277448d0fe3aa99cf0dd9213a98db15b671a34dadf2a8b4` | `stellar contract build` |
| Anchoring tx | `4d2f27982c7714f418b7506f6c51b04edc1a2976f2c74a05573d19173d31e5f5` | ledger 4,126,783 |
| Mainnet contract | none | upgrade path unsettled by choice |
| Distinct wallets on chain | **2** (deployer + signer) | see Level 4 below |
| Demo video | [Google Drive](https://drive.google.com/file/d/1auBXzTmkw0Lvs7eq_WAqJD12DT0kDx1e/view?usp=sharing) | |
| Pitch deck | [Google Slides](https://docs.google.com/presentation/d/1WNYg2brDl0bo-e9BkYXfPY9PjTfNUpK-TKeA31Zbid4/edit?usp=sharing) | |
| Live demo URL | none | not deployed |

---

## Level 1 — complete

| # | Requirement | Status | Where |
| --- | --- | --- | --- |
| 1.1 | Project description | ✅ | README → Problem · Solution · Vision |
| 1.2 | Setup instructions (run locally) | ✅ | README → Quick start — app (`web/`) |
| 1.3 | Screenshot: wallet connected state | ✅ | `screenshots/stellar_wallet_integration/wallet_connected.png` |
| 1.4 | Screenshot: balance displayed | ✅ | same frame — Total / Spendable / Reserve tiles |
| 1.5 | Screenshot: successful testnet transaction | ✅ | `screenshots/stellar_wallet_integration/transaction.png` |
| 1.6 | Transaction result shown to the user | ✅ | `screenshots/stellar_wallet_integration/transaction_result.png` — `/proofs` verify |

---

## Level 2 — complete

| # | Requirement | Status | Where |
| --- | --- | --- | --- |
| 2.1 | Live demo link *(optional at this level)* | ❌ | not deployed — see 3.4 |
| 2.2 | Screenshot: wallet options available | ✅ | `screenshots/stellar_wallet_integration/wallet_options_available.png` |
| 2.3 | Deployed contract address | ✅ | README → Deployed contracts |
| 2.4 | Transaction hash, verifiable on explorer | ✅ | README → Stellar wallet integration §4 |

2.1 is marked optional in the brief, so this level passes without it.

---

## Level 3 — one item short

| # | Requirement | Status | Where |
| --- | --- | --- | --- |
| 3.1 | Public GitHub repository | ⚠️ | repo exists, **still private** — history is clean, flip the switch |
| 3.2 | README with complete documentation | ✅ | README |
| 3.3 | Minimum 15+ meaningful commits | ✅ | 90, across 6 merged pull requests |
| 3.4 | **Live demo link** | ❌ | **blocking** |
| 3.5 | Contract deployment address | ✅ | README → Deployed contracts |
| 3.6 | Transaction hash for contract interaction | ✅ | `approve_milestone`, ledger 4,126,783 |
| 3.7 | Screenshot: mobile responsive UI | ✅ | `screenshots/submission/mobile.png` |
| 3.8 | Screenshot: CI/CD pipeline running | ✅ | `screenshots/submission/ci.png` |
| 3.9 | Screenshot: test output, 3+ passing | ✅ | `screenshots/submission/tests.png` — 183 + 26 |
| 3.10 | Demo video link (1–2 min) | ✅ | README badge and Demo table |

**To close 3.4:** deploy `web/` to Vercel — Root Directory `web/`, the seven variables from
`web/.env.example`. `NEXT_PUBLIC_*` values are inlined at build time, so set them before the
first build. Then add the URL to the README badge row, the link row and the Demo table.

---

## Level 4 — three items short

| # | Requirement | Status | Notes |
| --- | --- | --- | --- |
| 4.1 | Public GitHub repository | ⚠️ | still private |
| 4.2 | README with complete documentation | ✅ | |
| 4.3 | Minimum 15+ meaningful commits | ✅ | 90 |
| 4.4 | Live demo link | ❌ | same blocker as 3.4 |
| 4.5 | Contract deployment address | ✅ | testnet |
| 4.6 | Screenshot: product UI | ✅ | landing, `/wallet`, `/proofs` already in README |
| 4.7 | Screenshot: mobile responsive design | ✅ | `screenshots/submission/mobile.png` |
| 4.8 | **Screenshot: analytics or monitoring setup** | ❌ | no analytics or monitoring exists |
| 4.9 | Demo video link | ✅ | |
| 4.10 | **Proof of 10+ user wallet interactions** | ❌ | 2 distinct wallets on chain |
| 4.11 | **Basic user feedback summary** | ❌ | no users have been asked |

### What 4.8 needs

Nothing is instrumented today — no Vercel Analytics, Sentry, PostHog or Plausible in
`web/package.json`. Cheapest honest route once the app is deployed: enable **Vercel
Analytics** plus the Vercel deployment and function logs, and screenshot both. Supabase's
own dashboard also gives query and auth charts that count as monitoring.

### What 4.10 needs

The two addresses on chain are the deployer and a single test signer. Ten *distinct*
wallets each doing at least one signed interaction is a real cohort — recruit ten people,
have each connect Freighter on testnet, register, and anchor one milestone. Record each
wallet address and transaction hash in a table so every row opens on Stellar Expert.

Run 4.10 and 4.11 as **one session** — the same ten testers produce the wallet proof and
the feedback. Collect the feedback with a Google Form asking for wallet address, name,
a 1–5 rating and free text, then summarise counts, the average and the themes.

---

## Level 5 — four items short

| # | Requirement | Status | Notes |
| --- | --- | --- | --- |
| 5.1 | Public GitHub repository | ⚠️ | still private |
| 5.2 | Minimum 20+ meaningful commits | ✅ | 90 |
| 5.3 | Live deployed application | ❌ | same blocker as 3.4 |
| 5.4 | PPT / pitch deck link | ✅ | Google Slides — linked from the README |
| 5.5 | Demo video link | ✅ | |
| 5.6 | **Proof of 50+ users** | ❌ | scale-up of 4.10 |
| 5.7 | **Screenshots of analytics or transaction activity** | ❌ | see 4.8 |
| 5.8 | Updated README and documentation | ✅ | |
| 5.9 | **User feedback iteration summary** | ❌ | needs 4.11 first |

5.9 is not the same as 4.11. Level 4 wants *what users said*; Level 5 wants *what changed
because of it* — the feedback, the commit or release that answered it, and the result.
Keep the Level 4 form running so the before/after is measurable rather than asserted.

Cheapest path to 5.7 once a cohort exists: the contract's own event log. Every write emits
a `qdit` event with an indexed `project_id`, so a Stellar Expert contract page filtered to
this contract is a genuine transaction-activity screenshot with no extra tooling.

---

## Level 6 — seven items short

Mainnet level. The largest gap, and the one with a real prerequisite in the codebase.

| # | Requirement | Status | Notes |
| --- | --- | --- | --- |
| 6.1 | Public GitHub repository | ⚠️ | still private |
| 6.2 | Minimum 30+ meaningful commits | ✅ | 90 |
| 6.3 | **Live mainnet application** | ❌ | blocked on the upgrade path decision |
| 6.4 | **Mainnet contract addresses** | ❌ | not deployed |
| 6.5 | **Proof of 20+ mainnet users** | ❌ | needs 6.3 |
| 6.6 | **Transaction activity proof** | ❌ | needs 6.3 |
| 6.7 | **Audit / security review proof** | ❌ | none commissioned |
| 6.8 | **Twitter/X launch post link** | ❌ | not launched |
| 6.9 | Demo video link | ✅ | |
| 6.10 | Technical documentation | ✅ | README — architecture, contract interface, quick start |
| 6.11 | **User guide / documentation** | ❌ | README is builder-facing, not user-facing |
| 6.12 | **Community contribution link** | ❌ | no `CONTRIBUTING.md`, no issue templates |

### 6.3 has a prerequisite, not just a command

`milestone_proof` has **no admin address and no `upgrade` entry point**, by choice. A bug
after mainnet means deploying a new contract id and migrating `projects.chain_contract_id`
for every registered project. That migration is near-free today and gets more expensive
with every anchor, so settle it *before* deploying, not after.

Budget for it: the Doqtri deployment paid roughly 8 XLM for the one-time WASM upload, and
mainnet rent expires — keep the code entry alive with `stellar contract extend`.

### 6.7 — what counts as proof

A third-party audit is the strong form and costs real money. Weaker but genuine
alternatives, in descending order: a published security review from a Stellar ecosystem
reviewer; the repo's own `/security-review` output committed as a report; a documented
threat model covering the RLS boundary, the SEP-10 challenge and the envelope verification
in `assertInvocation`. State plainly which one it is — an overclaimed audit is worse than
none.

### 6.11 and 6.12 are the cheapest two here

- **User guide** — a `docs/user-guide.md`: connect a wallet, create a project, register it
  on chain, run a milestone from proposed to approved, anchor it, verify the hash. Roughly
  the demo video written down.
- **Community contribution link** — `CONTRIBUTING.md` plus issue templates, and turn on
  GitHub Discussions. An afternoon's work.

Note both files were purged from history in the public-repo cleanup, so they need writing
fresh rather than restoring.

---

## Blockers, in the order worth doing them

1. ~~**Scrub the git history.**~~ Done. `git filter-repo` purged twelve planning and spec
   markdown files from every commit and replaced the seeded fixture password throughout, so
   the only markdown that has ever existed in this history is the README and this file. The
   rewrite pruned eleven commits that touched nothing else, leaving 86.
2. **Make the repository public.** Nothing blocks it now. Unblocks 3.1, 4.1, 5.1, 6.1.
3. **Deploy to Vercel.** Unblocks 3.4, 4.4, 5.3, and makes 4.8 possible at all.
4. **Enable analytics on the deployment.** Unblocks 4.8 and 5.7.
5. **Run a tester cohort** — ten first, then fifty. Unblocks 4.10, 4.11, 5.6, 5.9.
6. **Write the user guide and `CONTRIBUTING.md`.** Unblocks 6.11 and 6.12 independently of
   everything else.
7. **Settle the upgrade path, then deploy to mainnet.** Unblocks 6.3 to 6.6.
8. **Commission or write the security review; publish the launch post.** 6.7 and 6.8.

Item 6 and item 8's launch post are the only ones that do not depend on anything above them.
