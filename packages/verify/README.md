# `@qdit/verify`

Check a qdit record on Stellar testnet without trusting qdit's app or database
(the RPC is still trusted: see below).
It reads the `milestone_proof_v2` contract through Soroban RPC simulation, so it
needs no key and pays no fee.

v0.1: the library (`verifyMilestone`, `verifyInclusion`, `replay`) and the
`qdit-verify` command. Testnet and `milestone_proof_v2` only. MIT licensed.

## Try it on real records

These are records from the sprint's testnet QA run
([`docs/evidence/qa-2026-11-22`](../../docs/evidence/qa-2026-11-22/README.md)). Node 22.18
or later.

```sh
# A milestone approved by 2 of its 3 approvers
npx @qdit/verify milestone --project ad605dca-7cab-491d-9d62-0d196ebc54b7 --milestone milestone-1

# One of 128 records anchored in a single batch transaction
curl -sO https://raw.githubusercontent.com/chloedelacruz/qdit/main/docs/evidence/qa-2026-11-22/batches/qa-1/records/proofs/00127-record-127.json
npx @qdit/verify proof 00127-record-127.json

# Every project's state rebuilt from the contract's events, checked against the contract
npx @qdit/verify replay --compare --allow-incomplete --out snapshot.json
```

Each prints JSON and exits 0 when the record verifies.

```ts
import { verifyMilestone, verifyInclusion } from "@qdit/verify";

// Is this milestone approved, at the hash I was given?
const m = await verifyMilestone({
  contractId: "CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB",
  projectId: "817745fb-e68a-497b-bd7a-b7d3fc1e4556",
  milestoneId: "milestone-1",
  expected: { proofHash: "cdb6237f…", version: 1 },
});
m.ok;        // true
m.approvers; // the addresses that signed, in order
m.reasons;   // why, when ok is false

// Is this milestone in an anchored batch?
const p = await verifyInclusion(proofFileJson, { onChain: true });
p.ok;                  // path leads to the stored root, and the contract agrees
p.batch?.contractSays; // the contract's own verify_inclusion
```

## Command line

```sh
npx @qdit/verify milestone --project 817745fb-e68a-497b-bd7a-b7d3fc1e4556 --milestone milestone-1
npx @qdit/verify proof inclusion-proof.json               # or a qdit-batch certificate (.html)
npx @qdit/verify replay --compare --out snapshot.json
```

| Command | Checks |
| --- | --- |
| `milestone --project <id> --milestone <id> [--hash <hex>] [--version <n>]` | `verifyMilestone`: Approved on chain, at this hash and version when given |
| `proof <file> [--offline]` | `verifyInclusion` on a proof file, or the one a `qdit-batch` certificate carries, against the root stored on chain. `--offline` only checks that the file agrees with itself, which a forged file also does, so it exits 1 even when `ok` is true |
| `replay [--from-ledger <n>] [--to-ledger <n>] [--out <file>] [--compare [--allow-incomplete]]` | `replay`, and with `--compare` also `compareWithContract`. `--compare` passes only on a complete snapshot; `--allow-incomplete` accepts one with gaps and compares what it has |

Every command takes `--contract <C…>` (default: the current qdit deployment,
`CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB`; a contract you name is
trusted, but must still run a known v2 build), `--rpc-url <url>` and `--network testnet`
(any other network is refused).

The result is JSON on stdout, always. A check that can't run prints
`{ "ok": false, "error": { "code": "...", "message": "..." } }`.

| Exit | Meaning |
| --- | --- |
| 0 | Verified (for `replay` without `--compare`: the snapshot was written; check `complete`) |
| 1 | Not verified: the check ran and failed, `--compare` found a difference or an incomplete snapshot, or `proof --offline` (never more than consistent) |
| 2 | Usage error: bad arguments, a malformed file, another network, or a contract that isn't a known v2 deployment |
| 3 | Network or RPC error |

## What each check means

**`verifyMilestone`** reads `get_project` and `get_milestone_status`. `ok` is true when
the milestone is `Approved` and every field given in `expected` matches. A milestone
below its threshold, rejected or not on chain comes back with `ok: false` and a reason.
The contract checks the threshold as each approval lands, so `threshold` is the
project's value now and an approved milestone can show fewer approvers than it.

**`verifyInclusion`** takes a `qdit-inclusion-proof/v2` file from `qdit-batch`.

- Without `onChain`, it checks that the file agrees with itself: the leaf matches its
  milestone fields and the path leads to the file's `root`. Nothing confirms that the
  root was ever anchored, and a forged file that agrees with itself passes too, so
  `rootConfirmed` is `false`. Use `onChain: true` for anything you rely on.
- With `onChain: true`, it reads the batch with `get_batch` and checks the path against
  the **stored** root and leaf count, never the file's. It also calls the contract's
  `verify_inclusion`, and fails if the file's root, leaf count, anchor ledger or anchor
  timestamp disagree with the chain. The anchor's `tx_hash` is not checked.
- On chain it also reads the milestone's own record. A batch can anchor a milestone
  that was never submitted on its own, so a missing record is reported as
  `submission: { recorded: false }` and is not a failure. When there is a record, a
  version it never reached fails, and so does a different proof hash at its current
  version. A pass means a Submitter of the project anchored this exact milestone,
  version and proof hash. It says nothing about approval: use `verifyMilestone` for
  that.

**`replay`** rebuilds the contract's state from its events alone, without reading
storage, and **`compareWithContract`** checks the result against the getters.

```ts
import { replay, compareWithContract } from "@qdit/verify";

const snapshot = await replay({ contractId: "CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB" });
snapshot.projects;  // owner, threshold, members, milestones (status, version, approvers), batches
snapshot.complete;  // false when some events could no longer be read (see below)
snapshot.gaps;      // what is missing, in plain words

const check = await compareWithContract(snapshot);
check.ok;    // every replayed entry matches get_project, get_members, get_milestone_status and get_batch
check.diffs; // each mismatch, when there is one
```

Every v2 write emits one event, so the events are the whole history. `replay` reads them
with RPC `getEvents` from the deploy ledger (`KNOWN_V2_DEPLOY_LEDGERS`, or
`startLedger`) to the latest ledger (or `endLedger`), and folds them in order:
`create`, `transfer`, `add_member`, `remove_member`, `threshold`, `submit` (a new
version, approvals cleared), `approve`, `reject` and `batch`. An event it doesn't
know stops the replay rather than produce a wrong state.

**Retention.** Soroban RPC keeps events for a limited window: about 7 days (120,960
ledgers) on the public testnet RPC. Events older than the window are gone from that RPC.
`replay` never passes off a partial history as a whole one: when the window starts after
`startLedger`, the snapshot has `complete: false` and says which ledgers are missing,
and a project whose creation fell outside the window is marked `complete: false` and is
not compared. A project with no event left in the window doesn't appear at all. To keep
a full history, run `replay` within a week of the writes and keep the snapshot, or point
`rpcUrl` at an RPC with a longer retention.

## Which contract

The root is only as good as the contract it is read from. v2 has no admin, so anyone
can deploy the same WASM, register any project id on their copy and anchor any root
there. So only the qdit deployments in `KNOWN_V2_CONTRACT_IDS` are read, whatever
contract a proof file names. To check another deployment you trust, pass
`trustedContracts: ["C…"]`. It must still run a known v2 WASM
(`KNOWN_V2_WASM_HASHES`).

## What a pass does and doesn't say

- **Who.** The owner picks every approver, and anyone can register an unused project id
  on the contract. "Approved by 2 of 3" means 2 addresses the owner added, not 2
  independent people. Both checks return the project's current owner (`owner`,
  `projectOwner`): compare it with the owner you expect.
- **Which version.** An approval names the proof hash the approver reviewed, not the
  version. If a milestone is rejected and resubmitted with the same hash, an approval
  sent for the old version lands on the new one. Check the version you expect with
  `expected.version`.
- **Older versions.** The contract keeps only a milestone's current record, so the
  proof hash of an earlier version can't be confirmed from its record; a batch proof for
  an earlier version is checked against the batch only.
- **Certificates.** Only the proof block a `qdit-batch` certificate carries is checked.
  A hand-made page can show a browser anything beside it: trust the command's output,
  not the page.

## What you still trust

The RPC. Simulation results aren't signed, so an RPC you don't trust can answer
anything, including the network passphrase and the WASM hash. The default is the
public testnet RPC; pass `rpcUrl` to use your own node. The CLI warns about a plain
`http://` URL to anything but localhost.

## Errors

A check that runs and fails returns `ok: false`. A check that can't run throws
`VerifyError` with a `code`:

| `code` | When |
| --- | --- |
| `BAD_INPUT` | A malformed contract id, hash, id or proof file |
| `WRONG_NETWORK` | The RPC or the proof file is for a network other than testnet |
| `WRONG_CONTRACT` | The id isn't a known qdit deployment (or in `trustedContracts`), nothing is deployed there, or it runs a WASM that isn't a known v2 build |
| `RPC` | The RPC failed or answered something unexpected |

v0.1 checks testnet and `milestone_proof_v2` only. v1 and the v2 builds on Merkle
scheme v1 are refused.

## Develop

```sh
cd packages && npm ci && npm run build
npm test -w verify                  # mocked RPC, no network
QDIT_LIVE=1 npm test -w verify      # also against testnet
```
