use soroban_sdk::{contracttype, Address, BytesN, Env, Map, String, Vec};

use crate::errors::Error;

/// Ceiling on caller-supplied identifiers, the same as v1.
const MAX_ID_LEN: u32 = 64;

/// Ceiling on a project's roster.
///
/// It also bounds every approvers set, at one more than this, even though a set
/// can hold addresses that have since left the roster (D-105). A set stops growing
/// at the threshold. While the threshold is above the approver count no approver
/// can leave, so the set stops at the roster's size until the threshold is lowered,
/// and the next approval then finalises the milestone.
pub const MAX_MEMBERS: u32 = 20;

/// Ledgers in a day, at five seconds a ledger.
pub const DAY_IN_LEDGERS: u32 = 17_280;

/// TTL every write extends its entries, the project's shared entries and the
/// contract instance to: 120 days, well under the network's 180-day ceiling.
pub const TTL_EXTEND_TO: u32 = 120 * DAY_IN_LEDGERS;

/// An entry with less TTL left than this is extended on a write, so a busy
/// project pays the rent bump at most once a day.
pub const TTL_THRESHOLD: u32 = TTL_EXTEND_TO - DAY_IN_LEDGERS;

/// Mainnet and testnet cap an entry's TTL at 3,110,400 ledgers.
const _: () = assert!(TTL_EXTEND_TO < 3_110_400);

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
    /// `project_id -> Map<Address, Role>`, the project's roster.
    Members(String),
    /// `(project_id, milestone_id) -> MilestoneRecord`.
    Milestone(String, String),
    /// `(project_id, batch_id) -> BatchRecord`.
    Batch(String, String),
}

/// An anchored Merkle batch (`docs/merkle/SPEC.md`). Written once, never
/// replaced.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchRecord {
    /// Merkle root over the batch's milestone leaves.
    pub root: BytesN<32>,
    /// Leaves in the tree. Inclusion proofs derive their sides from it.
    pub leaf_count: u32,
    /// Address that anchored the batch.
    pub submitter: Address,
    /// Ledger timestamp of the anchoring.
    pub timestamp: u64,
    /// Ledger sequence of the anchoring.
    pub ledger: u32,
}

fn extend(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Keep alive what every call on a project reads: its record, its roster when
/// it has one, and the contract instance and code. Every write calls this, so a
/// project in use never loses an entry it still needs.
fn extend_project(env: &Env, project_id: &String) {
    extend(env, &DataKey::Project(project_id.clone()));
    let members = DataKey::Members(project_id.clone());
    if env.storage().persistent().has(&members) {
        extend(env, &members);
    }
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
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
    extend_project(env, project_id);
}

/// The project's roster. Empty until the owner adds someone.
pub fn get_members(env: &Env, project_id: &String) -> Map<Address, Role> {
    env.storage()
        .persistent()
        .get(&DataKey::Members(project_id.clone()))
        .unwrap_or_else(|| Map::new(env))
}

pub fn set_members(env: &Env, project_id: &String, members: &Map<Address, Role>) {
    env.storage()
        .persistent()
        .set(&DataKey::Members(project_id.clone()), members);
    extend_project(env, project_id);
}

pub fn get_milestone(
    env: &Env,
    project_id: &String,
    milestone_id: &String,
) -> Option<MilestoneRecord> {
    env.storage().persistent().get(&DataKey::Milestone(
        project_id.clone(),
        milestone_id.clone(),
    ))
}

pub fn set_milestone(
    env: &Env,
    project_id: &String,
    milestone_id: &String,
    record: &MilestoneRecord,
) {
    let key = DataKey::Milestone(project_id.clone(), milestone_id.clone());
    env.storage().persistent().set(&key, record);
    extend(env, &key);
    extend_project(env, project_id);
}

pub fn get_batch(env: &Env, project_id: &String, batch_id: &String) -> Option<BatchRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::Batch(project_id.clone(), batch_id.clone()))
}

pub fn has_batch(env: &Env, project_id: &String, batch_id: &String) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Batch(project_id.clone(), batch_id.clone()))
}

pub fn set_batch(env: &Env, project_id: &String, batch_id: &String, record: &BatchRecord) {
    let key = DataKey::Batch(project_id.clone(), batch_id.clone());
    env.storage().persistent().set(&key, record);
    extend(env, &key);
    extend_project(env, project_id);
}
