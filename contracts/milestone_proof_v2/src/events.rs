//! Every write emits one event, and a failed call emits none.
//!
//! The shape follows v1: topic 0 is `qdit`, topic 1 the verb, topic 2 the
//! project id. The data carries what `@qdit/verify replay` needs to rebuild
//! state from events alone, without reading contract storage.

use soroban_sdk::{contractevent, Address, String};

#[contractevent(topics = ["qdit", "create"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectCreated {
    #[topic]
    pub project_id: String,
    pub owner: Address,
    pub threshold: u32,
}
