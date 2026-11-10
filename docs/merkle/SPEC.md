# qdit Merkle batch scheme, version 1

Status: v1, used by `milestone_proof_v2` (`anchor_batch`, `get_batch`,
`verify_inclusion`), `@qdit/merkle` and the `qdit-batch` CLI. Testnet only.

Keywords MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## 1. Why batch

Anchoring one milestone proof costs one Stellar transaction. A team that
closes 50 milestones at the end of a sprint pays for 50 transactions and waits
for 50 ledgers. A batch hashes all of those proofs into one Merkle root and
anchors only the root, in one transaction. Each milestone then gets a small
inclusion proof: the sibling hashes that lead from its leaf to the anchored
root. Anyone holding that proof can check it against the root on chain, without
the other milestones of the batch and without qdit's database.

A batch is a timestamped commitment that a set of milestone proof hashes
existed. It does **not** move any milestone through the approval state machine
(Proposed, Submitted, Approved, Rejected). Approval stays per milestone.

## 2. Primitives

- `H(x)` is SHA-256. Every hash is 32 bytes.
- `||` is byte concatenation.
- `TAG` is the 14 ASCII bytes `qdit/merkle/v1` (`71 64 69 74 2f 6d 65 72 6b 6c 65 2f 76 31`).
- `u32be(n)` is `n` as a 4-byte big-endian unsigned integer.
- `str(s)` is `u32be(byte length of the UTF-8 encoding of s) || UTF-8 bytes of s`.
  The length counts bytes, not characters: `hito-ñ` is 7 bytes.

## 3. Hashes

```
leaf = H( 0x00 || TAG || str(project_id) || str(milestone_id) || proof_hash )
node = H( 0x01 || TAG || left || right )
```

`proof_hash` is the milestone's existing 32-byte proof hash, the same value
`submit_milestone_proof` takes.

### Domain separation

There are two separators, and each one closes a different attack.

- **The first byte splits leaves from inner nodes**, as in RFC 6962. A leaf
  preimage starts with `0x00` and a node preimage with `0x01`, so no 64-byte
  pair of child hashes can be presented as a leaf, and no leaf can be presented
  as an inner node (a second-preimage attack on the tree).
- **`TAG` splits this scheme from every other use of SHA-256**, including other
  versions of this one. A hash computed for another protocol, or for a future
  `qdit/merkle/v2`, can't collide with a v1 leaf or node by construction.

Every variable-length field is length-prefixed, so `("ab", "c")` and
`("a", "bc")` hash differently. The leaf commits to the `project_id`, so a
proof from one project's batch can't verify against another project's.

## 4. Building the tree

Leaves keep the order the builder gives them. Leaf `i` is at index `i`,
counting from 0.

```
level = [leaf_0, ..., leaf_{n-1}]
while len(level) > 1:
    next = []
    for i in 0, 2, 4, ...:
        if i + 1 < len(level): next.append(node(level[i], level[i+1]))
        else:                  next.append(level[i])        # promoted, not hashed
    level = next
root = level[0]
```

- A batch holds between 1 and 65,536 leaves (`MAX_BATCH_LEAVES`). An empty
  batch has no root and MUST be refused.
- **A lone last node is promoted unchanged** to the next level. It is never
  paired with a copy of itself. Duplicating it, as Bitcoin does, lets two
  different leaf lists share a root (CVE-2012-2459). Promotion doesn't.
- With one leaf, the root is that leaf's hash.
- A builder SHOULD refuse two leaves with the same `milestone_id`. The contract
  can't see the leaves, so this rule is for the off-chain side.

## 5. Inclusion proofs

An inclusion proof for leaf `index` is the list of sibling hashes from the leaf
up to the root, leaf level first. A promoted node has no sibling, so that level
adds nothing, and a proof can be shorter than `ceil(log2(n))`. A proof holds at
most 16 hashes (`MAX_PROOF_LEN`), since `2^16 = 65,536`.

The proof carries no left/right flags. The verifier derives every side from
`index` and the batch's `leaf_count`, which the contract stores. A proof that
names the right siblings in the wrong position fails.

```
verify(root, leaf_count, index, leaf, path):
    if leaf_count == 0 or index >= leaf_count or len(path) > 16: return false
    h, i, size, p = leaf, index, leaf_count, 0
    while size > 1:
        if i is odd:
            if p == len(path): return false
            h = node(path[p], h); p += 1
        else if i + 1 < size:
            if p == len(path): return false
            h = node(h, path[p]); p += 1
        # else: h is the lone last node, promoted unchanged
        i = i / 2         (integer division)
        size = (size + 1) / 2
    return p == len(path) and h == root
```

A proof with extra trailing hashes fails (`p == len(path)`).

## 6. On chain (`milestone_proof_v2`)

| Function | Auth | Result |
| --- | --- | --- |
| `anchor_batch(project_id, batch_id, submitter, root, leaf_count)` | `submitter`, role `Submitter` | Stores `BatchRecord`, emits `batch` |
| `get_batch(project_id, batch_id)` | none | `BatchRecord` |
| `verify_inclusion(project_id, batch_id, milestone_id, proof_hash, index, path)` | none | `bool` |

`BatchRecord` is `{ root, leaf_count, submitter, timestamp, ledger }`.
`timestamp` and `ledger` are the anchoring ledger's.

- `batch_id` is chosen by the caller, at most 64 bytes, and unique per project.
  Reusing one is refused with `BatchExists` (11). An anchored root can't be
  replaced.
- `leaf_count` outside 1 to 65,536 is refused with `InvalidBatch` (14).
- `get_batch` and `verify_inclusion` refuse an unknown batch with
  `BatchNotFound` (13). A malformed or wrong proof returns `false`, not an
  error, so a caller can tell "no such batch" from "not in this batch".
- `verify_inclusion` rebuilds the leaf from `project_id`, `milestone_id` and
  `proof_hash`, so the caller never passes a leaf hash. It is read-only: call it
  by simulation and it costs no fee.

Event `batch`: topic 0 `qdit`, topic 1 `batch`, topic 2 `project_id`; data
`batch_id`, `submitter`, `root`, `leaf_count`, `timestamp`.

## 7. Inclusion-proof file

`qdit-batch` writes one JSON file per milestone. A verifier needs nothing else.

```json
{
  "format": "qdit-inclusion-proof/v1",
  "network": "testnet",
  "contract_id": "C...",
  "project_id": "8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2",
  "batch_id": "sprint-12",
  "milestone_id": "c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7",
  "proof_hash": "<64 hex>",
  "index": 3,
  "leaf_count": 10,
  "leaf": "<64 hex>",
  "path": ["<64 hex>", "..."],
  "root": "<64 hex>",
  "anchor": { "tx_hash": "<64 hex>", "ledger": 123456, "timestamp": 1700000000 }
}
```

Hex is lowercase, without `0x`. `leaf` and `root` are there for convenience. A
verifier MUST recompute `leaf` from the fields and MUST read `root` from the
chain (`get_batch`, or `verify_inclusion`) before trusting the file.
`anchor` is absent when the batch was built but not anchored.

## 8. Test vectors

[`vectors.json`](./vectors.json) is the shared source of truth. The Rust
contract tests and the `@qdit/merkle` tests both load it, so the two
implementations can't drift apart without a test failing. It was produced by
[`gen-vectors.mjs`](./gen-vectors.mjs), a third implementation written
straight from this document, with no code shared with the other two:

```sh
node docs/merkle/gen-vectors.mjs > docs/merkle/vectors.json
```

Changing a byte of this scheme means a new `TAG`, a new section here and new
vectors. Version 1 never changes.
