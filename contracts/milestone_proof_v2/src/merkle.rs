//! The qdit Merkle batch scheme, version 2 (`docs/merkle/SPEC.md`).
//!
//! The contract never builds a tree. It stores a root and a leaf count, and
//! checks one inclusion proof at a time against them.

use soroban_sdk::{Bytes, BytesN, Env, String, Vec};

/// Domain tag for this version of the scheme. A new version gets a new tag.
pub const TAG: &[u8; 14] = b"qdit/merkle/v2";

/// First preimage byte of a leaf, so no inner node can pass as a leaf.
const LEAF_PREFIX: u8 = 0x00;
/// First preimage byte of an inner node.
const NODE_PREFIX: u8 = 0x01;

/// Most leaves a batch may hold.
pub const MAX_BATCH_LEAVES: u32 = 65_536;
/// Longest inclusion proof, `log2(MAX_BATCH_LEAVES)`.
pub const MAX_PROOF_LEN: u32 = 16;

/// `u32be(byte length) || bytes`, so adjacent fields can't run into each other.
fn append_str(buf: &mut Bytes, s: &String) {
    buf.extend_from_array(&s.len().to_be_bytes());
    buf.append(&s.to_bytes());
}

/// `H(0x00 || TAG || str(project_id) || str(milestone_id) || u32be(version) || proof_hash)`.
///
/// `version` is the milestone's submission version, so a leaf names the exact
/// submission it anchors, not only its hash.
pub fn leaf_hash(
    env: &Env,
    project_id: &String,
    milestone_id: &String,
    version: u32,
    proof_hash: &BytesN<32>,
) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.push_back(LEAF_PREFIX);
    buf.extend_from_array(TAG);
    append_str(&mut buf, project_id);
    append_str(&mut buf, milestone_id);
    buf.extend_from_array(&version.to_be_bytes());
    buf.append(&Bytes::from(proof_hash));
    env.crypto().sha256(&buf).to_bytes()
}

/// `H(0x01 || TAG || left || right)`.
pub fn node_hash(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.push_back(NODE_PREFIX);
    buf.extend_from_array(TAG);
    buf.append(&Bytes::from(left));
    buf.append(&Bytes::from(right));
    env.crypto().sha256(&buf).to_bytes()
}

/// Whether `path` leads from `leaf`, at `index`, to `root` in a tree of
/// `leaf_count` leaves.
///
/// Every left/right side comes from `index` and `leaf_count`, never from the
/// proof. A lone last node is promoted without a sibling, so that level uses
/// no hash. A proof that is short, long or out of range is `false`.
pub fn verify(
    env: &Env,
    root: &BytesN<32>,
    leaf_count: u32,
    index: u32,
    leaf: BytesN<32>,
    path: &Vec<BytesN<32>>,
) -> bool {
    if leaf_count == 0 || index >= leaf_count || path.len() > MAX_PROOF_LEN {
        return false;
    }

    let mut hash = leaf;
    let mut i = index;
    let mut size = leaf_count;
    let mut p: u32 = 0;
    while size > 1 {
        if i % 2 == 1 {
            let Some(sibling) = path.get(p) else {
                return false;
            };
            hash = node_hash(env, &sibling, &hash);
            p += 1;
        } else if i + 1 < size {
            let Some(sibling) = path.get(p) else {
                return false;
            };
            hash = node_hash(env, &hash, &sibling);
            p += 1;
        }
        i /= 2;
        size = size.div_ceil(2);
    }

    p == path.len() && hash == *root
}
