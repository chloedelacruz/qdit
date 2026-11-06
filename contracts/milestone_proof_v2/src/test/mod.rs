#![cfg(test)]

mod approvals;
mod members;
mod milestones;
mod project;

use crate::{MilestoneProofV2Contract, MilestoneProofV2ContractClient, Role};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, String,
};

pub const NOW: u64 = 1_700_000_000;

/// Fresh env with auth mocked and the contract registered.
pub struct Fixture {
    pub env: Env,
    pub client: MilestoneProofV2ContractClient<'static>,
    pub owner: Address,
}

pub fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(NOW);

    let contract_id = env.register(MilestoneProofV2Contract, ());
    let client = MilestoneProofV2ContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    Fixture { env, client, owner }
}

/// A real UUID, because that is what the app passes.
pub fn project_id(env: &Env) -> String {
    String::from_str(env, "8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2")
}

pub fn too_long_id(env: &Env) -> String {
    String::from_str(
        env,
        "0123456789012345678901234567890123456789012345678901234567890123x",
    )
}

pub fn milestone_id(env: &Env) -> String {
    String::from_str(env, "c9f0f895-fb98-4b1f-a1b3-8ee9a1d6c4e7")
}

pub fn proof(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Add a new member with `role` to the fixture's project.
pub fn add_member(f: &Fixture, role: Role) -> Address {
    let member = Address::generate(&f.env);
    f.client
        .add_member(&project_id(&f.env), &f.owner, &member, &role);
    member
}
