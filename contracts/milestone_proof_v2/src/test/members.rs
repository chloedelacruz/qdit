use super::*;
use crate::{Error, MemberAdded, MemberRemoved, ProjectOwnerTransferred, Role, MAX_MEMBERS};
use soroban_sdk::{
    testutils::{Address as _, Events, MockAuth, MockAuthInvoke},
    Event as _, IntoVal,
};

/// A project with threshold 1 and no members yet.
fn with_project() -> Fixture {
    let f = setup();
    f.client.create_project(&project_id(&f.env), &f.owner, &1);
    f
}

#[test]
fn add_member_puts_them_on_the_roster() {
    let f = with_project();

    let submitter = add_member(&f, Role::Submitter);
    let approver = add_member(&f, Role::Approver);

    let members = f.client.get_members(&project_id(&f.env));
    assert_eq!(members.len(), 2);
    assert_eq!(members.get(submitter), Some(Role::Submitter));
    assert_eq!(members.get(approver), Some(Role::Approver));
}

#[test]
fn remove_member_takes_them_off_the_roster() {
    let f = with_project();
    let submitter = add_member(&f, Role::Submitter);

    f.client
        .remove_member(&project_id(&f.env), &f.owner, &submitter);

    assert_eq!(f.client.get_members(&project_id(&f.env)).len(), 0);
}

#[test]
fn add_member_on_an_existing_member_changes_their_role() {
    let f = with_project();
    let member = add_member(&f, Role::Submitter);

    f.client
        .add_member(&project_id(&f.env), &f.owner, &member, &Role::Approver);

    let members = f.client.get_members(&project_id(&f.env));
    assert_eq!(members.len(), 1);
    assert_eq!(members.get(member), Some(Role::Approver));
}

#[test]
fn add_member_refuses_a_non_owner() {
    let f = with_project();
    let stranger = Address::generate(&f.env);

    assert_eq!(
        f.client
            .try_add_member(&project_id(&f.env), &stranger, &stranger, &Role::Approver),
        Err(Ok(Error::NotAuthorized))
    );
    assert_eq!(f.client.get_members(&project_id(&f.env)).len(), 0);
}

#[test]
fn remove_member_refuses_a_non_owner() {
    let f = with_project();
    let member = add_member(&f, Role::Submitter);
    let stranger = Address::generate(&f.env);

    assert_eq!(
        f.client
            .try_remove_member(&project_id(&f.env), &stranger, &member),
        Err(Ok(Error::NotAuthorized))
    );
    assert_eq!(f.client.get_members(&project_id(&f.env)).len(), 1);
}

#[test]
fn add_member_requires_owner_auth() {
    let f = with_project();
    let member = Address::generate(&f.env);
    f.env.set_auths(&[]);

    assert!(matches!(
        f.client
            .try_add_member(&project_id(&f.env), &f.owner, &member, &Role::Approver),
        Err(Err(_))
    ));
    assert_eq!(f.client.get_members(&project_id(&f.env)).len(), 0);
}

#[test]
fn remove_member_requires_owner_auth() {
    let f = with_project();
    let member = add_member(&f, Role::Submitter);
    f.env.set_auths(&[]);

    assert!(matches!(
        f.client
            .try_remove_member(&project_id(&f.env), &f.owner, &member),
        Err(Err(_))
    ));
    assert_eq!(f.client.get_members(&project_id(&f.env)).len(), 1);
}

#[test]
fn add_member_refuses_past_the_cap() {
    let f = with_project();
    for _ in 0..MAX_MEMBERS {
        add_member(&f, Role::Submitter);
    }
    let one_more = Address::generate(&f.env);

    assert_eq!(
        f.client
            .try_add_member(&project_id(&f.env), &f.owner, &one_more, &Role::Submitter),
        Err(Ok(Error::MemberLimit))
    );
    assert_eq!(f.client.get_members(&project_id(&f.env)).len(), MAX_MEMBERS);
}

/// Changing a role adds nobody, so a full roster still allows it.
#[test]
fn a_full_roster_can_still_change_a_role() {
    let f = with_project();
    let member = add_member(&f, Role::Submitter);
    for _ in 1..MAX_MEMBERS {
        add_member(&f, Role::Submitter);
    }

    f.client
        .add_member(&project_id(&f.env), &f.owner, &member, &Role::Approver);

    assert_eq!(
        f.client.get_members(&project_id(&f.env)).get(member),
        Some(Role::Approver)
    );
}

#[test]
fn member_calls_refuse_an_unknown_project() {
    let f = setup();
    let member = Address::generate(&f.env);
    let id = project_id(&f.env);

    assert_eq!(
        f.client
            .try_add_member(&id, &f.owner, &member, &Role::Approver),
        Err(Ok(Error::ProjectNotFound))
    );
    assert_eq!(
        f.client.try_remove_member(&id, &f.owner, &member),
        Err(Ok(Error::ProjectNotFound))
    );
    assert_eq!(
        f.client.try_get_members(&id),
        Err(Ok(Error::ProjectNotFound))
    );
}

#[test]
fn member_calls_refuse_an_over_long_id() {
    let f = setup();
    let member = Address::generate(&f.env);
    let id = too_long_id(&f.env);

    assert_eq!(
        f.client
            .try_add_member(&id, &f.owner, &member, &Role::Approver),
        Err(Ok(Error::IdTooLong))
    );
    assert_eq!(
        f.client.try_remove_member(&id, &f.owner, &member),
        Err(Ok(Error::IdTooLong))
    );
    assert_eq!(
        f.client.try_transfer_project_owner(&id, &f.owner, &member),
        Err(Ok(Error::IdTooLong))
    );
    assert_eq!(f.client.try_get_members(&id), Err(Ok(Error::IdTooLong)));
}

#[test]
fn remove_member_refuses_someone_not_on_the_roster() {
    let f = with_project();
    let stranger = Address::generate(&f.env);

    assert_eq!(
        f.client
            .try_remove_member(&project_id(&f.env), &f.owner, &stranger),
        Err(Ok(Error::NotMember))
    );
}

#[test]
fn removing_an_approver_below_the_threshold_is_refused() {
    let f = with_project();
    let approver = add_member(&f, Role::Approver);

    assert_eq!(
        f.client
            .try_remove_member(&project_id(&f.env), &f.owner, &approver),
        Err(Ok(Error::InvalidThreshold))
    );
    assert_eq!(
        f.client.get_members(&project_id(&f.env)).get(approver),
        Some(Role::Approver)
    );
}

#[test]
fn removing_an_approver_above_the_threshold_is_allowed() {
    let f = with_project();
    let approver = add_member(&f, Role::Approver);
    let spare = add_member(&f, Role::Approver);

    f.client
        .remove_member(&project_id(&f.env), &f.owner, &spare);

    let members = f.client.get_members(&project_id(&f.env));
    assert_eq!(members.len(), 1);
    assert_eq!(members.get(approver), Some(Role::Approver));
}

/// D-106: a role change can't get round the check on removal.
#[test]
fn demoting_an_approver_below_the_threshold_is_refused() {
    let f = with_project();
    let approver = add_member(&f, Role::Approver);

    assert_eq!(
        f.client
            .try_add_member(&project_id(&f.env), &f.owner, &approver, &Role::Submitter),
        Err(Ok(Error::InvalidThreshold))
    );
    assert_eq!(
        f.client.get_members(&project_id(&f.env)).get(approver),
        Some(Role::Approver)
    );
}

#[test]
fn demoting_an_approver_above_the_threshold_is_allowed() {
    let f = with_project();
    add_member(&f, Role::Approver);
    let spare = add_member(&f, Role::Approver);

    f.client
        .add_member(&project_id(&f.env), &f.owner, &spare, &Role::Submitter);

    assert_eq!(
        f.client.get_members(&project_id(&f.env)).get(spare),
        Some(Role::Submitter)
    );
}

/// D-104: a threshold above the approver count is allowed at creation. Adding
/// approvers works from there, and only taking one away is refused.
#[test]
fn a_project_created_above_its_approver_count_can_still_add_approvers() {
    let f = setup();
    f.client.create_project(&project_id(&f.env), &f.owner, &2);

    let first = add_member(&f, Role::Approver);
    assert_eq!(
        f.client
            .try_remove_member(&project_id(&f.env), &f.owner, &first),
        Err(Ok(Error::InvalidThreshold))
    );

    add_member(&f, Role::Approver);
    assert_eq!(f.client.get_members(&project_id(&f.env)).len(), 2);
}

#[test]
fn member_writes_emit_their_events() {
    let f = with_project();
    let env = &f.env;
    let contract = &f.client.address;
    let member = Address::generate(env);

    f.client
        .add_member(&project_id(env), &f.owner, &member, &Role::Submitter);
    assert_eq!(
        env.events().all(),
        [MemberAdded {
            project_id: project_id(env),
            member: member.clone(),
            role: Role::Submitter,
        }
        .to_xdr(env, contract)],
    );

    f.client
        .add_member(&project_id(env), &f.owner, &member, &Role::Approver);
    assert_eq!(
        env.events().all(),
        [MemberAdded {
            project_id: project_id(env),
            member: member.clone(),
            role: Role::Approver,
        }
        .to_xdr(env, contract)],
    );

    add_member(&f, Role::Approver);
    f.client.remove_member(&project_id(env), &f.owner, &member);
    assert_eq!(
        env.events().all(),
        [MemberRemoved {
            project_id: project_id(env),
            member,
            role: Role::Approver,
        }
        .to_xdr(env, contract)],
    );
}

#[test]
fn refused_member_writes_emit_nothing() {
    let f = with_project();
    let stranger = Address::generate(&f.env);

    let _ = f
        .client
        .try_add_member(&project_id(&f.env), &stranger, &stranger, &Role::Approver);
    assert!(f.env.events().all().events().is_empty());

    let _ = f
        .client
        .try_remove_member(&project_id(&f.env), &f.owner, &stranger);
    assert!(f.env.events().all().events().is_empty());
}

#[test]
fn transfer_moves_the_project_and_leaves_the_roster() {
    let f = with_project();
    let member = add_member(&f, Role::Submitter);
    let new_owner = Address::generate(&f.env);

    f.client
        .transfer_project_owner(&project_id(&f.env), &f.owner, &new_owner);

    let project = f.client.get_project(&project_id(&f.env));
    assert_eq!(project.owner, new_owner);
    assert_eq!(project.threshold, 1);

    let members = f.client.get_members(&project_id(&f.env));
    assert_eq!(members.len(), 1);
    assert_eq!(members.get(member), Some(Role::Submitter));
    // D-107: owning a project is not a member role.
    assert_eq!(members.get(new_owner), None);
}

#[test]
fn transfer_moves_roster_rights_to_the_new_owner() {
    let f = with_project();
    let new_owner = Address::generate(&f.env);
    let member = Address::generate(&f.env);

    f.client
        .transfer_project_owner(&project_id(&f.env), &f.owner, &new_owner);

    assert_eq!(
        f.client
            .try_add_member(&project_id(&f.env), &f.owner, &member, &Role::Approver),
        Err(Ok(Error::NotAuthorized))
    );
    f.client
        .add_member(&project_id(&f.env), &new_owner, &member, &Role::Approver);
    assert_eq!(f.client.get_members(&project_id(&f.env)).len(), 1);
}

/// Authorise the transfer for `signer` alone.
fn transfer_signed_only_by(f: &Fixture, signer: &Address, new_owner: &Address) {
    f.env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &MockAuthInvoke {
            contract: &f.client.address,
            fn_name: "transfer_project_owner",
            args: (project_id(&f.env), f.owner.clone(), new_owner.clone()).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
}

#[test]
fn transfer_refuses_without_the_new_owners_signature() {
    let f = with_project();
    let new_owner = Address::generate(&f.env);
    transfer_signed_only_by(&f, &f.owner, &new_owner);

    assert!(matches!(
        f.client
            .try_transfer_project_owner(&project_id(&f.env), &f.owner, &new_owner),
        Err(Err(_))
    ));
    assert_eq!(f.client.get_project(&project_id(&f.env)).owner, f.owner);
}

#[test]
fn transfer_refuses_without_the_current_owners_signature() {
    let f = with_project();
    let new_owner = Address::generate(&f.env);
    transfer_signed_only_by(&f, &new_owner, &new_owner);

    assert!(matches!(
        f.client
            .try_transfer_project_owner(&project_id(&f.env), &f.owner, &new_owner),
        Err(Err(_))
    ));
    assert_eq!(f.client.get_project(&project_id(&f.env)).owner, f.owner);
}

#[test]
fn transfer_refuses_the_wrong_current_owner() {
    let f = with_project();
    let stranger = Address::generate(&f.env);
    let new_owner = Address::generate(&f.env);

    assert_eq!(
        f.client
            .try_transfer_project_owner(&project_id(&f.env), &stranger, &new_owner),
        Err(Ok(Error::NotAuthorized))
    );
    assert_eq!(f.client.get_project(&project_id(&f.env)).owner, f.owner);
}

#[test]
fn transfer_refuses_an_unknown_project() {
    let f = setup();
    let new_owner = Address::generate(&f.env);

    assert_eq!(
        f.client
            .try_transfer_project_owner(&project_id(&f.env), &f.owner, &new_owner),
        Err(Ok(Error::ProjectNotFound))
    );
}

#[test]
fn transfer_emits_its_event() {
    let f = with_project();
    let new_owner = Address::generate(&f.env);

    f.client
        .transfer_project_owner(&project_id(&f.env), &f.owner, &new_owner);

    assert_eq!(
        f.env.events().all(),
        [ProjectOwnerTransferred {
            project_id: project_id(&f.env),
            previous_owner: f.owner.clone(),
            new_owner,
        }
        .to_xdr(&f.env, &f.client.address)],
    );
}
