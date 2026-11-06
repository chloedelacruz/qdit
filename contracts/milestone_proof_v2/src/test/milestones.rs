use super::*;
use crate::{Error, MilestoneStatus, ProofSubmitted};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Event as _,
};

/// A project with threshold 1, one submitter and one approver.
struct Team {
    f: Fixture,
    submitter: Address,
    approver: Address,
}

fn team() -> Team {
    let f = setup();
    f.client.create_project(&project_id(&f.env), &f.owner, &1);
    let submitter = add_member(&f, Role::Submitter);
    let approver = add_member(&f, Role::Approver);
    Team {
        f,
        submitter,
        approver,
    }
}

fn submit(t: &Team, byte: u8) {
    t.f.client.submit_milestone_proof(
        &project_id(&t.f.env),
        &milestone_id(&t.f.env),
        &t.submitter,
        &proof(&t.f.env, byte),
    );
}

#[test]
fn submit_records_every_field() {
    let t = team();

    submit(&t, 0xab);

    let record =
        t.f.client
            .get_milestone_status(&project_id(&t.f.env), &milestone_id(&t.f.env));
    assert_eq!(record.status, MilestoneStatus::Submitted);
    assert_eq!(record.version, 1);
    assert_eq!(record.proof_hash, proof(&t.f.env, 0xab));
    assert_eq!(record.submitter, t.submitter);
    assert_eq!(record.timestamp, NOW);
    assert_eq!(record.approvers.len(), 0);
}

#[test]
fn a_non_member_submit_is_refused_with_not_member() {
    let t = team();
    let stranger = Address::generate(&t.f.env);

    assert_eq!(
        t.f.client.try_submit_milestone_proof(
            &project_id(&t.f.env),
            &milestone_id(&t.f.env),
            &stranger,
            &proof(&t.f.env, 1),
        ),
        Err(Ok(Error::NotMember))
    );
    assert_eq!(
        t.f.client
            .try_get_milestone_status(&project_id(&t.f.env), &milestone_id(&t.f.env)),
        Err(Ok(Error::MilestoneNotFound))
    );
}

/// The project owner isn't a member just by owning the project.
#[test]
fn the_owner_cannot_submit_without_a_member_role() {
    let t = team();

    assert_eq!(
        t.f.client.try_submit_milestone_proof(
            &project_id(&t.f.env),
            &milestone_id(&t.f.env),
            &t.f.owner,
            &proof(&t.f.env, 1),
        ),
        Err(Ok(Error::NotMember))
    );
}

#[test]
fn an_approver_only_member_cannot_submit() {
    let t = team();

    assert_eq!(
        t.f.client.try_submit_milestone_proof(
            &project_id(&t.f.env),
            &milestone_id(&t.f.env),
            &t.approver,
            &proof(&t.f.env, 1),
        ),
        Err(Ok(Error::NotAuthorized))
    );
}

#[test]
fn a_removed_submitter_cannot_submit() {
    let t = team();
    t.f.client
        .remove_member(&project_id(&t.f.env), &t.f.owner, &t.submitter);

    assert_eq!(
        t.f.client.try_submit_milestone_proof(
            &project_id(&t.f.env),
            &milestone_id(&t.f.env),
            &t.submitter,
            &proof(&t.f.env, 1),
        ),
        Err(Ok(Error::NotMember))
    );
}

#[test]
fn submit_requires_the_submitters_auth() {
    let t = team();
    t.f.env.set_auths(&[]);

    assert!(matches!(
        t.f.client.try_submit_milestone_proof(
            &project_id(&t.f.env),
            &milestone_id(&t.f.env),
            &t.submitter,
            &proof(&t.f.env, 1),
        ),
        Err(Err(_))
    ));
    assert_eq!(
        t.f.client
            .try_get_milestone_status(&project_id(&t.f.env), &milestone_id(&t.f.env)),
        Err(Ok(Error::MilestoneNotFound))
    );
}

#[test]
fn submit_refuses_an_unknown_project() {
    let f = setup();
    let submitter = Address::generate(&f.env);

    assert_eq!(
        f.client.try_submit_milestone_proof(
            &project_id(&f.env),
            &milestone_id(&f.env),
            &submitter,
            &proof(&f.env, 1),
        ),
        Err(Ok(Error::ProjectNotFound))
    );
}

#[test]
fn milestone_calls_refuse_over_long_ids() {
    let t = team();
    let long = too_long_id(&t.f.env);
    let hash = proof(&t.f.env, 1);
    let project = project_id(&t.f.env);
    let milestone = milestone_id(&t.f.env);

    assert_eq!(
        t.f.client
            .try_submit_milestone_proof(&long, &milestone, &t.submitter, &hash),
        Err(Ok(Error::IdTooLong))
    );
    assert_eq!(
        t.f.client
            .try_submit_milestone_proof(&project, &long, &t.submitter, &hash),
        Err(Ok(Error::IdTooLong))
    );
    assert_eq!(
        t.f.client.try_get_milestone_status(&long, &milestone),
        Err(Ok(Error::IdTooLong))
    );
    assert_eq!(
        t.f.client.try_get_milestone_status(&project, &long),
        Err(Ok(Error::IdTooLong))
    );
}

#[test]
fn get_milestone_status_refuses_an_unknown_milestone() {
    let t = team();

    assert_eq!(
        t.f.client
            .try_get_milestone_status(&project_id(&t.f.env), &milestone_id(&t.f.env)),
        Err(Ok(Error::MilestoneNotFound))
    );
}

#[test]
fn resubmission_bumps_the_version_and_updates_hash_and_time() {
    let t = team();
    submit(&t, 1);

    t.f.env.ledger().set_timestamp(NOW + 60);
    submit(&t, 2);

    let record =
        t.f.client
            .get_milestone_status(&project_id(&t.f.env), &milestone_id(&t.f.env));
    assert_eq!(record.status, MilestoneStatus::Submitted);
    assert_eq!(record.version, 2);
    assert_eq!(record.proof_hash, proof(&t.f.env, 2));
    assert_eq!(record.timestamp, NOW + 60);
}

#[test]
fn milestones_are_namespaced_by_project() {
    let t = team();
    submit(&t, 1);

    let other = String::from_str(&t.f.env, "other-project");
    t.f.client.create_project(&other, &t.f.owner, &1);

    assert_eq!(
        t.f.client
            .try_get_milestone_status(&other, &milestone_id(&t.f.env)),
        Err(Ok(Error::MilestoneNotFound))
    );
    // The roster is per project too.
    assert_eq!(
        t.f.client.try_submit_milestone_proof(
            &other,
            &milestone_id(&t.f.env),
            &t.submitter,
            &proof(&t.f.env, 1),
        ),
        Err(Ok(Error::NotMember))
    );
}

#[test]
fn submit_emits_its_event() {
    let t = team();

    submit(&t, 7);

    assert_eq!(
        t.f.env.events().all(),
        [ProofSubmitted {
            project_id: project_id(&t.f.env),
            milestone_id: milestone_id(&t.f.env),
            submitter: t.submitter.clone(),
            proof_hash: proof(&t.f.env, 7),
            version: 1,
            timestamp: NOW,
        }
        .to_xdr(&t.f.env, &t.f.client.address)],
    );
}

#[test]
fn a_resubmission_emits_the_new_version_and_time() {
    let t = team();
    submit(&t, 7);

    t.f.env.ledger().set_timestamp(NOW + 60);
    submit(&t, 8);

    assert_eq!(
        t.f.env.events().all(),
        [ProofSubmitted {
            project_id: project_id(&t.f.env),
            milestone_id: milestone_id(&t.f.env),
            submitter: t.submitter.clone(),
            proof_hash: proof(&t.f.env, 8),
            version: 2,
            timestamp: NOW + 60,
        }
        .to_xdr(&t.f.env, &t.f.client.address)],
    );
}
