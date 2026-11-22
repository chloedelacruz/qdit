# Security self-review: milestone_proof_v2, Merkle scheme v2 and the verifiers

Ticket: QDIT-31 (WP-4.5). Review date: 2026-11-23. Branch reviewed: `wp-4.5-qa-targets`
(working tree at commit `778017c`).

This is an internal, adversarial self-review by a reviewer who did not write the code.
It is **not** a third-party audit and not a formal verification (see
[Known limits](#known-limits)). Everything runs on Stellar **testnet** only.

## Scope and method

### What was read, line by line

| Area | Files |
| --- | --- |
| Contract | [`lib.rs`](../../contracts/milestone_proof_v2/src/lib.rs), [`members.rs`](../../contracts/milestone_proof_v2/src/members.rs), [`milestones.rs`](../../contracts/milestone_proof_v2/src/milestones.rs), [`batches.rs`](../../contracts/milestone_proof_v2/src/batches.rs), [`merkle.rs`](../../contracts/milestone_proof_v2/src/merkle.rs), [`storage.rs`](../../contracts/milestone_proof_v2/src/storage.rs), [`events.rs`](../../contracts/milestone_proof_v2/src/events.rs), [`errors.rs`](../../contracts/milestone_proof_v2/src/errors.rs); test names and the auth / event patterns in [`src/test/`](../../contracts/milestone_proof_v2/src/test/); [crate README](../../contracts/milestone_proof_v2/README.md) and [`DEPLOYMENTS.md`](../../contracts/milestone_proof_v2/DEPLOYMENTS.md) |
| Merkle scheme | [`docs/merkle/SPEC.md`](../merkle/SPEC.md), the structure of [`vectors.json`](../merkle/vectors.json) (11 batches, 10 invalid proofs), [`tree.ts`](../../packages/merkle/src/tree.ts), [`proof-file.ts`](../../packages/merkle/src/proof-file.ts), [`certificate.ts`](../../packages/merkle/src/certificate.ts) |
| Verifier | [`chain.ts`](../../packages/verify/src/chain.ts), [`milestone.ts`](../../packages/verify/src/milestone.ts), [`inclusion.ts`](../../packages/verify/src/inclusion.ts), [`replay.ts`](../../packages/verify/src/replay.ts), [`cli.ts`](../../packages/verify/src/cli.ts), [verifier README](../../packages/verify/README.md), the fake RPC in `packages/verify/test/fake-rpc.ts` |
| Batch CLI | [`qdit-batch/src/cli.ts`](../../packages/qdit-batch/src/cli.ts) (verify path), [`certificate.ts`](../../packages/qdit-batch/src/certificate.ts) (HTML escaping), `batch.ts` (`proofFileName`), `soroban.ts` (`Client.read`) |

### What was run (offline only, no transaction sent, no network read)

| Command | Result |
| --- | --- |
| `cargo test -p milestone_proof_v2` | 114 passed, 0 failed |
| `npm test -w merkle` | 38 tests, 38 passed |
| `npm test -w verify` | 60 tests, 55 passed, 5 skipped (the `QDIT_LIVE=1` testnet tests), 0 failed |
| `npm test -w qdit-batch` | 10 tests, 10 passed |

Two scratch scripts, run outside the repository against the real `foldEvents` / `replay`
and the existing fake RPC, confirmed findings [L-2](#l-2) and [L-3](#l-3). They are
described in those findings and were not added to the repository.

Intended product decisions were not reported as bugs: D-104 (threshold may exceed the
approver count at creation, 0 refused), D-105 (an approval given before removal still
counts), D-106 (demotion gets the removal threshold check), D-107 (transfer signed by both
owners, roster unchanged) and D-108 (approve / reject name the reviewed `proof_hash`).

## Findings

No high-severity finding. The contract has no exploitable authorisation, state-machine or
storage bug that this review could find. The findings are about what the off-chain tools
report and how a caller can misread a result.

| Id | Severity | Area | File:line | Description | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| [M-1](#m-1) | medium | verifier CLI | [`verify/src/cli.ts:153`](../../packages/verify/src/cli.ts), `:164` | `qdit-verify proof` is offline by default and exits 0 ("verified") for any self-consistent file, including a forged one | Make on-chain the default (opt out with `--offline`), or never exit 0 when `rootConfirmed` is false |
| [L-1](#l-1) | low | verifier | [`verify/src/inclusion.ts:217`](../../packages/verify/src/inclusion.ts), [`milestone.ts:99`](../../packages/verify/src/milestone.ts) | A pass does not say who controls the project; anyone can register an unused project id on the pinned contract and produce passing proofs | Return the project owner, accept `--project` / `--owner` expectations, say so in the README and certificate |
| [L-2](#l-2) | low | replay | [`verify/src/replay.ts:364`](../../packages/verify/src/replay.ts) | Paging stops when a full page ends inside `toLedger`, dropping the rest of that ledger's events while the snapshot says `complete: true` | Stop only on a short page or a cursor past `toLedger` |
| [L-3](#l-3) | low | replay | [`verify/src/replay.ts:205`](../../packages/verify/src/replay.ts), `:236` | A milestone or batch id `__proto__` is folded into a plain object and silently disappears from the snapshot | Use `Object.create(null)` or `Map` for `members`, `milestones`, `batches` |
| [L-4](#l-4) | low | replay | [`verify/src/replay.ts:273`](../../packages/verify/src/replay.ts) | Ids are decoded with a lossy UTF-8 decoder; a project id that is not valid UTF-8 (anyone can create one) collapses to U+FFFD and makes `replay --compare` fail for the whole contract | Decode strictly; carry undecodable ids as raw bytes or report them as skipped |
| [L-5](#l-5) | low | verifier CLI | [`verify/src/cli.ts:183`](../../packages/verify/src/cli.ts), [`replay.ts:496`](../../packages/verify/src/replay.ts) | `replay --compare` exits 0 when the snapshot is incomplete and projects were skipped | Make `ok` require `snapshot.complete` (or `skipped` empty), or use a distinct exit code |
| [L-6](#l-6) | low | batch CLI | [`qdit-batch/src/cli.ts:167`](../../packages/qdit-batch/src/cli.ts) | `qdit-batch verify` has none of `@qdit/verify`'s pinning: no WASM-hash check, no RPC passphrase check, any `--contract` accepted; errors exit 1 like a failed proof | Route the verify path through `@qdit/verify` (`verifyInclusion`) |
| [I-1](#i-1) | info | contract / docs | [`members.rs:56`](../../contracts/milestone_proof_v2/src/members.rs), [README "Known limits"](../../contracts/milestone_proof_v2/README.md) | The owner chooses every approver address, so M-of-N needs M addresses, not M people; the README's "still requires someone else" overstates it | Reword the README; let the verifier show the owner next to the approvers |
| [I-2](#i-2) | info | contract | [`milestones.rs:82`](../../contracts/milestone_proof_v2/src/milestones.rs) | Approve / reject bind the hash but not the version: an approval signed for version n can land on version n+1 resubmitted with the same hash | Document; optionally add an expected-version argument in a future version |
| [I-3](#i-3) | info | verifier | [`verify/src/inclusion.ts:226`](../../packages/verify/src/inclusion.ts) | For a file version older than the record's current one, the proof hash can't be checked against the chain | Document in the README; optionally cross-check against replayed `submit` events |
| [I-4](#i-4) | info | verifier | [`verify/src/chain.ts:206`](../../packages/verify/src/chain.ts) | Archived entries (a batch or approved milestone untouched for 120 days) are not detected or explained; behaviour against them is untested (uncertain) | Detect a restore-preamble simulation, report "archived, restore needed", document it |
| [I-5](#i-5) | info | Merkle / verifier | [`proof-file.ts:81`](../../packages/merkle/src/proof-file.ts), [`tree.ts:262`](../../packages/merkle/src/tree.ts), [`inclusion.ts:134`](../../packages/verify/src/inclusion.ts) | The parser accepts `0x` and uppercase hex the SPEC forbids; a `0x` proof hash then fails a correct chain record (false negative only) | Reject non-canonical hex, or normalise with `toHex(fromHex(...))` |
| [I-6](#i-6) | info | certificate | [`merkle/src/certificate.ts:44`](../../packages/merkle/src/certificate.ts) | Extraction takes the first exact open-tag string, even inside an HTML comment, so a hand-made certificate can show a browser something other than what is verified | Document that only the verifier's JSON output counts; optionally refuse tags inside comments |
| [I-7](#i-7) | info | contract tests | [`src/test/`](../../contracts/milestone_proof_v2/src/test/) | No test asserts that a refused write emits no event (true by construction) | Add one `try_` call per write that checks `events().all()` is empty |
| [I-8](#i-8) | info | verifier | [`chain.ts:134`](../../packages/verify/src/chain.ts), [`replay.ts:303`](../../packages/verify/src/replay.ts) | Plain-HTTP RPC URLs are accepted silently, so the trusted RPC can be swapped in transit | Warn on stderr for `http://`, or require a flag |

### M-1

`qdit-verify proof <file>` runs offline unless `--on-chain` is given
([`cli.ts:153`](../../packages/verify/src/cli.ts)):

```ts
const onChain = values["on-chain"] === true;
```

Offline, `verifyInclusion` sets `ok` when the leaf matches and the path leads to the
file's own `root` ([`inclusion.ts:144-147`](../../packages/verify/src/inclusion.ts)), and
the CLI maps `ok` to exit 0 (`return r.ok ? EXIT.VERIFIED : EXIT.NOT_VERIFIED`, line 164),
which the README's exit table calls "Verified". Anyone can make a file that agrees with
itself: pick any root, any project and milestone. A script or CI step that runs
`qdit-verify proof cert.html && accept` accepts a forgery. The JSON says
`"rootConfirmed": false` and the README warns about it, but the exit code is the contract
a script relies on, and the safe mode is the one you have to ask for. (`qdit-batch verify`
does the opposite: on chain by default, `--offline` to opt out.)

Fix: make `--on-chain` the default and add `--offline`, or keep the default and return
exit 1 (or a new code) whenever `rootConfirmed` is false.

### L-1

`verifyInclusion` with `onChain` passes when a Submitter of `project_id` anchored the
leaf. The README states that accurately. But a pass does not say **who** controls the
project, and on the pinned contract anyone can call `create_project` with an unused id and
become its owner (`lib.rs:45-77`; the crate README lists "Anyone can claim an unused
`project_id`"). So an attacker can create a project with a lookalike id, add their own
key as Submitter, anchor a batch and hand out certificates that pass
`qdit-verify proof --on-chain` with exit 0. The result carries `batch.submitter` but not
the project owner, and `verifyMilestone` reads `get_project` but keeps only the threshold
([`milestone.ts:99`](../../packages/verify/src/milestone.ts)). The verifier README's
"Which contract" section explains why other contract ids are refused, but the same
first-come rule applies to project ids on the pinned contract.

Fix: read `get_project` in `verifyInclusion` and return `owner` in both results; let the
CLI take `--project <id>` and `--owner <G…>` expectations for `proof`; say in the README
and on the certificate that the relying party must check the project id and owner.

### L-2

`replay` pages `getEvents` and stops with
([`replay.ts:364`](../../packages/verify/src/replay.ts)):

```ts
if (past || !page.cursor || cursorLedger(page.cursor) >= toLedger) break;
```

When a page is full, the RPC's cursor is the id of the page's last event. If that event
is in ledger `toLedger` and more events of the same ledger follow, the loop stops and
drops them, and the snapshot reports `complete: true`. A short page's cursor points to the
end of the scanned range, so the `>=` test is only wrong for full pages. Reproduced with
the repository's fake RPC: three events, the last two in the final ledger, `pageLimit: 1`
gave `eventCount` 2 of 3 and `complete: true`. With the default limit of 1,000 it needs a
page boundary inside the last ledger, so it is rare; `--compare` would then show a diff
(a false negative), but a snapshot written with `--out` alone would silently miss state.

Fix: break when `past`, when there is no cursor, or when the page is short
(`page.events.length < limit`) and `cursorLedger(page.cursor) >= toLedger`; a full page
always fetches the next one.

### L-3

`foldEvents` stores milestones and batches in plain objects keyed by caller-chosen ids
(`project(pid).milestones[String(f.milestone_id)] = …`, line 205; `batches[…]`, line 236;
both created by `emptyProject`, line 157). Assigning to the key `__proto__` sets the
object's prototype instead of adding an entry, so the entry is missing from
`Object.entries`, from the snapshot and from `compareWithContract`. Reproduced: a project
with milestones `__proto__` and `m1` and batch `__proto__` folded to milestones `["m1"]`,
batches `[]`, `complete: true`. Only the project's own Submitters can create such ids, so
the impact is a project hiding one milestone or batch from replay; there is no global
prototype pollution (`projects` is a `Map`, member keys are addresses).

Fix: create `members`, `milestones` and `batches` with `Object.create(null)` (and keep
`Object.fromEntries` for output), or use `Map`s internally.

### L-4

A Soroban `String` is arbitrary bytes, and `create_project` accepts any id up to 64 bytes.
The SDK's `scValToNative` decodes it with a non-fatal `TextDecoder`, so invalid UTF-8
becomes U+FFFD (`0xff` and `0xfe` both decode to `"�"`). `replay` keys projects and
milestones on the decoded string, and `compareWithContract` re-encodes that string to call
the getters, which then look up different bytes and return `ProjectNotFound`. Anyone can
therefore create a project with a non-UTF-8 id and make `replay --compare` report a
difference, exit 1, for the whole contract for as long as that event is in the RPC's
retention window; two such projects also merge into one snapshot entry. It is a griefing
false negative, never a false pass.

Fix: decode ids strictly (`new TextDecoder("utf-8", { fatal: true })` on the raw
`scv.str()` bytes); key an undecodable id by its hex and list it under `gaps` /
`skipped` instead of comparing it.

### L-5

With `--compare`, the CLI returns `comparison.ok ? EXIT.VERIFIED : EXIT.NOT_VERIFIED`
([`cli.ts:185`](../../packages/verify/src/cli.ts)), and `comparison.ok` is
`out.diffs.length === 0` ([`replay.ts:496`](../../packages/verify/src/replay.ts)), which
ignores the projects skipped as partial. The gaps are reported in the JSON and on stderr,
as intended, but the exit code says verified. The contract was deployed on 2026-11-14 and
testnet RPC keeps about 7 days of events, so from about 2026-11-21 every default
`replay --compare` is incomplete and still exits 0.

Fix: return `ok: comparison.ok && snapshot.complete` (or `&& skipped.length === 0`), or a
distinct exit code for "matched, but incomplete".

### L-6

`qdit-batch verify` checks that the file names `--contract` (default the current
deployment) and then reads through its own `Client`
([`qdit-batch/src/cli.ts:167-177`](../../packages/qdit-batch/src/cli.ts)). Unlike
`@qdit/verify`, it never checks the RPC's network passphrase or the contract's WASM hash,
and `--contract` accepts any id. A certificate whose author also supplies the command
(`qdit-batch verify --contract C<attacker>`) can then be checked against a contract that
returns any root and `true` from `verify_inclusion`. The help text says to name only a
deployment you trust, so this needs the user's cooperation, hence low. Network and
contract errors also exit 1, the same code as a failed proof (no false pass).

Fix: implement `qdit-batch verify` with `verifyInclusion({ onChain: true, trustedContracts })`
from `@qdit/verify`, keep its exit codes (0 / 1 / 2 / 3), or at least add the passphrase
and WASM-hash checks.

### I-1

Every approver is an address the owner adds (`add_member`, owner-signed). The owner can
add several keys they control, or, under D-105, remove an approver after approval and add
another. So a threshold of M guarantees M distinct addresses, not M independent people.
This is inherent in an owner-managed roster, not a bug. The crate README says "A threshold
of 2 or more still requires someone else", which overstates it. Suggested: reword to
"another address the owner added", and have `verifyMilestone` return the owner so a
reader can see when an approver is the owner.

### I-2

`load_for_decision` refuses a decision whose hash differs from the current one
(`milestones.rs:82`, `if &record.proof_hash != proof_hash`), but no version is named. If a
milestone is rejected and resubmitted with the **same** hash, an approval signed while the
earlier version was open (and still within its signature-expiration ledger) is accepted
for the new version. The approver reviewed the same bytes, so the impact is small; noted
for completeness against D-108's intent.

### I-3

When the milestone's record is at version v and the file names an older version, the
verifier can only check that the file's version is not above v
([`inclusion.ts:226-234`](../../packages/verify/src/inclusion.ts)); the hash of an older
version isn't kept by the contract. A file naming version 1 with any hash therefore passes
if a Submitter anchored it. The README implies this but doesn't say it. Suggested: state it
in the README; optionally compare against replayed `submit` events when they are within
retention.

### I-4

The contract README documents that a batch or an approved milestone is archived 120 days
after its last write and must be restored before calls on it work. The verifier treats any
non-contract simulation outcome as an RPC error or reads the result as given
([`chain.ts:206-216`](../../packages/verify/src/chain.ts)); it does not check for a
restore preamble and no test covers an archived entry. This review did not establish
exactly what the testnet RPC returns for a read of an archived entry, so this is marked
uncertain. In no case seen does it produce a false pass. Suggested: detect
`rpc.Api.isSimulationRestore(sim)` and throw a clear `RPC` error ("archived, restore
needed"), and add a line to the verifier README.

### I-5

SPEC section 7 says hex is lowercase without `0x`. `fromHex` accepts both prefixes and
either case ([`tree.ts:262`](../../packages/merkle/src/tree.ts)), and `parseProofFile`
uses it (line 81). `verifyInclusion` keeps `file.proof_hash.toLowerCase()` as given, so a
`0x`-prefixed hash then "differs from the one submitted" even when the chain matches. Only
a false negative. Suggested: reject non-canonical hex in `parseProofFile`, or normalise.

### I-6

`extractCertificateProof` takes the first occurrence of the exact open-tag string and
refuses a second exact one. A hand-crafted page can put that string inside an HTML comment,
or add a differently spelled script block, so a browser renders other data than the block
the verifier checks. This matches the stated design (the visible text proves nothing, and
the CLI prints the verified fields). Generated certificates are safe: every field is
HTML-escaped (`esc`, [`qdit-batch/src/certificate.ts:28`](../../packages/qdit-batch/src/certificate.ts))
and the embedded JSON escapes `<`, `>`, `&`, U+2028 and U+2029.

### I-7

Each write publishes its event only after its last fallible step, and the host discards
the events of a failed invocation, so a refused call emits nothing. No test asserts it.
A short test per write (`try_…` refused, then `events().all()` empty) would pin it down.

### I-8

Both `ChainReader` and `replay` set `allowHttp` when the URL starts with `http://`. The RPC
is trusted by design, and plain HTTP lets anyone on the path replace it. Suggested: warn on
stderr, or require an explicit flag.

## Resolution

Fixed by the builder after this review, in the same pull request; the regression tests
named below fail on the code as reviewed. The rest are filed as their own issues.

| Id | Outcome | Where |
| --- | --- | --- |
| M-1 | **Fixed.** `qdit-verify proof` checks on chain by default; `--offline` is opt-in and never exits 0, since a forged file also agrees with itself | `packages/verify/src/cli.ts`; `test/cli.test.ts` |
| L-1 | **Fixed.** `verifyMilestone` returns `owner`, `verifyInclusion` (on chain) returns `projectOwner`; the verifier README says to compare it with the expected owner | `milestone.ts`, `inclusion.ts`, README "What a pass does and doesn't say" |
| L-2 | **Fixed.** Paging stops on a cursor past `toLedger` only after a short page; a full page continues | `replay.ts`; test "a full page that ends inside the last ledger…" |
| L-3 | **Fixed.** Per-project maps have no prototype, so `__proto__` and `constructor` are ordinary ids | `replay.ts`; test "ids like __proto__ are ordinary keys" |
| L-4 | **Fixed.** Strings are checked as strict UTF-8; an event with an undecodable id is not replayed, the snapshot names it in `gaps`, and its project is marked partial (or left out when the project id itself is undecodable) | `replay.ts`; test "an id that isn't UTF-8 is reported" |
| L-5 | **Fixed.** `replay --compare` passes only on a complete snapshot; `--allow-incomplete` accepts gaps explicitly | `cli.ts`; `test/cli.test.ts` |
| L-6 | Filed as **QDIT-71** | |
| I-1 | **Fixed** (docs and output). Contract README reworded; the verifier reports the owner (L-1) | `contracts/milestone_proof_v2/README.md`, verifier README |
| I-2 | **Documented** in the verifier README; a contract change would need a new deployment | verifier README "Which version" |
| I-3 | **Documented** in the verifier README | verifier README "Older versions" |
| I-4 | Filed as **QDIT-72** | |
| I-5 | Filed as **QDIT-73** | |
| I-6 | **Documented** in the verifier README | verifier README "Certificates" |
| I-7 | Filed as **QDIT-74** | |
| I-8 | **Fixed.** The CLI warns on stderr for a plain `http://` RPC URL other than localhost | `cli.ts` |

## Checked and fine

### Contract

| Item | Reason |
| --- | --- |
| `require_auth` on every write, on the right address | `create_project`: `owner` (`lib.rs:52`); roster, threshold: `require_owner` (`members.rs:12`); transfer: `new_owner` (`members.rs:121`) and current owner via `require_owner` (line 122); submit: `submitter` (`milestones.rs:19`); approve / reject: `approver` (line 72); anchor: `submitter` (`batches.rs:24`). The no-argument `require_auth` covers every argument; `anchor_needs_the_submitters_signature_over_every_argument` and `an_approvers_signature_covers_the_hash` prove it |
| Roles and owner from storage, never from arguments | `require_owner` compares the argument with `storage::get_project(...).owner` (`members.rs:14-17`); `require_role` reads the roster map (`members.rs:31-36`) |
| No admin, upgrade or privileged path | No `update_current_contract_wasm`, constructor or admin key anywhere in `src/`; every entry point is in `lib.rs` and each one is listed above |
| Read functions are read-only | `get_*` and `verify_inclusion` do no `set` and no auth |
| Id length bound | `check_id` (64 bytes, `storage.rs:131`) runs on every id argument before any storage access, including `verify_inclusion` (`batches.rs:78`, `:63-64`) |
| Roster bound | `MAX_MEMBERS` 20 checked only for a new member (`members.rs:71`); a role change on a full roster is allowed and tested |
| Approvers set bound | Grows only while Submitted and below the threshold, holds no duplicates (`milestones.rs:98`); the bound of 21 is argued in `storage.rs:10-14` and tested (`an_approvers_set_holds_at_most_one_more_than_the_member_cap`) |
| TTL extension on every write | Every write goes through `set_project`, `set_members`, `set_milestone` or `set_batch`, each of which extends the written key, the project record, the roster and the instance (`storage.rs:110-213`); covered by `test/storage.rs` |
| Archived entries can't bypass uniqueness | `has_project` / `has_batch` on an archived entry fail or auto-restore, never read as absent, so `ProjectExists` and `BatchExists` hold |
| Threshold 0 | Refused by `create_project` (`lib.rs:54`) and `set_threshold` (`members.rs:152`) |
| Threshold above approver count | Allowed at creation (D-104), refused by `set_threshold` (`members.rs:152`) |
| Threshold equal to approver count | Removing or demoting an approver is refused (`count - 1 < threshold`, `members.rs:50`); the subtraction can't underflow, since it runs only when the member is an approver |
| Removing / demoting below threshold | `InvalidThreshold` for both (`members.rs:69`, `:99`), D-106 |
| ProofMismatch | `load_for_decision` compares the named hash with the stored one before any change (`milestones.rs:82`) |
| Approvals by removed approvers still count | `approvers.len() >= threshold` counts the set, not the current roster (`milestones.rs:104`), D-105 |
| Resubmission | New record with `version + 1` and empty approvers (`milestones.rs:30-45`); `overflow-checks = true` in `contracts/Cargo.toml` turns a u32 overflow into a panic, not a wrap |
| Approved is terminal | Submit refuses Approved (`milestones.rs:27`); approve / reject need Submitted (line 79) |
| Batch id collision | `BatchExists` before any write (`batches.rs:32`); batches are per project (`DataKey::Batch(project, batch)`) |
| `leaf_count` bounds | 1 to 65,536 at anchor (`batches.rs:29`) |
| `verify_inclusion` bounds | `leaf_count == 0`, `index >= leaf_count` and `path.len() > 16` return false (`merkle.rs:72`); a short path returns false at `path.get` (lines 82, 88); a long one fails `p == path.len()` (line 98); unknown batch is `BatchNotFound`, not false |
| Transfer needs both owners | Both `require_auth` calls (`members.rs:121-122`); tested with each signature missing |
| Events | One event per write, published after the last fallible step, each carrying what replay needs (`events.rs`) |

### Merkle scheme

| Item | Reason |
| --- | --- |
| Leaf / node domain separation | Leaf preimage starts `0x00`, node `0x01` (`merkle.rs:39`, `:51`; `tree.ts:84`, `:91`); the verifier always recomputes the leaf from fields, so an inner node can't be presented as a leaf without a SHA-256 preimage |
| Field encoding is injective | Fixed prefix and 14-byte TAG, then `u32be(len) || bytes` for each id and fixed-width version and hash (`merkle.rs:22-46`, `tree.ts:46-52`); `("ab","c")` and `("a","bc")` are distinct vectors |
| Byte length, not characters | Rust `String::len()` is bytes; TS uses `TextEncoder` bytes; non-ASCII vectors pass in both |
| Odd-node promotion | Lone node promoted, never duplicated (`tree.ts:132`), so no CVE-2012-2459 duplicate-leaf root; sides come from `index` and the stored `leaf_count`, never the proof |
| Proof length bound | 16 in Rust (`MAX_PROOF_LEN`), TS `verifyPath` and `parseProofFile`; the 17-hash vector is false in both |
| Rust / TS consistency | Same algorithm line for line; TS also refuses `leafCount > 65,536`, which the contract already enforces at anchor; both run the same vectors, including 10 invalid proofs (wrong index, out of range, swapped, missing, extra, empty, 17 hashes, wrong version, other project, inner node as hash) |
| Version in the leaf | Present (`u32be(version)`), so a same-hash resubmission gives a different leaf |
| Certificate script block | `<`, `>`, `&`, U+2028, U+2029 written as `\u` escapes (`merkle/src/certificate.ts:24-31`), so no id can close the block; exactly one block required on extraction |
| Proof file names | `proofFileName` strips everything outside `[A-Za-z0-9._-]` and prefixes the index (`qdit-batch/src/batch.ts:72`), so no path traversal and no collision |

### Verifier

| Item | Reason |
| --- | --- |
| Network pinning | `getNetwork().passphrase` must equal `Networks.TESTNET` (`chain.ts:153`); the proof file's `network` must be `testnet` (`inclusion.ts:116`); `--network` other than testnet is a usage error |
| Contract pinning | Only `KNOWN_V2_CONTRACT_IDS` unless the caller names `trustedContracts` (`chain.ts:124-130`); the instance's WASM hash must be in `KNOWN_V2_WASM_HASHES` (`chain.ts:180`); pinned id and hash match `DEPLOYMENTS.md` |
| A proof file can't choose its contract | CLI refuses a file whose `contract_id` isn't `--contract` / the default (`cli.ts:156`); `ChainReader` refuses unknown ids before any read |
| Root from chain, not file | On chain, the path is checked against `get_batch`'s root and leaf count (`inclusion.ts:172`), the contract's own `verify_inclusion` must say true, and file root, leaf count and anchor must match |
| RPC errors are never "verified" | Transport and non-contract simulation errors throw `VerifyError("RPC")` (`chain.ts:203-215`), malformed records throw, unexpected exceptions map to code `RPC`; `ok` starts false and is set only from an empty `reasons` list |
| CLI exit codes | 0 only from `r.ok` / `comparison.ok` or help; `UsageError` and non-RPC `VerifyError` give 2; `RPC` and unknown errors give 3 (`cli.ts:201-213`); see M-1 and L-5 for the two cases where 0 is weaker than it reads |
| Replay retention gaps | Window start after the requested ledger and a start after the deploy ledger are listed in `gaps`; projects without their `create` event are `complete: false` and skipped by compare (`replay.ts:330-339`, `:375-378`, `:443-446`) |
| Replay fold vs contract | `submit` starts a new version with no approvers; `approve` appends and takes status from the event; `reject` sets Rejected and keeps approvers until the next submit, as the contract does; an approve / reject for an unseen version marks the project partial; unknown verbs stop the replay (`replay.ts:181-248`) |
| Replay event source | `getEvents` is filtered to the pinned contract id, and the contract is the only emitter of its events |
| `verifyMilestone` | `ok` only for Approved with at least one approver and matching optional hash / version; threshold reported as today's value, as documented |

## Known limits

- **No third-party audit and no formal verification.** As the SOW states, this is a
  self-review by the delivery team. It reduces risk; it does not certify the code.
- **The RPC is trusted.** Simulation results and `getEvents` are not signed. A malicious
  or compromised RPC can return any passphrase, WASM hash, root or event, and every
  verifier result inherits that trust. Use your own node for anything that matters.
- **Testnet only.** The contract, the pinned deployment and the verifiers are for Stellar
  testnet. Testnet can be reset, and nothing here is fit for value on mainnet.
- **Event retention.** Replay is only complete within the RPC's retention window, about
  7 days on the public testnet RPC.
- **Owner trust.** The project owner controls the roster, and therefore who can approve
  (I-1).
- **Scope.** The web app, the database and doqtri were out of scope, and the five live
  testnet tests were not run.
