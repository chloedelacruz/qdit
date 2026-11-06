//! The per-project roster, and who owns the project.

use soroban_sdk::{Address, Env, Map, String};

use crate::errors::Error;
use crate::events::{MemberAdded, MemberRemoved, ProjectOwnerTransferred};
use crate::storage::{self, Project, Role, MAX_MEMBERS};

/// Require `owner`'s signature and check it against the owner in storage,
/// never against the argument.
fn require_owner(env: &Env, project_id: &String, owner: &Address) -> Result<Project, Error> {
    owner.require_auth();

    let project = storage::get_project(env, project_id)?;
    if &project.owner != owner {
        return Err(Error::NotAuthorized);
    }
    Ok(project)
}

fn approver_count(members: &Map<Address, Role>) -> u32 {
    members
        .values()
        .iter()
        .filter(|role| *role == Role::Approver)
        .count() as u32
}

/// Refuse a change that takes one approver away and leaves too few.
fn check_losing_an_approver(project: &Project, members: &Map<Address, Role>) -> Result<(), Error> {
    if approver_count(members) - 1 < project.threshold {
        return Err(Error::InvalidThreshold);
    }
    Ok(())
}

pub fn add_member(
    env: &Env,
    project_id: String,
    owner: Address,
    member: Address,
    role: Role,
) -> Result<(), Error> {
    storage::check_id(&project_id)?;
    let project = require_owner(env, &project_id, &owner)?;

    let mut members = storage::get_members(env, &project_id);
    match members.get(member.clone()) {
        Some(Role::Approver) if role != Role::Approver => {
            check_losing_an_approver(&project, &members)?;
        }
        None if members.len() >= MAX_MEMBERS => return Err(Error::MemberLimit),
        _ => {}
    }

    members.set(member.clone(), role);
    storage::set_members(env, &project_id, &members);

    MemberAdded {
        project_id,
        member,
        role,
    }
    .publish(env);
    Ok(())
}

pub fn remove_member(
    env: &Env,
    project_id: String,
    owner: Address,
    member: Address,
) -> Result<(), Error> {
    storage::check_id(&project_id)?;
    let project = require_owner(env, &project_id, &owner)?;

    let mut members = storage::get_members(env, &project_id);
    let role = members.get(member.clone()).ok_or(Error::NotMember)?;
    if role == Role::Approver {
        check_losing_an_approver(&project, &members)?;
    }

    members.remove(member.clone());
    storage::set_members(env, &project_id, &members);

    MemberRemoved {
        project_id,
        member,
        role,
    }
    .publish(env);
    Ok(())
}

pub fn transfer_project_owner(
    env: &Env,
    project_id: String,
    current_owner: Address,
    new_owner: Address,
) -> Result<(), Error> {
    storage::check_id(&project_id)?;
    new_owner.require_auth();
    let project = require_owner(env, &project_id, &current_owner)?;

    storage::set_project(
        env,
        &project_id,
        &Project {
            owner: new_owner.clone(),
            threshold: project.threshold,
        },
    );

    ProjectOwnerTransferred {
        project_id,
        previous_owner: current_owner,
        new_owner,
    }
    .publish(env);
    Ok(())
}

pub fn get_members(env: &Env, project_id: String) -> Result<Map<Address, Role>, Error> {
    storage::check_id(&project_id)?;
    storage::get_project(env, &project_id)?;
    Ok(storage::get_members(env, &project_id))
}
