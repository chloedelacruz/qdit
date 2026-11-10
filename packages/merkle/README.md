# `@qdit/merkle`

The qdit Merkle batch scheme, version 1 ([`docs/merkle/SPEC.md`](../../docs/merkle/SPEC.md)),
in TypeScript: leaf and node hashing, tree building, inclusion proofs and the portable
proof file. It matches `milestone_proof_v2` byte for byte. Both are tested against
[`docs/merkle/vectors.json`](../../docs/merkle/vectors.json).

No runtime dependencies. Node 22.18 or later (it uses `node:crypto`).

```ts
import { MerkleTree, fromHex, toHex, verifyInclusion } from "@qdit/merkle";

const tree = MerkleTree.build(projectId, [
  { milestoneId: "c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7", proofHash: fromHex(hashHex, 32) },
  // ...
]);

tree.root;          // anchor this with anchor_batch(project_id, batch_id, submitter, root, leaf_count)
tree.proof(0);      // sibling hashes, leaf level first

// Later, with root and leafCount read from the chain (get_batch):
verifyInclusion(root, leafCount, {
  projectId,
  milestoneId,
  proofHash,
  index: 0,
  path: tree.proof(0),
});
```

| Export | What it does |
| --- | --- |
| `leafHash(projectId, milestoneId, proofHash)` | `H(0x00 ‖ TAG ‖ str(projectId) ‖ str(milestoneId) ‖ proofHash)` |
| `nodeHash(left, right)` | `H(0x01 ‖ TAG ‖ left ‖ right)` |
| `MerkleTree.build(projectId, leaves)` | Builds the tree. Refuses an empty batch, more than 65,536 leaves, and a repeated milestone id |
| `tree.root`, `tree.proof(i)`, `tree.leaf(i)`, `tree.indexOf(id)` | Root, inclusion proof, leaf hash, lookup |
| `verifyPath(root, leafCount, index, leaf, path)` | The contract's check, from a leaf hash |
| `verifyInclusion(root, leafCount, claim)` | The contract's `verify_inclusion`, off chain |
| `proofFiles(tree, ctx)`, `parseProofFile(json)`, `checkProofFile(file, trusted?)` | The `qdit-inclusion-proof/v1` file |

Malformed proofs come back `false`, not as an exception, as in the contract. Only
building a tree from bad input throws.

**Trust the chain, not the file.** `checkProofFile(file)` with no trusted root only
shows that the file agrees with itself. Read `root` and `leaf_count` from `get_batch`
and pass them in, or call `verify_inclusion` on chain. `qdit-batch verify` does both.

## Develop

```sh
cd packages
npm ci
npm test --workspace @qdit/merkle   # Node runs the .ts tests directly
npm run typecheck --workspace @qdit/merkle
```
