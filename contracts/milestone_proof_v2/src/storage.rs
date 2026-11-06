use soroban_sdk::{contracttype, Address, BytesN, Env, String, Vec};

use crate::errors::Error;

/// Ceiling on caller-supplied identifiers, the same as v1.
const MAX_ID_LEN: u32 = 64;

/// Ceiling on a project's roster.
///
/// It also caps the threshold. A milestone stops collecting approvals once it
/// reaches the threshold, so this bounds every approvers set as well, even
/// though a set can hold addresses that have since left the roster (D-105).
pub const MAX_MEMBERS: u32 = 20;

/// A registered project.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Project {
    pub owner: Address,
    /// Approvals a milestone needs to become [`MilestoneStatus::Approved`].
    pub threshold: u32,
}

/// What a member may do. Each address holds one role.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Role {
    Submitter,
    Approver,
}

/// Lifecycle of a single milestone.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    /// Registered but no proof submitted yet.
    Proposed,
    /// Proof hash submitted, collecting approvals.
    Submitted,
    /// The threshold was reached. Terminal.
    Approved,
    /// An approver rejected this version. It may be resubmitted.
    Rejected,
}

/// The on-chain record for one milestone of one project.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneRecord {
    pub status: MilestoneStatus,
    /// Submissions so far, starting at 1. Monotonic.
    pub version: u32,
    /// Hash of the off-chain proof artifact.
    pub proof_hash: BytesN<32>,
    /// Address that submitted this version.
    pub submitter: Address,
    /// Ledger timestamp of this version's submission.
    pub timestamp: u64,
    /// Addresses that approved this version, in order. Holds no duplicates.
    pub approvers: Vec<Address>,
}

/// Persistent storage keys.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// `project_id -> Project`.
    Project(String),
}

/// Reject an identifier longer than [`MAX_ID_LEN`].
pub fn check_id(id: &String) -> Result<(), Error> {
    if id.len() > MAX_ID_LEN {
        return Err(Error::IdTooLong);
    }
    Ok(())
}

pub fn has_project(env: &Env, project_id: &String) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Project(project_id.clone()))
}

pub fn get_project(env: &Env, project_id: &String) -> Result<Project, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Project(project_id.clone()))
        .ok_or(Error::ProjectNotFound)
}

pub fn set_project(env: &Env, project_id: &String, project: &Project) {
    env.storage()
        .persistent()
        .set(&DataKey::Project(project_id.clone()), project);
}
