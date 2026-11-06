//! Milestone submission and approval.

use soroban_sdk::{Address, BytesN, Env, String, Vec};

use crate::errors::Error;
use crate::events::{MilestoneApproved, MilestoneRejected, ProofSubmitted};
use crate::members::require_role;
use crate::storage::{self, MilestoneRecord, MilestoneStatus, Project, Role};

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

    let timestamp = env.ledger().timestamp();
    storage::set_milestone(
        env,
        &project_id,
        &milestone_id,
        &MilestoneRecord {
            status: MilestoneStatus::Submitted,
            version,
            proof_hash: proof_hash.clone(),
            submitter: submitter.clone(),
            timestamp,
            approvers: Vec::new(env),
        },
    );

    ProofSubmitted {
        project_id,
        milestone_id,
        submitter,
        proof_hash,
        version,
        timestamp,
    }
    .publish(env);
    Ok(())
}

/// The checks approve and reject share: the approver's signature and role, a
/// milestone that is waiting for a decision, and the hash the approver reviewed
/// still being the current one (D-108).
fn load_for_decision(
    env: &Env,
    project_id: &String,
    milestone_id: &String,
    approver: &Address,
    proof_hash: &BytesN<32>,
) -> Result<(Project, MilestoneRecord), Error> {
    storage::check_id(project_id)?;
    storage::check_id(milestone_id)?;
    approver.require_auth();

    let project = storage::get_project(env, project_id)?;
    require_role(env, project_id, approver, Role::Approver)?;

    let record =
        storage::get_milestone(env, project_id, milestone_id).ok_or(Error::MilestoneNotFound)?;
    if record.status != MilestoneStatus::Submitted {
        return Err(Error::InvalidStatus);
    }
    if &record.proof_hash != proof_hash {
        return Err(Error::ProofMismatch);
    }
    Ok((project, record))
}

pub fn approve(
    env: &Env,
    project_id: String,
    milestone_id: String,
    approver: Address,
    proof_hash: BytesN<32>,
) -> Result<(), Error> {
    let (project, mut record) =
        load_for_decision(env, &project_id, &milestone_id, &approver, &proof_hash)?;

    if record.approvers.contains(&approver) {
        return Err(Error::AlreadyApproved);
    }
    record.approvers.push_back(approver.clone());
    // The set's size, not a recount of current approvers: an approval given
    // before its approver was removed still counts (D-105).
    if record.approvers.len() >= project.threshold {
        record.status = MilestoneStatus::Approved;
    }
    storage::set_milestone(env, &project_id, &milestone_id, &record);

    MilestoneApproved {
        project_id,
        milestone_id,
        approver,
        version: record.version,
        proof_hash,
        status: record.status,
    }
    .publish(env);
    Ok(())
}

pub fn reject(
    env: &Env,
    project_id: String,
    milestone_id: String,
    approver: Address,
    proof_hash: BytesN<32>,
) -> Result<(), Error> {
    let (_, mut record) =
        load_for_decision(env, &project_id, &milestone_id, &approver, &proof_hash)?;

    record.status = MilestoneStatus::Rejected;
    storage::set_milestone(env, &project_id, &milestone_id, &record);

    MilestoneRejected {
        project_id,
        milestone_id,
        approver,
        version: record.version,
        proof_hash,
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
