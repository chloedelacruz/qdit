#![no_std]
//! `milestone_proof_v2`: on-chain team roles and M-of-N milestone approval.
//!
//! A new contract, not an upgrade of `milestone_proof`. It has no admin, no
//! privileged override and no upgrade entry point. Every write requires the
//! acting address's signature and reads roles from storage, never from an
//! argument.

mod errors;
mod events;
mod members;
mod milestones;
mod storage;

pub use errors::Error;
pub use events::*;
pub use storage::{DataKey, MilestoneRecord, MilestoneStatus, Project, Role, MAX_MEMBERS};

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Map, String};

#[contract]
pub struct MilestoneProofV2Contract;

#[contractimpl]
impl MilestoneProofV2Contract {
    /// Register a project owned by `owner`.
    ///
    /// `threshold` must be at least 1. It may exceed the current approver count,
    /// because a project has no approvers yet when it is created (D-104). A
    /// milestone can't reach Approved until enough approvers exist.
    pub fn create_project(
        env: Env,
        project_id: String,
        owner: Address,
        threshold: u32,
    ) -> Result<(), Error> {
        storage::check_id(&project_id)?;
        owner.require_auth();

        if threshold == 0 {
            return Err(Error::InvalidThreshold);
        }
        if storage::has_project(&env, &project_id) {
            return Err(Error::ProjectExists);
        }

        storage::set_project(
            &env,
            &project_id,
            &Project {
                owner: owner.clone(),
                threshold,
            },
        );

        ProjectCreated {
            project_id,
            owner,
            threshold,
        }
        .publish(&env);
        Ok(())
    }

    /// Read a project's owner and threshold.
    pub fn get_project(env: Env, project_id: String) -> Result<Project, Error> {
        storage::check_id(&project_id)?;
        storage::get_project(&env, &project_id)
    }

    /// Add `member` with `role`, or change the role of an existing member.
    ///
    /// Owner-signed. Refused with [`Error::MemberLimit`] on a full roster, and
    /// with [`Error::InvalidThreshold`] if it changes an approver's role and
    /// leaves fewer approvers than the threshold (D-106).
    pub fn add_member(
        env: Env,
        project_id: String,
        owner: Address,
        member: Address,
        role: Role,
    ) -> Result<(), Error> {
        members::add_member(&env, project_id, owner, member, role)
    }

    /// Remove `member` from the roster.
    ///
    /// Owner-signed. Refused with [`Error::NotMember`] if they aren't on it, and
    /// with [`Error::InvalidThreshold`] if it leaves fewer approvers than the
    /// threshold.
    pub fn remove_member(
        env: Env,
        project_id: String,
        owner: Address,
        member: Address,
    ) -> Result<(), Error> {
        members::remove_member(&env, project_id, owner, member)
    }

    /// Hand a project to a new owner (D-107).
    ///
    /// **Both parties must sign**, as in v1: the outgoing owner proves the right
    /// to give it away, and the incoming owner proves the address is controlled.
    /// The roster is unchanged, and the new owner gets no member role.
    pub fn transfer_project_owner(
        env: Env,
        project_id: String,
        current_owner: Address,
        new_owner: Address,
    ) -> Result<(), Error> {
        members::transfer_project_owner(&env, project_id, current_owner, new_owner)
    }

    /// Read a project's roster and each member's role.
    pub fn get_members(env: Env, project_id: String) -> Result<Map<Address, Role>, Error> {
        members::get_members(&env, project_id)
    }

    /// Set how many approvals a milestone needs.
    ///
    /// Owner-signed. `threshold` must be at least 1 and at most the current
    /// approver count, else [`Error::InvalidThreshold`]. It changes no milestone
    /// by itself: see "Lowering a threshold" in the crate README.
    pub fn set_threshold(
        env: Env,
        project_id: String,
        owner: Address,
        threshold: u32,
    ) -> Result<(), Error> {
        members::set_threshold(&env, project_id, owner, threshold)
    }

    /// Attach a proof hash to a milestone and move it to
    /// [`MilestoneStatus::Submitted`].
    ///
    /// `submitter` must hold the `Submitter` role. A resubmission increments the
    /// version and clears earlier approvals, so an approval never carries over to
    /// a new hash. An Approved milestone can't be resubmitted.
    pub fn submit_milestone_proof(
        env: Env,
        project_id: String,
        milestone_id: String,
        submitter: Address,
        proof_hash: BytesN<32>,
    ) -> Result<(), Error> {
        milestones::submit(&env, project_id, milestone_id, submitter, proof_hash)
    }

    /// Record `approver`'s approval of a submitted milestone.
    ///
    /// `approver` must hold the `Approver` role. The milestone becomes Approved
    /// once the size of its approvers set reaches the threshold. An approval
    /// given before the approver was removed still counts (D-105).
    pub fn approve_milestone(
        env: Env,
        project_id: String,
        milestone_id: String,
        approver: Address,
    ) -> Result<(), Error> {
        milestones::approve(&env, project_id, milestone_id, approver)
    }

    /// Reject a submitted milestone. Any one approver can do this, and the
    /// milestone can then be resubmitted.
    pub fn reject_milestone(
        env: Env,
        project_id: String,
        milestone_id: String,
        approver: Address,
    ) -> Result<(), Error> {
        milestones::reject(&env, project_id, milestone_id, approver)
    }

    /// Read a milestone's status, version, proof hash, submitter, submission
    /// time and approvers.
    pub fn get_milestone_status(
        env: Env,
        project_id: String,
        milestone_id: String,
    ) -> Result<MilestoneRecord, Error> {
        milestones::get_status(&env, project_id, milestone_id)
    }
}

#[cfg(test)]
mod test;
