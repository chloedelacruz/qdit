#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    Env, Event as _, IntoVal,
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

/// Real UUIDs, because that is what the app passes. A 36-character id is the
/// reason these are `String` and not `Symbol`.
fn project(env: &Env) -> String {
    String::from_str(env, "8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2")
}

fn milestone(env: &Env) -> String {
    String::from_str(env, "c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7")
}

fn proof(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

#[test]
fn create_submit_approve_happy_path() {
    let f = setup();
    let hash = proof(&f.env, 0xab);

    f.client.create_project_ref(&project(&f.env), &f.owner);
    f.client
        .submit_milestone_proof(&project(&f.env), &milestone(&f.env), &f.builder, &hash);

    let submitted = f
        .client
        .get_milestone_status(&project(&f.env), &milestone(&f.env));
    assert_eq!(submitted.status, MilestoneStatus::Submitted);
    assert_eq!(submitted.project_id, project(&f.env));
    assert_eq!(submitted.milestone_id, milestone(&f.env));
    assert_eq!(submitted.submitter, f.builder);
    assert_eq!(submitted.proof_hash, hash);
    assert_eq!(submitted.version, 1);
    assert_eq!(submitted.timestamp, 1_700_000_000);

    f.client
        .approve_milestone(&project(&f.env), &milestone(&f.env), &f.owner);

    let approved = f
        .client
        .get_milestone_status(&project(&f.env), &milestone(&f.env));
    assert_eq!(approved.status, MilestoneStatus::Approved);
    // Approval attests to a submission; it does not make one.
    assert_eq!(approved.version, 1);
    assert_eq!(approved.timestamp, 1_700_000_000);
    assert_eq!(approved.proof_hash, hash);
}

#[test]
fn reject_path() {
    let f = setup();

    f.client.create_project_ref(&project(&f.env), &f.owner);
    f.client.submit_milestone_proof(
        &project(&f.env),
        &milestone(&f.env),
        &f.builder,
        &proof(&f.env, 1),
    );
    f.client
        .reject_milestone(&project(&f.env), &milestone(&f.env), &f.owner);

    let record = f
        .client
        .get_milestone_status(&project(&f.env), &milestone(&f.env));
    assert_eq!(record.status, MilestoneStatus::Rejected);
    assert_eq!(record.version, 1);
}

#[test]
fn resubmission_increments_version() {
    let f = setup();

    f.client.create_project_ref(&project(&f.env), &f.owner);
    f.client.submit_milestone_proof(
        &project(&f.env),
        &milestone(&f.env),
        &f.builder,
        &proof(&f.env, 1),
    );
    f.client
        .reject_milestone(&project(&f.env), &milestone(&f.env), &f.owner);

    f.env.ledger().set_timestamp(1_700_009_999);
    let second = proof(&f.env, 2);
    f.client
        .submit_milestone_proof(&project(&f.env), &milestone(&f.env), &f.builder, &second);

    let record = f
        .client
        .get_milestone_status(&project(&f.env), &milestone(&f.env));
    assert_eq!(record.status, MilestoneStatus::Submitted);
    assert_eq!(record.proof_hash, second);
    assert_eq!(record.timestamp, 1_700_009_999);
    // The overwritten first hash is gone, but the ledger shows it existed.
    assert_eq!(record.version, 2);

    // Re-submitting an already-Submitted milestone is legal and counts too.
    f.client.submit_milestone_proof(
        &project(&f.env),
        &milestone(&f.env),
        &f.builder,
        &proof(&f.env, 3),
    );
    assert_eq!(
        f.client
            .get_milestone_status(&project(&f.env), &milestone(&f.env))
            .version,
        3,
    );
}

#[test]
fn duplicate_project_errors() {
    let f = setup();

    f.client.create_project_ref(&project(&f.env), &f.owner);

    assert_eq!(
        f.client.try_create_project_ref(&project(&f.env), &f.owner),
        Err(Ok(Error::ProjectExists))
    );
    // Also rejected when a different address tries to claim the same id.
    assert_eq!(
        f.client
            .try_create_project_ref(&project(&f.env), &f.builder),
        Err(Ok(Error::ProjectExists))
    );
}

#[test]
fn create_project_requires_owner_auth() {
    let f = setup();

    f.client.create_project_ref(&project(&f.env), &f.owner);

    // mock_all_auths records the auth the contract demanded.
    let auths = f.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, f.owner);
}

/// The one test that must not mock auth.
///
/// Every other test calls `mock_all_auths()`, which would happily satisfy a
/// contract that had stopped calling `require_auth()` at all. This is what
/// turns deleting that call into a red test.
#[test]
fn auth_is_actually_required() {
    let env = Env::default();
    env.ledger().set_timestamp(1_700_000_000);

    let contract_id = env.register(MilestoneProofContract, ());
    let client = MilestoneProofContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    // No mock_all_auths: the host has no authorization to satisfy owner.
    assert!(client
        .try_create_project_ref(&project(&env), &owner)
        .is_err());

    // And nothing was written.
    env.mock_all_auths();
    assert_eq!(
        client.try_get_milestone_status(&project(&env), &milestone(&env)),
        Err(Ok(Error::MilestoneNotFound))
    );
}

/// Pins the exact event each write emits.
///
/// An off-chain indexer binds to the topic order and the data field names, so
/// both are a public contract a refactor must not quietly change. Comparing the
/// whole emitted list — rather than fishing out the last entry — also catches an
/// event published twice.
///
/// **Assert after each call, not once at the end.** `env.events().all()` is
/// scoped to the most recent invocation, so collecting at the end silently
/// checks only the final write.
#[test]
fn every_write_emits_its_event() {
    let f = setup();
    let env = &f.env;
    let contract = &f.client.address;

    let first = proof(env, 9);
    let second = proof(env, 10);

    f.client.create_project_ref(&project(env), &f.owner);
    assert_eq!(
        env.events().all(),
        [ProjectRegistered {
            project_id: project(env),
            owner: f.owner.clone(),
        }
        .to_xdr(env, contract)],
    );

    f.client
        .submit_milestone_proof(&project(env), &milestone(env), &f.builder, &first);
    assert_eq!(
        env.events().all(),
        [ProofSubmitted {
            project_id: project(env),
            milestone_id: milestone(env),
            submitter: f.builder.clone(),
            proof_hash: first,
            version: 1,
        }
        .to_xdr(env, contract)],
    );

    f.client
        .reject_milestone(&project(env), &milestone(env), &f.owner);
    assert_eq!(
        env.events().all(),
        [MilestoneRejected {
            project_id: project(env),
            milestone_id: milestone(env),
            approver: f.owner.clone(),
            version: 1,
        }
        .to_xdr(env, contract)],
    );

    // A re-submission names its own version, so the stream orders the hashes.
    f.client
        .submit_milestone_proof(&project(env), &milestone(env), &f.builder, &second);
    assert_eq!(
        env.events().all(),
        [ProofSubmitted {
            project_id: project(env),
            milestone_id: milestone(env),
            submitter: f.builder.clone(),
            proof_hash: second,
            version: 2,
        }
        .to_xdr(env, contract)],
    );

    f.client
        .approve_milestone(&project(env), &milestone(env), &f.owner);
    assert_eq!(
        env.events().all(),
        [MilestoneApproved {
            project_id: project(env),
            milestone_id: milestone(env),
            approver: f.owner.clone(),
            version: 2,
        }
        .to_xdr(env, contract)],
    );
}

/// A call that fails must not leave an event behind claiming it happened.
#[test]
fn failed_writes_emit_nothing() {
    let f = setup();
    let env = &f.env;

    // Unknown project.
    let _ = f.client.try_submit_milestone_proof(
        &project(env),
        &milestone(env),
        &f.builder,
        &proof(env, 1),
    );
    assert!(env.events().all().events().is_empty());

    // Duplicate registration.
    f.client.create_project_ref(&project(env), &f.owner);
    let _ = f.client.try_create_project_ref(&project(env), &f.owner);
    assert!(env.events().all().events().is_empty());

    // Approve by someone who is not the owner.
    f.client
        .submit_milestone_proof(&project(env), &milestone(env), &f.builder, &proof(env, 2));
    let _ = f
        .client
        .try_approve_milestone(&project(env), &milestone(env), &f.builder);
    assert!(env.events().all().events().is_empty());
}

/// Mirrors the app's real write sequence, including the failure it relies on.
///
/// The client cannot know whether a project is already registered without a
/// round trip, so it registers unconditionally and treats `ProjectExists` as
/// success. If that error ever became an upsert, this test is what notices.
#[test]
fn ui_write_path() {
    let f = setup();

    // First anchor of a project: register succeeds.
    f.client.create_project_ref(&project(&f.env), &f.owner);

    // Second anchor, later: register is attempted again and is expected to fail.
    assert_eq!(
        f.client.try_create_project_ref(&project(&f.env), &f.owner),
        Err(Ok(Error::ProjectExists))
    );

    // The client carries on regardless.
    f.client.submit_milestone_proof(
        &project(&f.env),
        &milestone(&f.env),
        &f.builder,
        &proof(&f.env, 0x5a),
    );
    f.client
        .approve_milestone(&project(&f.env), &milestone(&f.env), &f.owner);

    let record = f
        .client
        .get_milestone_status(&project(&f.env), &milestone(&f.env));
    assert_eq!(record.status, MilestoneStatus::Approved);
    assert_eq!(record.proof_hash, proof(&f.env, 0x5a));
    assert_eq!(record.version, 1);
}

#[test]
fn over_long_ids_are_rejected() {
    let f = setup();
    // 65 characters — one past MAX_ID_LEN. Written out because the crate is
    // no_std, so `str::repeat` is not available here.
    const LONG: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const AT_LIMIT: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    assert_eq!(LONG.len(), 65);
    assert_eq!(AT_LIMIT.len(), 64);

    let long = String::from_str(&f.env, LONG);

    assert_eq!(
        f.client.try_create_project_ref(&long, &f.owner),
        Err(Ok(Error::IdTooLong))
    );

    f.client.create_project_ref(&project(&f.env), &f.owner);
    assert_eq!(
        f.client.try_submit_milestone_proof(
            &project(&f.env),
            &long,
            &f.builder,
            &proof(&f.env, 11)
        ),
        Err(Ok(Error::IdTooLong))
    );

    // Exactly at the limit is fine.
    let at_limit = String::from_str(&f.env, AT_LIMIT);
    f.client
        .submit_milestone_proof(&project(&f.env), &at_limit, &f.builder, &proof(&f.env, 12));
    assert_eq!(
        f.client
            .get_milestone_status(&project(&f.env), &at_limit)
            .status,
        MilestoneStatus::Submitted
    );
}

#[test]
fn submit_to_unknown_project_errors() {
    let f = setup();

    assert_eq!(
        f.client.try_submit_milestone_proof(
            &project(&f.env),
            &milestone(&f.env),
            &f.builder,
            &proof(&f.env, 3)
        ),
        Err(Ok(Error::ProjectNotFound))
    );
}

#[test]
fn approve_by_non_owner_fails() {
    let f = setup();

    f.client.create_project_ref(&project(&f.env), &f.owner);
    f.client.submit_milestone_proof(
        &project(&f.env),
        &milestone(&f.env),
        &f.builder,
        &proof(&f.env, 4),
    );

    // The submitter is authenticated but is not the project owner.
    assert_eq!(
        f.client
            .try_approve_milestone(&project(&f.env), &milestone(&f.env), &f.builder),
        Err(Ok(Error::NotAuthorized))
    );
    assert_eq!(
        f.client
            .try_reject_milestone(&project(&f.env), &milestone(&f.env), &f.builder),
        Err(Ok(Error::NotAuthorized))
    );
    assert_eq!(
        f.client
            .get_milestone_status(&project(&f.env), &milestone(&f.env))
            .status,
        MilestoneStatus::Submitted
    );
}

#[test]
fn approve_from_wrong_status_fails() {
    let f = setup();

    f.client.create_project_ref(&project(&f.env), &f.owner);
    f.client.submit_milestone_proof(
        &project(&f.env),
        &milestone(&f.env),
        &f.builder,
        &proof(&f.env, 5),
    );
    f.client
        .approve_milestone(&project(&f.env), &milestone(&f.env), &f.owner);

    // Approved is terminal: no second approve, no reject, no re-submit.
    assert_eq!(
        f.client
            .try_approve_milestone(&project(&f.env), &milestone(&f.env), &f.owner),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(
        f.client
            .try_reject_milestone(&project(&f.env), &milestone(&f.env), &f.owner),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(
        f.client.try_submit_milestone_proof(
            &project(&f.env),
            &milestone(&f.env),
            &f.builder,
            &proof(&f.env, 6)
        ),
        Err(Ok(Error::InvalidStatus))
    );
}

#[test]
fn approve_before_submit_errors() {
    let f = setup();

    f.client.create_project_ref(&project(&f.env), &f.owner);

    assert_eq!(
        f.client
            .try_approve_milestone(&project(&f.env), &milestone(&f.env), &f.owner),
        Err(Ok(Error::MilestoneNotFound))
    );
}

#[test]
fn approve_on_unknown_project_errors() {
    let f = setup();

    assert_eq!(
        f.client
            .try_approve_milestone(&project(&f.env), &milestone(&f.env), &f.owner),
        Err(Ok(Error::ProjectNotFound))
    );
}

#[test]
fn get_missing_milestone_errors() {
    let f = setup();

    f.client.create_project_ref(&project(&f.env), &f.owner);

    assert_eq!(
        f.client
            .try_get_milestone_status(&project(&f.env), &milestone(&f.env)),
        Err(Ok(Error::MilestoneNotFound))
    );
}

#[test]
fn milestones_and_projects_are_namespaced() {
    let f = setup();
    let other_project = String::from_str(&f.env, "45c48cce-2e2d-4fbd-aa1f-3ad6ba43e42d");
    let other_ms = String::from_str(&f.env, "d3d94468-02a4-4d1c-b3d4-c2b6f0b6d9a1");

    f.client.create_project_ref(&project(&f.env), &f.owner);
    f.client.create_project_ref(&other_project, &f.builder);

    f.client.submit_milestone_proof(
        &project(&f.env),
        &milestone(&f.env),
        &f.builder,
        &proof(&f.env, 7),
    );
    f.client.submit_milestone_proof(
        &other_project,
        &milestone(&f.env),
        &f.owner,
        &proof(&f.env, 8),
    );

    f.client
        .approve_milestone(&project(&f.env), &milestone(&f.env), &f.owner);

    // Same milestone id under a different project is untouched.
    assert_eq!(
        f.client
            .get_milestone_status(&other_project, &milestone(&f.env))
            .status,
        MilestoneStatus::Submitted
    );
    // Different milestone id under the same project does not exist.
    assert_eq!(
        f.client
            .try_get_milestone_status(&project(&f.env), &other_ms),
        Err(Ok(Error::MilestoneNotFound))
    );
    // The other project's owner is the builder, so the owner cannot approve it.
    assert_eq!(
        f.client
            .try_approve_milestone(&other_project, &milestone(&f.env), &f.owner),
        Err(Ok(Error::NotAuthorized))
    );
}

// ---------------------------------------------------------------------------
// Ownership transfer
// ---------------------------------------------------------------------------

#[test]
fn transfer_moves_approval_rights_to_the_new_owner() {
    let f = setup();
    let successor = Address::generate(&f.env);

    f.client.create_project_ref(&project(&f.env), &f.owner);
    f.client.submit_milestone_proof(
        &project(&f.env),
        &milestone(&f.env),
        &f.builder,
        &proof(&f.env, 3),
    );

    f.client
        .transfer_project_owner(&project(&f.env), &f.owner, &successor);

    // The successor can approve...
    f.client
        .approve_milestone(&project(&f.env), &milestone(&f.env), &successor);
    assert_eq!(
        f.client
            .get_milestone_status(&project(&f.env), &milestone(&f.env))
            .status,
        MilestoneStatus::Approved
    );
}

#[test]
fn transfer_strips_approval_rights_from_the_old_owner() {
    let f = setup();
    let successor = Address::generate(&f.env);
    let second_ms = String::from_str(&f.env, "d3d94468-02a4-4d1c-b3d4-c2b6f0b6d9a1");

    f.client.create_project_ref(&project(&f.env), &f.owner);
    f.client
        .transfer_project_owner(&project(&f.env), &f.owner, &successor);
    f.client
        .submit_milestone_proof(&project(&f.env), &second_ms, &f.builder, &proof(&f.env, 4));

    // ...and the previous owner cannot. Handing a project over has to actually
    // hand it over, or the transfer is decoration.
    assert_eq!(
        f.client
            .try_approve_milestone(&project(&f.env), &second_ms, &f.owner),
        Err(Ok(Error::NotAuthorized))
    );
}

#[test]
fn transfer_preserves_the_milestone_record() {
    let f = setup();
    let successor = Address::generate(&f.env);
    let hash = proof(&f.env, 0x5c);

    f.client.create_project_ref(&project(&f.env), &f.owner);
    f.client
        .submit_milestone_proof(&project(&f.env), &milestone(&f.env), &f.builder, &hash);
    f.client
        .transfer_project_owner(&project(&f.env), &f.owner, &successor);

    // Ownership is a property of the project, not of the attestations under it.
    // `submitter` is a historical fact and the version counter must not reset,
    // or a transfer would launder the proof trail.
    let record = f
        .client
        .get_milestone_status(&project(&f.env), &milestone(&f.env));
    assert_eq!(record.submitter, f.builder);
    assert_eq!(record.proof_hash, hash);
    assert_eq!(record.version, 1);
    assert_eq!(record.status, MilestoneStatus::Submitted);
}

#[test]
fn transfer_by_non_owner_fails() {
    let f = setup();
    let successor = Address::generate(&f.env);

    f.client.create_project_ref(&project(&f.env), &f.owner);

    // The builder is authenticated — mock_all_auths satisfies require_auth — but
    // is not the address in storage.
    assert_eq!(
        f.client
            .try_transfer_project_owner(&project(&f.env), &f.builder, &successor),
        Err(Ok(Error::NotAuthorized))
    );
}

#[test]
fn transfer_on_unknown_project_errors() {
    let f = setup();
    let successor = Address::generate(&f.env);

    assert_eq!(
        f.client
            .try_transfer_project_owner(&project(&f.env), &f.owner, &successor),
        Err(Ok(Error::ProjectNotFound))
    );
}

#[test]
fn transfer_rejects_an_over_long_id() {
    let f = setup();
    let successor = Address::generate(&f.env);
    // 65 characters — one past MAX_ID_LEN, spelled out because the crate is
    // no_std and `str::repeat` is unavailable.
    let long = String::from_str(
        &f.env,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    assert_eq!(
        f.client
            .try_transfer_project_owner(&long, &f.owner, &successor),
        Err(Ok(Error::IdTooLong))
    );
}

/// The whole point of requiring two signatures.
///
/// Only `current_owner` is authorized here, so the call must fail. Without
/// `new_owner.require_auth()` this passes — and the function becomes able to
/// pin a project to an address nobody controls, which is the exact failure it
/// exists to undo, with no admin path to recover from it.
#[test]
fn transfer_requires_the_new_owner_to_sign_too() {
    let env = Env::default();
    env.ledger().set_timestamp(1_700_000_000);

    let contract_id = env.register(MilestoneProofContract, ());
    let client = MilestoneProofContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let successor = Address::generate(&env);

    env.mock_all_auths();
    client.create_project_ref(&project(&env), &owner);

    // Re-mock with only the current owner authorized.
    env.set_auths(&[]);
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "transfer_project_owner",
            args: (project(&env), owner.clone(), successor.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    assert!(client
        .try_transfer_project_owner(&project(&env), &owner, &successor)
        .is_err());

    // And the owner in storage is unchanged: the old owner can still approve.
    env.mock_all_auths();
    client.submit_milestone_proof(&project(&env), &milestone(&env), &owner, &proof(&env, 1));
    client.approve_milestone(&project(&env), &milestone(&env), &owner);
}

#[test]
fn transfer_emits_its_event() {
    let f = setup();
    let env = &f.env;
    let successor = Address::generate(env);

    f.client.create_project_ref(&project(env), &f.owner);
    f.client
        .transfer_project_owner(&project(env), &f.owner, &successor);

    assert_eq!(
        env.events().all(),
        [ProjectOwnerTransferred {
            project_id: project(env),
            previous_owner: f.owner.clone(),
            new_owner: successor.clone(),
        }
        .to_xdr(env, &f.client.address)],
    );
}

#[test]
fn a_failed_transfer_emits_nothing() {
    let f = setup();
    let env = &f.env;
    let successor = Address::generate(env);

    f.client.create_project_ref(&project(env), &f.owner);
    let _ = f
        .client
        .try_transfer_project_owner(&project(env), &f.builder, &successor);

    assert!(env.events().all().events().is_empty());
}
