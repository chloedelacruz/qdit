#![no_std]
//! `milestone_proof` — on-chain milestone attestation for the QDIT builder task hub.
//!
//! A project owner registers a project reference, a submitter attaches a proof
//! hash for a milestone, and the project owner approves or rejects it. Only the
//! 32-byte proof hash lives on chain; the artifact itself stays off chain.
//!
//! State machine: `Proposed -> Submitted -> Approved | Rejected`.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol,
};

/// Ledgers produced in roughly one day at ~5s close times.
const DAY_IN_LEDGERS: u32 = 17_280;
/// How far out to push a persistent entry's TTL when it is touched.
const ENTRY_TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
/// Only pay for an extension once the entry drops below this many ledgers.
const ENTRY_TTL_THRESHOLD: u32 = ENTRY_TTL_EXTEND_TO - DAY_IN_LEDGERS;

/// Lifecycle of a single milestone.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    /// Registered but no proof submitted yet.
    Proposed,
    /// Proof hash submitted, awaiting the project owner's decision.
    Submitted,
    /// Accepted by the project owner. Terminal.
    Approved,
    /// Rejected by the project owner. Terminal.
    Rejected,
}

/// The full on-chain record for one milestone of one project.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneRecord {
    pub project_id: Symbol,
    pub milestone_id: Symbol,
    /// Address that submitted the proof hash.
    pub submitter: Address,
    /// Hash of the off-chain proof artifact.
    pub proof_hash: BytesN<32>,
    pub status: MilestoneStatus,
    /// Ledger timestamp at the moment the proof was submitted.
    pub timestamp: u64,
}

/// Persistent storage keys.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// `project_id -> Address` (the project owner).
    Project(Symbol),
    /// `(project_id, milestone_id) -> MilestoneRecord`.
    Milestone(Symbol, Symbol),
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// A project with this id is already registered.
    ProjectExists = 1,
    /// No project is registered under this id.
    ProjectNotFound = 2,
    /// No milestone record exists for this project/milestone pair.
    MilestoneNotFound = 3,
    /// Caller is authenticated but is not the project owner.
    NotAuthorized = 4,
    /// The milestone is not in a status that permits this transition.
    InvalidStatus = 5,
}

#[contract]
pub struct MilestoneProofContract;

#[contractimpl]
impl MilestoneProofContract {
    /// Register a project reference owned by `owner`.
    ///
    /// Requires `owner` auth. Errors with [`Error::ProjectExists`] if the id is taken.
    pub fn create_project_ref(env: Env, project_id: Symbol, owner: Address) -> Result<(), Error> {
        owner.require_auth();

        let key = DataKey::Project(project_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::ProjectExists);
        }

        env.storage().persistent().set(&key, &owner);
        Self::bump(&env, &key);
        Ok(())
    }

    /// Attach a proof hash to a milestone and move it to [`MilestoneStatus::Submitted`].
    ///
    /// Requires `submitter` auth. The milestone does not need to exist beforehand;
    /// an unseen milestone is implicitly `Proposed`. A milestone that has already
    /// been approved is terminal and cannot be re-submitted.
    pub fn submit_milestone_proof(
        env: Env,
        project_id: Symbol,
        milestone_id: Symbol,
        submitter: Address,
        proof_hash: BytesN<32>,
    ) -> Result<(), Error> {
        submitter.require_auth();

        let project_key = DataKey::Project(project_id.clone());
        if !env.storage().persistent().has(&project_key) {
            return Err(Error::ProjectNotFound);
        }

        let milestone_key = DataKey::Milestone(project_id.clone(), milestone_id.clone());
        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<DataKey, MilestoneRecord>(&milestone_key)
        {
            if existing.status == MilestoneStatus::Approved {
                return Err(Error::InvalidStatus);
            }
        }

        let record = MilestoneRecord {
            project_id,
            milestone_id,
            submitter,
            proof_hash,
            status: MilestoneStatus::Submitted,
            timestamp: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&milestone_key, &record);
        Self::bump(&env, &milestone_key);
        Self::bump(&env, &project_key);
        Ok(())
    }

    /// Approve a submitted milestone. Only the project owner may call this.
    pub fn approve_milestone(
        env: Env,
        project_id: Symbol,
        milestone_id: Symbol,
        approver: Address,
    ) -> Result<(), Error> {
        Self::transition(
            env,
            project_id,
            milestone_id,
            approver,
            MilestoneStatus::Approved,
        )
    }

    /// Reject a submitted milestone. Only the project owner may call this.
    pub fn reject_milestone(
        env: Env,
        project_id: Symbol,
        milestone_id: Symbol,
        approver: Address,
    ) -> Result<(), Error> {
        Self::transition(
            env,
            project_id,
            milestone_id,
            approver,
            MilestoneStatus::Rejected,
        )
    }

    /// Read the current record for a milestone.
    pub fn get_milestone_status(
        env: Env,
        project_id: Symbol,
        milestone_id: Symbol,
    ) -> Result<MilestoneRecord, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Milestone(project_id, milestone_id))
            .ok_or(Error::MilestoneNotFound)
    }
}

impl MilestoneProofContract {
    /// Shared owner-authenticated `Submitted -> {Approved, Rejected}` transition.
    fn transition(
        env: Env,
        project_id: Symbol,
        milestone_id: Symbol,
        approver: Address,
        next: MilestoneStatus,
    ) -> Result<(), Error> {
        approver.require_auth();

        let project_key = DataKey::Project(project_id.clone());
        let owner: Address = env
            .storage()
            .persistent()
            .get(&project_key)
            .ok_or(Error::ProjectNotFound)?;
        if owner != approver {
            return Err(Error::NotAuthorized);
        }

        let milestone_key = DataKey::Milestone(project_id, milestone_id);
        let mut record: MilestoneRecord = env
            .storage()
            .persistent()
            .get(&milestone_key)
            .ok_or(Error::MilestoneNotFound)?;
        if record.status != MilestoneStatus::Submitted {
            return Err(Error::InvalidStatus);
        }

        record.status = next;
        env.storage().persistent().set(&milestone_key, &record);
        Self::bump(&env, &milestone_key);
        Self::bump(&env, &project_key);
        Ok(())
    }

    /// Push a persistent entry's TTL back out to ~30 days.
    fn bump(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod test;
