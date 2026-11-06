//! Milestone submission and approval.

use soroban_sdk::{Address, BytesN, Env, String, Vec};

use crate::errors::Error;
use crate::events::ProofSubmitted;
use crate::members::require_role;
use crate::storage::{self, MilestoneRecord, MilestoneStatus, Role};

pub fn submit(
    env: &Env,
    project_id: String,
    milestone_id: String,
    submitter: Address,
    proof_hash: BytesN<32>,
) -> Result<(), Error> {
    storage::check_id(&project_id)?;
    storage::check_id(&milestone_id)?;
    submitter.require_auth();

    storage::get_project(env, &project_id)?;
    require_role(env, &project_id, &submitter, Role::Submitter)?;

    // Every earlier submission counts, including rejected ones.
    let mut version = 1;
    if let Some(existing) = storage::get_milestone(env, &project_id, &milestone_id) {
        if existing.status == MilestoneStatus::Approved {
            return Err(Error::InvalidStatus);
        }
        version = existing.version + 1;
    }

    storage::set_milestone(
        env,
        &project_id,
        &milestone_id,
        &MilestoneRecord {
            status: MilestoneStatus::Submitted,
            version,
            proof_hash: proof_hash.clone(),
            submitter: submitter.clone(),
            timestamp: env.ledger().timestamp(),
            approvers: Vec::new(env),
        },
    );

    ProofSubmitted {
        project_id,
        milestone_id,
        submitter,
        proof_hash,
        version,
    }
    .publish(env);
    Ok(())
}

pub fn get_status(
    env: &Env,
    project_id: String,
    milestone_id: String,
) -> Result<MilestoneRecord, Error> {
    storage::check_id(&project_id)?;
    storage::check_id(&milestone_id)?;
    storage::get_milestone(env, &project_id, &milestone_id).ok_or(Error::MilestoneNotFound)
}
