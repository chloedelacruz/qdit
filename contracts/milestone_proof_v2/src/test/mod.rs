#![cfg(test)]

mod project;

use crate::{MilestoneProofV2Contract, MilestoneProofV2ContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
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
