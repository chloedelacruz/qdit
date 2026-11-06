use super::*;
use crate::{
    Error, MilestoneApproved, MilestoneRecord, MilestoneRejected, MilestoneStatus,
    ThresholdChanged, MAX_MEMBERS,
};
use soroban_sdk::{
    testutils::{Address as _, Events},
    vec, Event as _,
};

/// A 2-of-3 project with one submitter.
struct Team {
    f: Fixture,
    submitter: Address,
    a: Address,
    b: Address,
    c: Address,
}

fn two_of_three() -> Team {
    let f = setup();
    f.client.create_project(&project_id(&f.env), &f.owner, &2);
    let submitter = add_member(&f, Role::Submitter);
    let a = add_member(&f, Role::Approver);
    let b = add_member(&f, Role::Approver);
    let c = add_member(&f, Role::Approver);
    Team {
        f,
        submitter,
        a,
        b,
        c,
    }
}

impl Team {
    fn submit(&self, byte: u8) {
        self.f.client.submit_milestone_proof(
            &project_id(&self.f.env),
            &milestone_id(&self.f.env),
            &self.submitter,
            &proof(&self.f.env, byte),
        );
    }

    fn approve(&self, approver: &Address) {
        self.f.client.approve_milestone(
            &project_id(&self.f.env),
            &milestone_id(&self.f.env),
            approver,
        );
    }

    fn try_approve(&self, approver: &Address) -> Option<Error> {
        self.f
            .client
            .try_approve_milestone(
                &project_id(&self.f.env),
                &milestone_id(&self.f.env),
                approver,
            )
            .err()
            .map(|e| e.expect("a contract error"))
    }

    fn try_reject(&self, approver: &Address) -> Option<Error> {
        self.f
            .client
            .try_reject_milestone(
                &project_id(&self.f.env),
                &milestone_id(&self.f.env),
                approver,
            )
            .err()
            .map(|e| e.expect("a contract error"))
    }

    fn remove(&self, member: &Address) {
        self.f
            .client
            .remove_member(&project_id(&self.f.env), &self.f.owner, member);
    }

    fn set_threshold(&self, threshold: u32) {
        self.f
            .client
            .set_threshold(&project_id(&self.f.env), &self.f.owner, &threshold);
    }

    fn record(&self) -> MilestoneRecord {
        self.f
            .client
            .get_milestone_status(&project_id(&self.f.env), &milestone_id(&self.f.env))
    }
}

#[test]
fn two_of_three_needs_the_second_approval() {
    let t = two_of_three();
    t.submit(1);

    t.approve(&t.a);
    assert_eq!(t.record().status, MilestoneStatus::Submitted);
    assert_eq!(t.record().approvers, vec![&t.f.env, t.a.clone()]);

    t.approve(&t.b);
    assert_eq!(t.record().status, MilestoneStatus::Approved);
    assert_eq!(
        t.record().approvers,
        vec![&t.f.env, t.a.clone(), t.b.clone()]
    );
}

#[test]
fn a_one_of_one_project_is_approved_at_once() {
    let f = setup();
    f.client.create_project(&project_id(&f.env), &f.owner, &1);
    let submitter = add_member(&f, Role::Submitter);
    let approver = add_member(&f, Role::Approver);
    f.client.submit_milestone_proof(
        &project_id(&f.env),
        &milestone_id(&f.env),
        &submitter,
        &proof(&f.env, 1),
    );

    f.client
        .approve_milestone(&project_id(&f.env), &milestone_id(&f.env), &approver);

    assert_eq!(
        f.client
            .get_milestone_status(&project_id(&f.env), &milestone_id(&f.env))
            .status,
        MilestoneStatus::Approved
    );
}

#[test]
fn a_duplicate_approval_is_refused() {
    let t = two_of_three();
    t.submit(1);
    t.approve(&t.a);

    assert_eq!(t.try_approve(&t.a), Some(Error::AlreadyApproved));
    assert_eq!(t.record().status, MilestoneStatus::Submitted);
    assert_eq!(t.record().approvers.len(), 1);
}

#[test]
fn a_removed_approver_cannot_approve() {
    let t = two_of_three();
    t.submit(1);
    t.remove(&t.a);

    assert_eq!(t.try_approve(&t.a), Some(Error::NotMember));
    assert_eq!(t.record().approvers.len(), 0);
}

#[test]
fn a_removed_approver_cannot_reject() {
    let t = two_of_three();
    t.submit(1);
    t.remove(&t.a);

    assert_eq!(t.try_reject(&t.a), Some(Error::NotMember));
    assert_eq!(t.record().status, MilestoneStatus::Submitted);
}

#[test]
fn non_approvers_cannot_decide() {
    let t = two_of_three();
    t.submit(1);
    let stranger = Address::generate(&t.f.env);

    assert_eq!(t.try_approve(&t.submitter), Some(Error::NotAuthorized));
    assert_eq!(t.try_reject(&t.submitter), Some(Error::NotAuthorized));
    assert_eq!(t.try_approve(&stranger), Some(Error::NotMember));
    assert_eq!(t.try_reject(&stranger), Some(Error::NotMember));
    // The project owner isn't an approver just by owning the project.
    assert_eq!(t.try_approve(&t.f.owner), Some(Error::NotMember));
    assert_eq!(t.try_reject(&t.f.owner), Some(Error::NotMember));
}

/// D-105: the approval stands after its approver leaves, and still counts.
#[test]
fn an_approval_from_a_since_removed_approver_still_counts() {
    let t = two_of_three();
    t.submit(1);
    t.approve(&t.a);
    t.remove(&t.a);

    t.approve(&t.b);

    assert_eq!(t.record().status, MilestoneStatus::Approved);
    assert_eq!(
        t.record().approvers,
        vec![&t.f.env, t.a.clone(), t.b.clone()]
    );
}

/// D-105: resubmitting is how a removed key's approval gets cancelled.
#[test]
fn resubmission_cancels_an_approval_from_a_removed_approver() {
    let t = two_of_three();
    t.submit(1);
    t.approve(&t.a);
    t.remove(&t.a);

    t.submit(2);
    t.approve(&t.b);

    assert_eq!(t.record().status, MilestoneStatus::Submitted);
    assert_eq!(t.record().approvers, vec![&t.f.env, t.b.clone()]);
}

#[test]
fn an_approver_removed_and_added_back_cannot_approve_twice() {
    let t = two_of_three();
    t.submit(1);
    t.approve(&t.a);
    t.remove(&t.a);
    t.f.client
        .add_member(&project_id(&t.f.env), &t.f.owner, &t.a, &Role::Approver);

    assert_eq!(t.try_approve(&t.a), Some(Error::AlreadyApproved));
}

#[test]
fn a_demoted_approver_cannot_approve() {
    let t = two_of_three();
    t.submit(1);
    t.f.client
        .add_member(&project_id(&t.f.env), &t.f.owner, &t.a, &Role::Submitter);

    assert_eq!(t.try_approve(&t.a), Some(Error::NotAuthorized));
}

#[test]
fn resubmission_empties_the_approvers_and_needs_the_full_threshold_again() {
    let t = two_of_three();
    t.submit(1);
    t.approve(&t.a);

    t.submit(2);
    assert_eq!(t.record().version, 2);
    assert_eq!(t.record().approvers.len(), 0);

    // The earlier approver may approve the new version, and it takes two again.
    t.approve(&t.a);
    assert_eq!(t.record().status, MilestoneStatus::Submitted);
    t.approve(&t.c);
    assert_eq!(t.record().status, MilestoneStatus::Approved);
}

#[test]
fn an_approved_milestone_cannot_be_resubmitted() {
    let t = two_of_three();
    t.submit(1);
    t.approve(&t.a);
    t.approve(&t.b);

    assert_eq!(
        t.f.client.try_submit_milestone_proof(
            &project_id(&t.f.env),
            &milestone_id(&t.f.env),
            &t.submitter,
            &proof(&t.f.env, 2),
        ),
        Err(Ok(Error::InvalidStatus))
    );
    assert_eq!(t.record().version, 1);
}

#[test]
fn any_one_approver_can_reject() {
    let t = two_of_three();
    t.submit(1);
    t.approve(&t.a);

    assert_eq!(t.try_reject(&t.c), None);

    assert_eq!(t.record().status, MilestoneStatus::Rejected);
    // The set stays readable until a resubmission clears it.
    assert_eq!(t.record().approvers, vec![&t.f.env, t.a.clone()]);
}

#[test]
fn a_rejected_milestone_can_be_resubmitted() {
    let t = two_of_three();
    t.submit(1);
    assert_eq!(t.try_reject(&t.a), None);

    t.submit(2);

    assert_eq!(t.record().status, MilestoneStatus::Submitted);
    assert_eq!(t.record().version, 2);
    assert_eq!(t.record().approvers.len(), 0);
}

#[test]
fn decisions_need_a_submitted_milestone() {
    let t = two_of_three();

    assert_eq!(t.try_approve(&t.a), Some(Error::MilestoneNotFound));
    assert_eq!(t.try_reject(&t.a), Some(Error::MilestoneNotFound));

    t.submit(1);
    assert_eq!(t.try_reject(&t.a), None);
    assert_eq!(t.try_approve(&t.b), Some(Error::InvalidStatus));
    assert_eq!(t.try_reject(&t.b), Some(Error::InvalidStatus));

    t.submit(2);
    t.approve(&t.a);
    t.approve(&t.b);
    assert_eq!(t.try_approve(&t.c), Some(Error::InvalidStatus));
    assert_eq!(t.try_reject(&t.c), Some(Error::InvalidStatus));
}

#[test]
fn approve_requires_the_approvers_auth() {
    let t = two_of_three();
    t.submit(1);
    t.f.env.set_auths(&[]);

    assert!(matches!(
        t.f.client
            .try_approve_milestone(&project_id(&t.f.env), &milestone_id(&t.f.env), &t.a),
        Err(Err(_))
    ));
    assert_eq!(t.record().approvers.len(), 0);
}

#[test]
fn reject_requires_the_approvers_auth() {
    let t = two_of_three();
    t.submit(1);
    t.f.env.set_auths(&[]);

    assert!(matches!(
        t.f.client
            .try_reject_milestone(&project_id(&t.f.env), &milestone_id(&t.f.env), &t.a),
        Err(Err(_))
    ));
    assert_eq!(t.record().status, MilestoneStatus::Submitted);
}

#[test]
fn decisions_refuse_an_unknown_project_and_over_long_ids() {
    let f = setup();
    let approver = Address::generate(&f.env);
    let project = project_id(&f.env);
    let milestone = milestone_id(&f.env);
    let long = too_long_id(&f.env);

    assert_eq!(
        f.client
            .try_approve_milestone(&project, &milestone, &approver),
        Err(Ok(Error::ProjectNotFound))
    );
    assert_eq!(
        f.client
            .try_reject_milestone(&project, &milestone, &approver),
        Err(Ok(Error::ProjectNotFound))
    );
    assert_eq!(
        f.client.try_approve_milestone(&long, &milestone, &approver),
        Err(Ok(Error::IdTooLong))
    );
    assert_eq!(
        f.client.try_approve_milestone(&project, &long, &approver),
        Err(Ok(Error::IdTooLong))
    );
    assert_eq!(
        f.client.try_reject_milestone(&long, &milestone, &approver),
        Err(Ok(Error::IdTooLong))
    );
    assert_eq!(
        f.client.try_reject_milestone(&project, &long, &approver),
        Err(Ok(Error::IdTooLong))
    );
}

#[test]
fn set_threshold_accepts_one_up_to_the_approver_count() {
    let t = two_of_three();

    t.set_threshold(1);
    assert_eq!(t.f.client.get_project(&project_id(&t.f.env)).threshold, 1);

    t.set_threshold(3);
    assert_eq!(t.f.client.get_project(&project_id(&t.f.env)).threshold, 3);
}

#[test]
fn set_threshold_refuses_zero_and_above_the_approver_count() {
    let t = two_of_three();
    let project = project_id(&t.f.env);

    assert_eq!(
        t.f.client.try_set_threshold(&project, &t.f.owner, &0),
        Err(Ok(Error::InvalidThreshold))
    );
    assert_eq!(
        t.f.client.try_set_threshold(&project, &t.f.owner, &4),
        Err(Ok(Error::InvalidThreshold))
    );
    assert_eq!(
        t.f.client
            .try_set_threshold(&project, &t.f.owner, &(MAX_MEMBERS + 1)),
        Err(Ok(Error::InvalidThreshold))
    );
    assert_eq!(t.f.client.get_project(&project).threshold, 2);
}

/// Submitters don't count towards the limit.
#[test]
fn set_threshold_counts_only_approvers() {
    let f = setup();
    f.client.create_project(&project_id(&f.env), &f.owner, &1);
    add_member(&f, Role::Submitter);
    add_member(&f, Role::Submitter);
    add_member(&f, Role::Approver);

    assert_eq!(
        f.client
            .try_set_threshold(&project_id(&f.env), &f.owner, &2),
        Err(Ok(Error::InvalidThreshold))
    );
}

#[test]
fn set_threshold_refuses_a_non_owner() {
    let t = two_of_three();

    assert_eq!(
        t.f.client
            .try_set_threshold(&project_id(&t.f.env), &t.a, &1),
        Err(Ok(Error::NotAuthorized))
    );
}

#[test]
fn set_threshold_requires_owner_auth() {
    let t = two_of_three();
    t.f.env.set_auths(&[]);

    assert!(matches!(
        t.f.client
            .try_set_threshold(&project_id(&t.f.env), &t.f.owner, &1),
        Err(Err(_))
    ));
    assert_eq!(t.f.client.get_project(&project_id(&t.f.env)).threshold, 2);
}

#[test]
fn set_threshold_refuses_an_unknown_project_and_an_over_long_id() {
    let f = setup();

    assert_eq!(
        f.client
            .try_set_threshold(&project_id(&f.env), &f.owner, &1),
        Err(Ok(Error::ProjectNotFound))
    );
    assert_eq!(
        f.client
            .try_set_threshold(&too_long_id(&f.env), &f.owner, &1),
        Err(Ok(Error::IdTooLong))
    );
}

#[test]
fn a_transfer_keeps_the_threshold_and_moves_the_right_to_set_it() {
    let t = two_of_three();
    let new_owner = Address::generate(&t.f.env);
    t.f.client
        .transfer_project_owner(&project_id(&t.f.env), &t.f.owner, &new_owner);

    assert_eq!(t.f.client.get_project(&project_id(&t.f.env)).threshold, 2);
    assert_eq!(
        t.f.client
            .try_set_threshold(&project_id(&t.f.env), &t.f.owner, &1),
        Err(Ok(Error::NotAuthorized))
    );
    t.f.client
        .set_threshold(&project_id(&t.f.env), &new_owner, &1);
    assert_eq!(t.f.client.get_project(&project_id(&t.f.env)).threshold, 1);
}

/// Lowering changes no milestone by itself. The next approval finalises it.
#[test]
fn a_lowered_threshold_takes_effect_on_the_next_approval() {
    let t = two_of_three();
    t.set_threshold(3);
    t.submit(1);
    t.approve(&t.a);
    t.approve(&t.b);

    t.set_threshold(2);
    assert_eq!(t.record().status, MilestoneStatus::Submitted);

    t.approve(&t.c);
    assert_eq!(t.record().status, MilestoneStatus::Approved);
}

/// If only approvers who already approved remain, nobody can finalise it, and a
/// resubmission clears it.
#[test]
fn a_lowered_threshold_with_no_approver_left_is_cleared_by_resubmission() {
    let t = two_of_three();
    t.set_threshold(3);
    t.submit(1);
    t.approve(&t.a);
    t.approve(&t.b);
    t.set_threshold(2);
    t.remove(&t.c);

    assert_eq!(t.try_approve(&t.a), Some(Error::AlreadyApproved));
    assert_eq!(t.try_approve(&t.b), Some(Error::AlreadyApproved));
    assert_eq!(t.record().status, MilestoneStatus::Submitted);

    t.submit(2);
    t.approve(&t.a);
    t.approve(&t.b);
    assert_eq!(t.record().status, MilestoneStatus::Approved);
}

#[test]
fn a_raised_threshold_applies_to_a_milestone_in_progress() {
    let t = two_of_three();
    t.submit(1);
    t.approve(&t.a);
    t.set_threshold(3);

    t.approve(&t.b);
    assert_eq!(t.record().status, MilestoneStatus::Submitted);

    t.approve(&t.c);
    assert_eq!(t.record().status, MilestoneStatus::Approved);
}

#[test]
fn set_threshold_emits_its_event() {
    let t = two_of_three();

    t.set_threshold(3);

    assert_eq!(
        t.f.env.events().all(),
        [ThresholdChanged {
            project_id: project_id(&t.f.env),
            threshold: 3,
        }
        .to_xdr(&t.f.env, &t.f.client.address)],
    );
}

#[test]
fn each_approval_emits_its_event_with_the_resulting_status() {
    let t = two_of_three();
    let env = &t.f.env;
    let contract = &t.f.client.address;
    t.submit(1);

    t.approve(&t.a);
    assert_eq!(
        env.events().all(),
        [MilestoneApproved {
            project_id: project_id(env),
            milestone_id: milestone_id(env),
            approver: t.a.clone(),
            version: 1,
            status: MilestoneStatus::Submitted,
        }
        .to_xdr(env, contract)],
    );

    t.approve(&t.b);
    assert_eq!(
        env.events().all(),
        [MilestoneApproved {
            project_id: project_id(env),
            milestone_id: milestone_id(env),
            approver: t.b.clone(),
            version: 1,
            status: MilestoneStatus::Approved,
        }
        .to_xdr(env, contract)],
    );
}

#[test]
fn reject_emits_its_event() {
    let t = two_of_three();
    t.submit(1);

    assert_eq!(t.try_reject(&t.a), None);

    assert_eq!(
        t.f.env.events().all(),
        [MilestoneRejected {
            project_id: project_id(&t.f.env),
            milestone_id: milestone_id(&t.f.env),
            approver: t.a.clone(),
            version: 1,
        }
        .to_xdr(&t.f.env, &t.f.client.address)],
    );
}

#[test]
fn refused_decisions_and_threshold_changes_emit_nothing() {
    let t = two_of_three();
    t.submit(1);
    t.approve(&t.a);

    assert_eq!(t.try_approve(&t.a), Some(Error::AlreadyApproved));
    assert!(t.f.env.events().all().events().is_empty());

    assert_eq!(t.try_reject(&t.submitter), Some(Error::NotAuthorized));
    assert!(t.f.env.events().all().events().is_empty());

    let _ =
        t.f.client
            .try_set_threshold(&project_id(&t.f.env), &t.f.owner, &0);
    assert!(t.f.env.events().all().events().is_empty());
}
