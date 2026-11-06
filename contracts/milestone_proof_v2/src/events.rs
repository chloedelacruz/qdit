//! Every write emits one event, and a failed call emits none.
//!
//! The shape follows v1: topic 0 is `qdit`, topic 1 the verb, topic 2 the
//! project id. The data carries what `@qdit/verify replay` needs to rebuild
//! state from events alone, without reading contract storage.

use soroban_sdk::{contractevent, Address, BytesN, String};

use crate::storage::Role;

#[contractevent(topics = ["qdit", "create"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectCreated {
    #[topic]
    pub project_id: String,
    pub owner: Address,
    pub threshold: u32,
}

/// Emitted when a project changes hands.
#[contractevent(topics = ["qdit", "transfer"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectOwnerTransferred {
    #[topic]
    pub project_id: String,
    pub previous_owner: Address,
    pub new_owner: Address,
}

/// Emitted when a member is added or their role changes. `role` is the role
/// they hold after this call.
#[contractevent(topics = ["qdit", "add_member"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberAdded {
    #[topic]
    pub project_id: String,
    pub member: Address,
    pub role: Role,
}

/// `role` is the role the member held until this call.
#[contractevent(topics = ["qdit", "remove_member"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberRemoved {
    #[topic]
    pub project_id: String,
    pub member: Address,
    pub role: Role,
}

/// A submission also clears the approvers of any earlier version.
#[contractevent(topics = ["qdit", "submit"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProofSubmitted {
    #[topic]
    pub project_id: String,
    pub milestone_id: String,
    pub submitter: Address,
    pub proof_hash: BytesN<32>,
    pub version: u32,
}
