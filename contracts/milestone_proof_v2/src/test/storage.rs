//! TTL: every write keeps its own entry, the project's shared entries and the
//! contract instance alive.

use super::*;
use crate::{DataKey, Role, DAY_IN_LEDGERS, TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};

/// The network's ceiling on an entry's TTL (`max_entry_ttl`), about 180 days.
/// Every test runs under it, so an extension past it would fail the test.
const NETWORK_MAX_ENTRY_TTL: u32 = 3_110_400;

fn with_network_limits() -> Fixture {
    let f = setup();
    f.env
        .ledger()
        .with_mut(|l| l.max_entry_ttl = NETWORK_MAX_ENTRY_TTL);
    f
}

fn age(f: &Fixture, ledgers: u32) {
    f.env.ledger().with_mut(|l| l.sequence_number += ledgers);
}

fn ttl(f: &Fixture, key: &DataKey) -> u32 {
    f.env.as_contract(&f.client.address, || {
        f.env.storage().persistent().get_ttl(key)
    })
}

fn instance_ttl(f: &Fixture) -> u32 {
    f.env
        .as_contract(&f.client.address, || f.env.storage().instance().get_ttl())
}

fn project_key(f: &Fixture) -> DataKey {
    DataKey::Project(project_id(&f.env))
}

fn members_key(f: &Fixture) -> DataKey {
    DataKey::Members(project_id(&f.env))
}

fn milestone_key(f: &Fixture) -> DataKey {
    DataKey::Milestone(project_id(&f.env), milestone_id(&f.env))
}

/// The project record, its roster and the instance all at the full TTL.
fn assert_project_fresh(f: &Fixture) {
    assert_eq!(ttl(f, &project_key(f)), TTL_EXTEND_TO);
    assert_eq!(ttl(f, &members_key(f)), TTL_EXTEND_TO);
    assert_eq!(instance_ttl(f), TTL_EXTEND_TO);
}

/// Two days on, so every entry has dropped below the threshold.
fn age_past_threshold(f: &Fixture) {
    age(f, 2 * DAY_IN_LEDGERS);
    assert!(ttl(f, &project_key(f)) < TTL_THRESHOLD);
    assert!(instance_ttl(f) < TTL_THRESHOLD);
}

#[test]
fn create_project_extends_the_project_and_the_instance() {
    let f = with_network_limits();

    f.client.create_project(&project_id(&f.env), &f.owner, &1);

    assert_eq!(ttl(&f, &project_key(&f)), TTL_EXTEND_TO);
    assert_eq!(instance_ttl(&f), TTL_EXTEND_TO);
}

#[test]
fn every_roster_and_owner_write_extends_the_project_after_the_ledger_advances() {
    let f = with_network_limits();
    let project = project_id(&f.env);
    f.client.create_project(&project, &f.owner, &1);

    age(&f, 2 * DAY_IN_LEDGERS);
    add_member(&f, Role::Approver);
    assert_project_fresh(&f);

    age_past_threshold(&f);
    let submitter = add_member(&f, Role::Submitter);
    assert_project_fresh(&f);

    age_past_threshold(&f);
    f.client.remove_member(&project, &f.owner, &submitter);
    assert_project_fresh(&f);

    age_past_threshold(&f);
    let second = add_member(&f, Role::Approver);
    f.client.set_threshold(&project, &f.owner, &2);
    assert_project_fresh(&f);

    age_past_threshold(&f);
    f.client.transfer_project_owner(&project, &f.owner, &second);
    assert_project_fresh(&f);
}

#[test]
fn every_milestone_write_extends_the_milestone_and_the_project() {
    let f = with_network_limits();
    let project = project_id(&f.env);
    let milestone = milestone_id(&f.env);
    f.client.create_project(&project, &f.owner, &2);
    let submitter = add_member(&f, Role::Submitter);
    let first = add_member(&f, Role::Approver);
    let second = add_member(&f, Role::Approver);

    age_past_threshold(&f);
    f.client
        .submit_milestone_proof(&project, &milestone, &submitter, &proof(&f.env, 1));
    assert_eq!(ttl(&f, &milestone_key(&f)), TTL_EXTEND_TO);
    assert_project_fresh(&f);

    age_past_threshold(&f);
    assert!(ttl(&f, &milestone_key(&f)) < TTL_THRESHOLD);
    f.client
        .reject_milestone(&project, &milestone, &first, &proof(&f.env, 1));
    assert_eq!(ttl(&f, &milestone_key(&f)), TTL_EXTEND_TO);
    assert_project_fresh(&f);

    age_past_threshold(&f);
    f.client
        .submit_milestone_proof(&project, &milestone, &submitter, &proof(&f.env, 2));
    age_past_threshold(&f);
    f.client
        .approve_milestone(&project, &milestone, &first, &proof(&f.env, 2));
    assert_eq!(ttl(&f, &milestone_key(&f)), TTL_EXTEND_TO);
    assert_project_fresh(&f);

    age_past_threshold(&f);
    f.client
        .approve_milestone(&project, &milestone, &second, &proof(&f.env, 2));
    assert_eq!(ttl(&f, &milestone_key(&f)), TTL_EXTEND_TO);
    assert_project_fresh(&f);
}

#[test]
fn anchor_batch_extends_the_batch_and_the_project() {
    let f = with_network_limits();
    let project = project_id(&f.env);
    let batch = String::from_str(&f.env, "batch-1");
    f.client.create_project(&project, &f.owner, &1);
    let submitter = add_member(&f, Role::Submitter);

    age_past_threshold(&f);
    f.client
        .anchor_batch(&project, &batch, &submitter, &proof(&f.env, 9), &4);

    assert_eq!(
        ttl(&f, &DataKey::Batch(project.clone(), batch.clone())),
        TTL_EXTEND_TO
    );
    assert_project_fresh(&f);
}

#[test]
fn a_write_within_a_day_leaves_the_ttl_alone() {
    let f = with_network_limits();
    let project = project_id(&f.env);
    f.client.create_project(&project, &f.owner, &1);

    let elapsed = DAY_IN_LEDGERS / 2;
    age(&f, elapsed);
    add_member(&f, Role::Submitter);

    // Above the threshold, so the project and instance keep their old expiry.
    assert_eq!(ttl(&f, &project_key(&f)), TTL_EXTEND_TO - elapsed);
    assert_eq!(instance_ttl(&f), TTL_EXTEND_TO - elapsed);
    // The roster is new, so it starts at the full TTL.
    assert_eq!(ttl(&f, &members_key(&f)), TTL_EXTEND_TO);
}

/// Writes that never touch the project record still keep it alive, well past
/// the TTL a single write grants.
#[test]
fn a_project_in_use_outlives_its_ttl() {
    let f = with_network_limits();
    let project = project_id(&f.env);
    f.client.create_project(&project, &f.owner, &1);
    let submitter = add_member(&f, Role::Submitter);

    for (round, milestone) in ["m0", "m1", "m2", "m3", "m4", "m5"].iter().enumerate() {
        age(&f, 100 * DAY_IN_LEDGERS);
        f.client.submit_milestone_proof(
            &project,
            &String::from_str(&f.env, milestone),
            &submitter,
            &proof(&f.env, round as u8),
        );
    }

    // 600 days on, five times the TTL, and the project still reads.
    assert_eq!(f.client.get_project(&project).owner, f.owner);
    assert_eq!(f.client.get_members(&project).len(), 1);
    assert_project_fresh(&f);
}
