#![no_std]
//! `milestone_proof_v2`: on-chain team roles and M-of-N milestone approval.
//!
//! A new contract, not an upgrade of `milestone_proof`. It has no admin, no
//! privileged override and no upgrade entry point. Every write requires the
//! acting address's signature and reads roles from storage, never from an
//! argument.

mod errors;
mod events;
mod storage;

pub use errors::Error;
pub use events::*;
pub use storage::{DataKey, MilestoneRecord, MilestoneStatus, Project, Role, MAX_MEMBERS};

use soroban_sdk::{contract, contractimpl, Address, Env, String};

#[contract]
pub struct MilestoneProofV2Contract;

#[contractimpl]
impl MilestoneProofV2Contract {
    /// Register a project owned by `owner`.
    ///
    /// `threshold` must be at least 1 and at most [`MAX_MEMBERS`]. It may exceed
    /// the current approver count, because a project has no approvers yet when
    /// it is created (D-104). A milestone can't reach Approved until enough
    /// approvers exist.
    pub fn create_project(
        env: Env,
        project_id: String,
        owner: Address,
        threshold: u32,
    ) -> Result<(), Error> {
        storage::check_id(&project_id)?;
        owner.require_auth();

        if threshold == 0 || threshold > MAX_MEMBERS {
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
}

#[cfg(test)]
mod test;
