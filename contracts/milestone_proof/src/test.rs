#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    Env,
};

/// Fixture: fresh env with auth mocked, contract registered, client + addresses.
struct Fixture {
    env: Env,
    client: MilestoneProofContractClient<'static>,
    owner: Address,
    builder: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);

    let contract_id = env.register(MilestoneProofContract, ());
    let client = MilestoneProofContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let builder = Address::generate(&env);

    Fixture {
        env,
        client,
        owner,
        builder,
    }
}

fn project() -> Symbol {
    symbol_short!("proj_1")
}

fn milestone() -> Symbol {
    symbol_short!("ms_1")
}

fn proof(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

#[test]
fn create_submit_approve_happy_path() {
    let f = setup();
    let hash = proof(&f.env, 0xab);

    f.client.create_project_ref(&project(), &f.owner);
    f.client
        .submit_milestone_proof(&project(), &milestone(), &f.builder, &hash);

    let submitted = f.client.get_milestone_status(&project(), &milestone());
    assert_eq!(submitted.status, MilestoneStatus::Submitted);
    assert_eq!(submitted.project_id, project());
    assert_eq!(submitted.milestone_id, milestone());
    assert_eq!(submitted.submitter, f.builder);
    assert_eq!(submitted.proof_hash, hash);
    assert_eq!(submitted.timestamp, 1_700_000_000);

    f.client
        .approve_milestone(&project(), &milestone(), &f.owner);

    let approved = f.client.get_milestone_status(&project(), &milestone());
    assert_eq!(approved.status, MilestoneStatus::Approved);
    // Approval preserves the submission timestamp and proof hash.
    assert_eq!(approved.timestamp, 1_700_000_000);
    assert_eq!(approved.proof_hash, hash);
}

#[test]
fn reject_path() {
    let f = setup();

    f.client.create_project_ref(&project(), &f.owner);
    f.client
        .submit_milestone_proof(&project(), &milestone(), &f.builder, &proof(&f.env, 1));
    f.client
        .reject_milestone(&project(), &milestone(), &f.owner);

    assert_eq!(
        f.client
            .get_milestone_status(&project(), &milestone())
            .status,
        MilestoneStatus::Rejected
    );
}

#[test]
fn rejected_milestone_can_be_resubmitted() {
    let f = setup();

    f.client.create_project_ref(&project(), &f.owner);
    f.client
        .submit_milestone_proof(&project(), &milestone(), &f.builder, &proof(&f.env, 1));
    f.client
        .reject_milestone(&project(), &milestone(), &f.owner);

    f.env.ledger().set_timestamp(1_700_009_999);
    let second = proof(&f.env, 2);
    f.client
        .submit_milestone_proof(&project(), &milestone(), &f.builder, &second);

    let record = f.client.get_milestone_status(&project(), &milestone());
    assert_eq!(record.status, MilestoneStatus::Submitted);
    assert_eq!(record.proof_hash, second);
    assert_eq!(record.timestamp, 1_700_009_999);
}

#[test]
fn duplicate_project_errors() {
    let f = setup();

    f.client.create_project_ref(&project(), &f.owner);

    assert_eq!(
        f.client.try_create_project_ref(&project(), &f.owner),
        Err(Ok(Error::ProjectExists))
    );
    // Also rejected when a different address tries to claim the same id.
    assert_eq!(
        f.client.try_create_project_ref(&project(), &f.builder),
        Err(Ok(Error::ProjectExists))
    );
}

#[test]
fn create_project_requires_owner_auth() {
    let f = setup();

    f.client.create_project_ref(&project(), &f.owner);

    // mock_all_auths records the auth the contract demanded.
    let auths = f.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, f.owner);
}

#[test]
fn submit_to_unknown_project_errors() {
    let f = setup();

    assert_eq!(
        f.client.try_submit_milestone_proof(
            &project(),
            &milestone(),
            &f.builder,
            &proof(&f.env, 3)
        ),
        Err(Ok(Error::ProjectNotFound))
    );
}

#[test]
fn approve_by_non_owner_fails() {
    let f = setup();

    f.client.create_project_ref(&project(), &f.owner);
    f.client
        .submit_milestone_proof(&project(), &milestone(), &f.builder, &proof(&f.env, 4));

    // The submitter is authenticated but is not the project owner.
    assert_eq!(
        f.client
            .try_approve_milestone(&project(), &milestone(), &f.builder),
        Err(Ok(Error::NotAuthorized))
    );
    assert_eq!(
        f.client
            .try_reject_milestone(&project(), &milestone(), &f.builder),
        Err(Ok(Error::NotAuthorized))
    );
    assert_eq!(
        f.client
            .get_milestone_status(&project(), &milestone())
            .status,
        MilestoneStatus::Submitted
    );
}

#[test]
fn approve_from_wrong_status_fails() {
    let f = setup();

    f.client.create_project_ref(&project(), &f.owner);
    f.client
        .submit_milestone_proof(&project(), &milestone(), &f.builder, &proof(&f.env, 5));
    f.client
        .approve_milestone(&project(), &milestone(), &f.owner);

    // Approved is terminal: no second approve, no reject, no re-submit.
    assert_eq!(
        f.client
            .try_approve_milestone(&project(), &milestone(), &f.owner),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(
        f.client
            .try_reject_milestone(&project(), &milestone(), &f.owner),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(
        f.client.try_submit_milestone_proof(
            &project(),
            &milestone(),
            &f.builder,
            &proof(&f.env, 6)
        ),
        Err(Ok(Error::InvalidStatus))
    );
}

#[test]
fn approve_before_submit_errors() {
    let f = setup();

    f.client.create_project_ref(&project(), &f.owner);

    assert_eq!(
        f.client
            .try_approve_milestone(&project(), &milestone(), &f.owner),
        Err(Ok(Error::MilestoneNotFound))
    );
}

#[test]
fn approve_on_unknown_project_errors() {
    let f = setup();

    assert_eq!(
        f.client
            .try_approve_milestone(&project(), &milestone(), &f.owner),
        Err(Ok(Error::ProjectNotFound))
    );
}

#[test]
fn get_missing_milestone_errors() {
    let f = setup();

    f.client.create_project_ref(&project(), &f.owner);

    assert_eq!(
        f.client.try_get_milestone_status(&project(), &milestone()),
        Err(Ok(Error::MilestoneNotFound))
    );
}

#[test]
fn milestones_and_projects_are_namespaced() {
    let f = setup();
    let other_project = symbol_short!("proj_2");
    let other_ms = symbol_short!("ms_2");

    f.client.create_project_ref(&project(), &f.owner);
    f.client.create_project_ref(&other_project, &f.builder);

    f.client
        .submit_milestone_proof(&project(), &milestone(), &f.builder, &proof(&f.env, 7));
    f.client
        .submit_milestone_proof(&other_project, &milestone(), &f.owner, &proof(&f.env, 8));

    f.client
        .approve_milestone(&project(), &milestone(), &f.owner);

    // Same milestone id under a different project is untouched.
    assert_eq!(
        f.client
            .get_milestone_status(&other_project, &milestone())
            .status,
        MilestoneStatus::Submitted
    );
    // Different milestone id under the same project does not exist.
    assert_eq!(
        f.client.try_get_milestone_status(&project(), &other_ms),
        Err(Ok(Error::MilestoneNotFound))
    );
    // The other project's owner is the builder, so the owner cannot approve it.
    assert_eq!(
        f.client
            .try_approve_milestone(&other_project, &milestone(), &f.owner),
        Err(Ok(Error::NotAuthorized))
    );
}
