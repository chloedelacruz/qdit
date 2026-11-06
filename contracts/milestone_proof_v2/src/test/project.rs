use super::*;
use crate::{Error, Project, ProjectCreated, MAX_MEMBERS};
use soroban_sdk::{testutils::Events, Event as _};

#[test]
fn create_project_stores_owner_and_threshold() {
    let f = setup();

    f.client.create_project(&project_id(&f.env), &f.owner, &2);

    assert_eq!(
        f.client.get_project(&project_id(&f.env)),
        Project {
            owner: f.owner.clone(),
            threshold: 2,
        }
    );
}

#[test]
fn create_project_refuses_a_duplicate_id() {
    let f = setup();
    f.client.create_project(&project_id(&f.env), &f.owner, &2);

    assert_eq!(
        f.client
            .try_create_project(&project_id(&f.env), &f.owner, &1),
        Err(Ok(Error::ProjectExists))
    );
    // The first registration stands.
    assert_eq!(f.client.get_project(&project_id(&f.env)).threshold, 2);
}

#[test]
fn create_project_refuses_a_zero_threshold() {
    let f = setup();

    assert_eq!(
        f.client
            .try_create_project(&project_id(&f.env), &f.owner, &0),
        Err(Ok(Error::InvalidThreshold))
    );
    assert_eq!(
        f.client.try_get_project(&project_id(&f.env)),
        Err(Ok(Error::ProjectNotFound))
    );
}

/// D-104: a project has no approvers when it is created, so the approver-count
/// limit can't apply yet.
#[test]
fn create_project_accepts_a_threshold_above_the_approver_count() {
    let f = setup();

    f.client.create_project(&project_id(&f.env), &f.owner, &3);

    assert_eq!(f.client.get_project(&project_id(&f.env)).threshold, 3);
}

/// D-104: no roster can reach this, but the owner can lower it later.
#[test]
fn create_project_accepts_a_threshold_above_the_member_cap() {
    let f = setup();

    f.client
        .create_project(&project_id(&f.env), &f.owner, &(MAX_MEMBERS + 1));

    assert_eq!(
        f.client.get_project(&project_id(&f.env)).threshold,
        MAX_MEMBERS + 1
    );
}

#[test]
fn create_project_refuses_an_over_long_id() {
    let f = setup();

    assert_eq!(
        f.client
            .try_create_project(&too_long_id(&f.env), &f.owner, &1),
        Err(Ok(Error::IdTooLong))
    );
}

#[test]
fn create_project_requires_owner_auth() {
    let f = setup();
    f.env.set_auths(&[]);

    assert!(matches!(
        f.client
            .try_create_project(&project_id(&f.env), &f.owner, &1),
        Err(Err(_))
    ));
    assert_eq!(
        f.client.try_get_project(&project_id(&f.env)),
        Err(Ok(Error::ProjectNotFound))
    );
}

#[test]
fn create_project_emits_its_event() {
    let f = setup();

    f.client.create_project(&project_id(&f.env), &f.owner, &2);

    assert_eq!(
        f.env.events().all(),
        [ProjectCreated {
            project_id: project_id(&f.env),
            owner: f.owner.clone(),
            threshold: 2,
        }
        .to_xdr(&f.env, &f.client.address)],
    );
}

#[test]
fn get_project_refuses_an_unknown_id() {
    let f = setup();

    assert_eq!(
        f.client.try_get_project(&project_id(&f.env)),
        Err(Ok(Error::ProjectNotFound))
    );
}

#[test]
fn get_project_refuses_an_over_long_id() {
    let f = setup();

    assert_eq!(
        f.client.try_get_project(&too_long_id(&f.env)),
        Err(Ok(Error::IdTooLong))
    );
}
