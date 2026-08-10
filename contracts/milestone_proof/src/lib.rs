#![no_std]
//! `milestone_proof` — on-chain milestone attestation for the QDIT builder task hub.
//!
//! A project owner registers a project reference, a submitter attaches a proof
//! hash for a milestone, and the project owner approves or rejects it. Only the
//! 32-byte proof hash lives on chain; the artifact itself stays off chain.
//!
//! State machine: `Proposed -> Submitted -> Approved | Rejected`.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
    String,
};

/// Ledgers produced in roughly one day at ~5s close times.
const DAY_IN_LEDGERS: u32 = 17_280;
/// Only pay for an extension once the entry drops below this many ledgers.
const ENTRY_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
/// How far out to push a persistent entry's TTL when it is touched.
const ENTRY_TTL_EXTEND_TO: u32 = 90 * DAY_IN_LEDGERS;

/// Ceiling on caller-supplied identifiers.
///
/// The app's ids are 36-character UUIDs. 64 leaves room for a prefix without
/// letting a caller pay for — or make the ledger carry — an unbounded key.
const MAX_ID_LEN: u32 = 64;

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
    pub project_id: String,
    pub milestone_id: String,
    /// Address that submitted the proof hash.
    pub submitter: Address,
    /// Hash of the off-chain proof artifact.
    pub proof_hash: BytesN<32>,
    pub status: MilestoneStatus,
    /// Submissions so far, starting at 1. Monotonic.
    ///
    /// A re-submission overwrites `proof_hash`, so without this the ledger
    /// would show the latest hash with no evidence an earlier one existed.
    /// Approve and reject preserve the counter — they attest to a submission
    /// rather than making one.
    pub version: u32,
    /// Ledger timestamp at the moment the proof was submitted.
    pub timestamp: u64,
}

/// Persistent storage keys.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// `project_id -> Address` (the project owner).
    Project(String),
    /// `(project_id, milestone_id) -> MilestoneRecord`.
    Milestone(String, String),
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
    /// An identifier exceeds [`MAX_ID_LEN`].
    IdTooLong = 6,
}

// ---------------------------------------------------------------------------
// Events
//
// Every write emits one, and they are what makes the ledger an audit trail an
// off-chain indexer can resync from without trusting the app's database.
//
// The shape is uniform on purpose:
//   topic 0  "qdit"       — one predicate filters every event of this contract
//   topic 1  the verb
//   topic 2  project_id   — indexed, so a consumer can watch a single project
//                           without decoding the body of every event
//
// Nothing else is a topic. `milestone_id` lives in the data because a consumer
// that cares about one milestone already had to fetch the project's list.
// ---------------------------------------------------------------------------

#[contractevent(topics = ["qdit", "register"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectRegistered {
    #[topic]
    pub project_id: String,
    pub owner: Address,
}

/// Emitted when a project changes hands.
///
/// Both parties are in the data rather than as topics: a consumer watching one
/// project already has `project_id` indexed, and indexing the addresses would
/// invite treating this as a queryable ownership log, which it is not — the
/// current owner is whatever the latest transfer left in storage.
#[contractevent(topics = ["qdit", "transfer"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectOwnerTransferred {
    #[topic]
    pub project_id: String,
    pub previous_owner: Address,
    pub new_owner: Address,
}

#[contractevent(topics = ["qdit", "submit"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProofSubmitted {
    #[topic]
    pub project_id: String,
    pub milestone_id: String,
    pub submitter: Address,
    pub proof_hash: BytesN<32>,
    pub version: u32,
}

#[contractevent(topics = ["qdit", "approve"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneApproved {
    #[topic]
    pub project_id: String,
    pub milestone_id: String,
    pub approver: Address,
    pub version: u32,
}

#[contractevent(topics = ["qdit", "reject"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneRejected {
    #[topic]
    pub project_id: String,
    pub milestone_id: String,
    pub approver: Address,
    pub version: u32,
}

#[contract]
pub struct MilestoneProofContract;

#[contractimpl]
impl MilestoneProofContract {
    /// Register a project reference owned by `owner`.
    ///
    /// Requires `owner` auth. Errors with [`Error::ProjectExists`] if the id is
    /// taken — deliberately, rather than upserting, so a client can treat that
    /// error as "already registered" and carry on.
    pub fn create_project_ref(env: Env, project_id: String, owner: Address) -> Result<(), Error> {
        Self::check_id(&project_id)?;
        owner.require_auth();

        let key = DataKey::Project(project_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::ProjectExists);
        }

        env.storage().persistent().set(&key, &owner);
        Self::bump(&env, &key);

        ProjectRegistered { project_id, owner }.publish(&env);
        Ok(())
    }

    /// Hand a registered project to a new owner.
    ///
    /// **Both parties must sign.** `current_owner` proves the right to give the
    /// project away; `new_owner` proves the destination is an address someone
    /// actually controls. Requiring only the first would let this function
    /// recreate the exact problem it exists to solve — a project pinned to an
    /// address nobody can sign for — and there is no admin path to undo that.
    ///
    /// What this does and does not fix: it recovers a project registered to the
    /// **wrong but still controlled** address, and it makes planned handovers
    /// and key rotation possible. It cannot recover a **lost** key, because a
    /// lost key cannot sign as `current_owner`. Nothing in this contract can;
    /// that is the cost of having no admin address, and it is deliberate.
    ///
    /// Milestone records are untouched. `submitter` is a historical fact about
    /// who submitted, and approve/reject read the owner from storage at call
    /// time, so they follow the new owner without any migration.
    pub fn transfer_project_owner(
        env: Env,
        project_id: String,
        current_owner: Address,
        new_owner: Address,
    ) -> Result<(), Error> {
        Self::check_id(&project_id)?;
        current_owner.require_auth();
        new_owner.require_auth();

        let key = DataKey::Project(project_id.clone());
        // Authorize against the owner in storage, never against the argument —
        // the same rule `transition` follows.
        let stored: Address = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::ProjectNotFound)?;
        if stored != current_owner {
            return Err(Error::NotAuthorized);
        }

        env.storage().persistent().set(&key, &new_owner);
        Self::bump(&env, &key);

        ProjectOwnerTransferred {
            project_id,
            previous_owner: current_owner,
            new_owner,
        }
        .publish(&env);
        Ok(())
    }

    /// Attach a proof hash to a milestone and move it to [`MilestoneStatus::Submitted`].
    ///
    /// Requires `submitter` auth. The milestone does not need to exist beforehand;
    /// an unseen milestone is implicitly `Proposed`. A milestone that has already
    /// been approved is terminal and cannot be re-submitted.
    pub fn submit_milestone_proof(
        env: Env,
        project_id: String,
        milestone_id: String,
        submitter: Address,
        proof_hash: BytesN<32>,
    ) -> Result<(), Error> {
        Self::check_id(&project_id)?;
        Self::check_id(&milestone_id)?;
        submitter.require_auth();

        let project_key = DataKey::Project(project_id.clone());
        if !env.storage().persistent().has(&project_key) {
            return Err(Error::ProjectNotFound);
        }

        let milestone_key = DataKey::Milestone(project_id.clone(), milestone_id.clone());
        // Every prior submission counts, including ones that were rejected.
        let mut version = 1;
        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<DataKey, MilestoneRecord>(&milestone_key)
        {
            if existing.status == MilestoneStatus::Approved {
                return Err(Error::InvalidStatus);
            }
            version = existing.version + 1;
        }

        let record = MilestoneRecord {
            project_id: project_id.clone(),
            milestone_id: milestone_id.clone(),
            submitter: submitter.clone(),
            proof_hash: proof_hash.clone(),
            status: MilestoneStatus::Submitted,
            version,
            timestamp: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&milestone_key, &record);
        Self::bump(&env, &milestone_key);
        Self::bump(&env, &project_key);

        ProofSubmitted {
            project_id,
            milestone_id,
            submitter,
            proof_hash,
            version,
        }
        .publish(&env);
        Ok(())
    }

    /// Approve a submitted milestone. Only the project owner may call this.
    pub fn approve_milestone(
        env: Env,
        project_id: String,
        milestone_id: String,
        approver: Address,
    ) -> Result<(), Error> {
        let version = Self::transition(
            &env,
            &project_id,
            &milestone_id,
            &approver,
            MilestoneStatus::Approved,
        )?;

        MilestoneApproved {
            project_id,
            milestone_id,
            approver,
            version,
        }
        .publish(&env);
        Ok(())
    }

    /// Reject a submitted milestone. Only the project owner may call this.
    pub fn reject_milestone(
        env: Env,
        project_id: String,
        milestone_id: String,
        approver: Address,
    ) -> Result<(), Error> {
        let version = Self::transition(
            &env,
            &project_id,
            &milestone_id,
            &approver,
            MilestoneStatus::Rejected,
        )?;

        MilestoneRejected {
            project_id,
            milestone_id,
            approver,
            version,
        }
        .publish(&env);
        Ok(())
    }

    /// Read the current record for a milestone.
    ///
    /// Unauthenticated: an anchored hash is public by design, and that is what
    /// makes it evidence a third party can check.
    pub fn get_milestone_status(
        env: Env,
        project_id: String,
        milestone_id: String,
    ) -> Result<MilestoneRecord, Error> {
        Self::check_id(&project_id)?;
        Self::check_id(&milestone_id)?;

        env.storage()
            .persistent()
            .get(&DataKey::Milestone(project_id, milestone_id))
            .ok_or(Error::MilestoneNotFound)
    }
}

impl MilestoneProofContract {
    /// Shared owner-authenticated `Submitted -> {Approved, Rejected}` transition.
    ///
    /// Returns the record's version so the caller can name it in its event.
    fn transition(
        env: &Env,
        project_id: &String,
        milestone_id: &String,
        approver: &Address,
        next: MilestoneStatus,
    ) -> Result<u32, Error> {
        Self::check_id(project_id)?;
        Self::check_id(milestone_id)?;
        approver.require_auth();

        let project_key = DataKey::Project(project_id.clone());
        // Authorize against the owner in storage, never against an argument.
        let owner: Address = env
            .storage()
            .persistent()
            .get(&project_key)
            .ok_or(Error::ProjectNotFound)?;
        if &owner != approver {
            return Err(Error::NotAuthorized);
        }

        let milestone_key = DataKey::Milestone(project_id.clone(), milestone_id.clone());
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
        Self::bump(env, &milestone_key);
        Self::bump(env, &project_key);

        Ok(record.version)
    }

    /// Reject an identifier longer than [`MAX_ID_LEN`].
    fn check_id(id: &String) -> Result<(), Error> {
        if id.len() > MAX_ID_LEN {
            return Err(Error::IdTooLong);
        }
        Ok(())
    }

    /// Push a persistent entry's TTL back out to ~90 days.
    fn bump(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod test;
