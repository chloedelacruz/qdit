//! Merkle batch anchoring: one root on chain for many milestone proofs.
//!
//! A batch is a timestamped commitment that its milestone proof hashes
//! existed. It moves no milestone through the approval state machine.

use soroban_sdk::{Address, BytesN, Env, String, Vec};

use crate::errors::Error;
use crate::events::BatchAnchored;
use crate::members::require_role;
use crate::merkle::{self, MAX_BATCH_LEAVES};
use crate::storage::{self, BatchRecord, Role};

pub fn anchor(
    env: &Env,
    project_id: String,
    batch_id: String,
    submitter: Address,
    root: BytesN<32>,
    leaf_count: u32,
) -> Result<(), Error> {
    storage::check_id(&project_id)?;
    storage::check_id(&batch_id)?;
    submitter.require_auth();

    storage::get_project(env, &project_id)?;
    require_role(env, &project_id, &submitter, Role::Submitter)?;

    if leaf_count == 0 || leaf_count > MAX_BATCH_LEAVES {
        return Err(Error::InvalidBatch);
    }
    if storage::has_batch(env, &project_id, &batch_id) {
        return Err(Error::BatchExists);
    }

    let timestamp = env.ledger().timestamp();
    storage::set_batch(
        env,
        &project_id,
        &batch_id,
        &BatchRecord {
            root: root.clone(),
            leaf_count,
            submitter: submitter.clone(),
            timestamp,
            ledger: env.ledger().sequence(),
        },
    );

    BatchAnchored {
        project_id,
        batch_id,
        submitter,
        root,
        leaf_count,
        timestamp,
    }
    .publish(env);
    Ok(())
}

pub fn get(env: &Env, project_id: String, batch_id: String) -> Result<BatchRecord, Error> {
    storage::check_id(&project_id)?;
    storage::check_id(&batch_id)?;
    storage::get_batch(env, &project_id, &batch_id).ok_or(Error::BatchNotFound)
}

pub fn verify_inclusion(
    env: &Env,
    project_id: String,
    batch_id: String,
    milestone_id: String,
    proof_hash: BytesN<32>,
    index: u32,
    path: Vec<BytesN<32>>,
) -> Result<bool, Error> {
    storage::check_id(&milestone_id)?;
    let batch = get(env, project_id.clone(), batch_id)?;
    let leaf = merkle::leaf_hash(env, &project_id, &milestone_id, &proof_hash);
    Ok(merkle::verify(
        env,
        &batch.root,
        batch.leaf_count,
        index,
        leaf,
        &path,
    ))
}
