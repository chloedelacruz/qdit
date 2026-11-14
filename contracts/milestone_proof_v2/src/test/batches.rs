//! Merkle batch anchoring. The hashing and proof checks run against the shared
//! vectors in `docs/merkle/vectors.json`, which `@qdit/merkle` also loads.

extern crate std;

use super::*;
use crate::merkle;
use crate::{BatchAnchored, BatchRecord, Error, MAX_BATCH_LEAVES};
use serde_json::Value;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    Event as _, IntoVal, Vec,
};
use std::string::String as StdString;

const VECTORS: &str = include_str!("../../../../docs/merkle/vectors.json");

fn vectors() -> Value {
    serde_json::from_str(VECTORS).expect("vectors.json parses")
}

fn s(env: &Env, v: &Value) -> String {
    String::from_str(env, v.as_str().expect("a string"))
}

fn ver(v: &Value) -> u32 {
    u32::try_from(v.as_u64().unwrap()).unwrap()
}

fn h(env: &Env, v: &Value) -> BytesN<32> {
    let text = v.as_str().expect("a hex string");
    assert_eq!(text.len(), 64, "32-byte hex: {text}");
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[2 * i..2 * i + 2], 16).expect("hex");
    }
    BytesN::from_array(env, &out)
}

fn path(env: &Env, v: &Value) -> Vec<BytesN<32>> {
    let mut out = Vec::new(env);
    for item in v.as_array().expect("a path array") {
        out.push_back(h(env, item));
    }
    out
}

/// A project with one submitter and one approver.
struct Team {
    f: Fixture,
    submitter: Address,
    approver: Address,
}

fn team() -> Team {
    let f = setup();
    f.client.create_project(&project_id(&f.env), &f.owner, &1);
    let submitter = add_member(&f, Role::Submitter);
    let approver = add_member(&f, Role::Approver);
    Team {
        f,
        submitter,
        approver,
    }
}

fn batch_id(env: &Env) -> String {
    String::from_str(env, "sprint-12")
}

impl Team {
    fn anchor(&self, root: &BytesN<32>, leaf_count: u32) {
        self.f.client.anchor_batch(
            &project_id(&self.f.env),
            &batch_id(&self.f.env),
            &self.submitter,
            root,
            &leaf_count,
        );
    }

    fn try_anchor(&self, submitter: &Address, leaf_count: u32) -> Result<(), Error> {
        match self.f.client.try_anchor_batch(
            &project_id(&self.f.env),
            &batch_id(&self.f.env),
            submitter,
            &proof(&self.f.env, 1),
            &leaf_count,
        ) {
            Ok(_) => Ok(()),
            Err(Ok(e)) => Err(e),
            Err(Err(e)) => panic!("host error: {e:?}"),
        }
    }
}

// ---- the scheme itself, against the shared vectors ----

#[test]
fn the_domain_tag_matches_the_vectors() {
    let v = vectors();
    let tag_hex: StdString = merkle::TAG
        .iter()
        .map(|b| std::format!("{b:02x}"))
        .collect();
    assert_eq!(tag_hex, v["primitives"]["tag_hex"].as_str().unwrap());
}

#[test]
fn leaf_and_node_hashes_match_the_vectors() {
    let env = Env::default();
    let v = vectors();
    for leaf in v["primitives"]["leaf"].as_array().unwrap() {
        assert_eq!(
            merkle::leaf_hash(
                &env,
                &s(&env, &leaf["project_id"]),
                &s(&env, &leaf["milestone_id"]),
                ver(&leaf["version"]),
                &h(&env, &leaf["proof_hash"]),
            ),
            h(&env, &leaf["hash"]),
        );
    }
    for node in v["primitives"]["node"].as_array().unwrap() {
        assert_eq!(
            merkle::node_hash(&env, &h(&env, &node["left"]), &h(&env, &node["right"])),
            h(&env, &node["hash"]),
        );
    }
}

#[test]
fn length_prefixes_keep_adjacent_ids_apart() {
    let v = vectors();
    let leaves = v["primitives"]["leaf"].as_array().unwrap();
    // ("ab", "c") and ("a", "bc") concatenate to the same bytes.
    assert_ne!(leaves[1]["hash"], leaves[2]["hash"]);
}

#[test]
fn every_vector_batch_proves_every_leaf_on_chain() {
    let v = vectors();
    for batch in v["batches"].as_array().unwrap() {
        let f = setup();
        let env = &f.env;
        let project = s(env, &batch["project_id"]);
        f.client.create_project(&project, &f.owner, &1);
        let submitter = Address::generate(env);
        f.client
            .add_member(&project, &f.owner, &submitter, &Role::Submitter);

        let leaves = batch["leaves"].as_array().unwrap();
        let root = h(env, &batch["root"]);
        f.client.anchor_batch(
            &project,
            &batch_id(env),
            &submitter,
            &root,
            &(leaves.len() as u32),
        );

        for (n, leaf) in leaves.iter().enumerate() {
            let milestone = s(env, &leaf["milestone_id"]);
            let version = ver(&leaf["version"]);
            let proof_hash = h(env, &leaf["proof_hash"]);
            assert_eq!(
                merkle::leaf_hash(env, &project, &milestone, version, &proof_hash),
                h(env, &leaf["leaf"]),
                "{}: leaf {n}",
                batch["name"],
            );

            let p = &batch["proofs"][n];
            assert_eq!(p["index"].as_u64().unwrap() as usize, n);
            assert!(
                f.client.verify_inclusion(
                    &project,
                    &batch_id(env),
                    &milestone,
                    &version,
                    &proof_hash,
                    &(n as u32),
                    &path(env, &p["path"]),
                ),
                "{}: proof {n}",
                batch["name"],
            );
        }
    }
}

#[test]
fn every_invalid_vector_proof_is_false() {
    let v = vectors();
    for bad in v["invalid_proofs"].as_array().unwrap() {
        let batch = v["batches"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["name"] == bad["batch"])
            .unwrap();
        let f = setup();
        let env = &f.env;
        let project = s(env, &batch["project_id"]);
        f.client.create_project(&project, &f.owner, &1);
        let submitter = Address::generate(env);
        f.client
            .add_member(&project, &f.owner, &submitter, &Role::Submitter);
        let leaf_count = batch["leaves"].as_array().unwrap().len() as u32;
        f.client.anchor_batch(
            &project,
            &batch_id(env),
            &submitter,
            &h(env, &batch["root"]),
            &leaf_count,
        );

        // A proof claimed under another project checks the leaf that project
        // would have, against this project's root.
        let claimed = bad.get("project_id").map(|p| s(env, p));
        let leaf = merkle::leaf_hash(
            env,
            claimed.as_ref().unwrap_or(&project),
            &s(env, &bad["milestone_id"]),
            ver(&bad["version"]),
            &h(env, &bad["proof_hash"]),
        );
        let ok = merkle::verify(
            env,
            &h(env, &batch["root"]),
            leaf_count,
            bad["index"].as_u64().unwrap() as u32,
            leaf,
            &path(env, &bad["path"]),
        );
        assert!(!ok, "{} verified", bad["name"]);

        if claimed.is_none() {
            assert!(
                !f.client.verify_inclusion(
                    &project,
                    &batch_id(env),
                    &s(env, &bad["milestone_id"]),
                    &ver(&bad["version"]),
                    &h(env, &bad["proof_hash"]),
                    &(bad["index"].as_u64().unwrap() as u32),
                    &path(env, &bad["path"]),
                ),
                "{} verified on chain",
                bad["name"],
            );
        }
    }
}

// ---- anchor_batch ----

#[test]
fn anchor_records_every_field() {
    let t = team();
    t.f.env.ledger().set_sequence_number(4242);

    t.anchor(&proof(&t.f.env, 0xaa), 10);

    assert_eq!(
        t.f.client
            .get_batch(&project_id(&t.f.env), &batch_id(&t.f.env)),
        BatchRecord {
            root: proof(&t.f.env, 0xaa),
            leaf_count: 10,
            submitter: t.submitter.clone(),
            timestamp: NOW,
            ledger: 4242,
        }
    );
}

#[test]
fn anchor_emits_one_batch_event() {
    let t = team();

    t.anchor(&proof(&t.f.env, 0xaa), 10);

    assert_eq!(
        t.f.env.events().all(),
        [BatchAnchored {
            project_id: project_id(&t.f.env),
            batch_id: batch_id(&t.f.env),
            submitter: t.submitter.clone(),
            root: proof(&t.f.env, 0xaa),
            leaf_count: 10,
            timestamp: NOW,
        }
        .to_xdr(&t.f.env, &t.f.client.address)],
    );
}

#[test]
fn anchor_needs_the_submitters_signature_over_every_argument() {
    let t = team();
    let root = proof(&t.f.env, 0xaa);
    t.f.env.mock_auths(&[MockAuth {
        address: &t.submitter,
        invoke: &MockAuthInvoke {
            contract: &t.f.client.address,
            fn_name: "anchor_batch",
            args: (
                project_id(&t.f.env),
                batch_id(&t.f.env),
                t.submitter.clone(),
                root.clone(),
                10u32,
            )
                .into_val(&t.f.env),
            sub_invokes: &[],
        },
    }]);

    // Signed for 10 leaves, sent with 11: refused.
    assert!(t
        .f
        .client
        .try_anchor_batch(
            &project_id(&t.f.env),
            &batch_id(&t.f.env),
            &t.submitter,
            &root,
            &11,
        )
        .is_err());

    t.anchor(&root, 10);
    t.f.env.mock_all_auths();
    assert_eq!(
        t.f.client
            .get_batch(&project_id(&t.f.env), &batch_id(&t.f.env))
            .leaf_count,
        10
    );
}

#[test]
fn a_reused_batch_id_is_refused_and_the_root_kept() {
    let t = team();
    t.anchor(&proof(&t.f.env, 1), 4);

    assert_eq!(
        t.f.client.try_anchor_batch(
            &project_id(&t.f.env),
            &batch_id(&t.f.env),
            &t.submitter,
            &proof(&t.f.env, 2),
            &4,
        ),
        Err(Ok(Error::BatchExists))
    );
    assert_eq!(
        t.f.client
            .get_batch(&project_id(&t.f.env), &batch_id(&t.f.env))
            .root,
        proof(&t.f.env, 1)
    );
}

#[test]
fn the_same_batch_id_is_free_in_another_project() {
    let t = team();
    t.anchor(&proof(&t.f.env, 1), 4);

    let other = String::from_str(&t.f.env, "other-project");
    t.f.client.create_project(&other, &t.f.owner, &1);
    t.f.client
        .add_member(&other, &t.f.owner, &t.submitter, &Role::Submitter);
    t.f.client.anchor_batch(
        &other,
        &batch_id(&t.f.env),
        &t.submitter,
        &proof(&t.f.env, 2),
        &4,
    );

    assert_eq!(
        t.f.client.get_batch(&other, &batch_id(&t.f.env)).root,
        proof(&t.f.env, 2)
    );
}

#[test]
fn leaf_count_bounds() {
    let t = team();
    assert_eq!(t.try_anchor(&t.submitter, 0), Err(Error::InvalidBatch));
    assert_eq!(
        t.try_anchor(&t.submitter, MAX_BATCH_LEAVES + 1),
        Err(Error::InvalidBatch)
    );
    assert_eq!(t.try_anchor(&t.submitter, MAX_BATCH_LEAVES), Ok(()));
}

#[test]
fn only_a_submitter_can_anchor() {
    let t = team();
    let stranger = Address::generate(&t.f.env);
    assert_eq!(t.try_anchor(&stranger, 1), Err(Error::NotMember));
    assert_eq!(t.try_anchor(&t.f.owner, 1), Err(Error::NotMember));
    assert_eq!(t.try_anchor(&t.approver, 1), Err(Error::NotAuthorized));
    assert_eq!(
        t.f.client
            .try_get_batch(&project_id(&t.f.env), &batch_id(&t.f.env)),
        Err(Ok(Error::BatchNotFound))
    );
}

#[test]
fn anchoring_into_an_unknown_project_is_refused() {
    let f = setup();
    let submitter = Address::generate(&f.env);
    assert_eq!(
        f.client.try_anchor_batch(
            &project_id(&f.env),
            &batch_id(&f.env),
            &submitter,
            &proof(&f.env, 1),
            &1,
        ),
        Err(Ok(Error::ProjectNotFound))
    );
}

#[test]
fn long_ids_are_refused() {
    let t = team();
    let long = too_long_id(&t.f.env);
    let env = &t.f.env;
    assert_eq!(
        t.f.client
            .try_anchor_batch(&project_id(env), &long, &t.submitter, &proof(env, 1), &1),
        Err(Ok(Error::IdTooLong))
    );
    assert_eq!(
        t.f.client.try_get_batch(&project_id(env), &long),
        Err(Ok(Error::IdTooLong))
    );
    assert_eq!(
        t.f.client.try_verify_inclusion(
            &project_id(env),
            &batch_id(env),
            &long,
            &1,
            &proof(env, 1),
            &0,
            &Vec::new(env),
        ),
        Err(Ok(Error::IdTooLong))
    );
}

#[test]
fn a_batch_changes_no_milestone() {
    let t = team();
    let env = &t.f.env;
    let leaf = merkle::leaf_hash(env, &project_id(env), &milestone_id(env), 1, &proof(env, 9));

    // A one-leaf batch: the root is the leaf.
    t.anchor(&leaf, 1);

    assert!(t.f.client.verify_inclusion(
        &project_id(env),
        &batch_id(env),
        &milestone_id(env),
        &1,
        &proof(env, 9),
        &0,
        &Vec::new(env),
    ));
    assert_eq!(
        t.f.client
            .try_get_milestone_status(&project_id(env), &milestone_id(env)),
        Err(Ok(Error::MilestoneNotFound))
    );
}

// ---- verify_inclusion ----

#[test]
fn verifying_against_an_unknown_batch_is_an_error_not_false() {
    let t = team();
    let env = &t.f.env;
    assert_eq!(
        t.f.client.try_verify_inclusion(
            &project_id(env),
            &batch_id(env),
            &milestone_id(env),
            &1,
            &proof(env, 1),
            &0,
            &Vec::new(env),
        ),
        Err(Ok(Error::BatchNotFound))
    );
}

#[test]
fn a_wrong_proof_hash_is_false() {
    let t = team();
    let env = &t.f.env;
    let leaf = merkle::leaf_hash(env, &project_id(env), &milestone_id(env), 1, &proof(env, 9));
    t.anchor(&leaf, 1);

    assert!(!t.f.client.verify_inclusion(
        &project_id(env),
        &batch_id(env),
        &milestone_id(env),
        &1,
        &proof(env, 8),
        &0,
        &Vec::new(env),
    ));
}

#[test]
fn verify_inclusion_needs_no_signature() {
    let t = team();
    let env = &t.f.env;
    let leaf = merkle::leaf_hash(env, &project_id(env), &milestone_id(env), 1, &proof(env, 9));
    t.anchor(&leaf, 1);

    env.mock_auths(&[]);
    assert!(t.f.client.verify_inclusion(
        &project_id(env),
        &batch_id(env),
        &milestone_id(env),
        &1,
        &proof(env, 9),
        &0,
        &Vec::new(env),
    ));
    assert_eq!(env.auths(), std::vec![]);
}
