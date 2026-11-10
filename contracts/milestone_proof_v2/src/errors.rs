use soroban_sdk::contracterror;

/// Codes 1 to 6 mean what they mean in v1, so a client can share its handling.
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// A project with this id is already registered.
    ProjectExists = 1,
    /// No project is registered under this id.
    ProjectNotFound = 2,
    /// No milestone record exists for this project/milestone pair.
    MilestoneNotFound = 3,
    /// Caller is authenticated but may not do this: not the project owner, or
    /// a member whose role does not allow the call.
    NotAuthorized = 4,
    /// The milestone is not in a status that permits this transition.
    InvalidStatus = 5,
    /// An identifier is longer than the id limit.
    IdTooLong = 6,
    /// Caller is authenticated but is not on the project's roster.
    NotMember = 7,
    /// This address has already approved this version of the milestone.
    AlreadyApproved = 8,
    /// The threshold is out of bounds, or this change would break it.
    InvalidThreshold = 9,
    /// The project's roster is full.
    MemberLimit = 10,
    /// A batch with this id is already anchored for this project.
    BatchExists = 11,
    /// The approver named a hash other than the milestone's current one.
    ProofMismatch = 12,
    /// No batch is anchored under this id for this project.
    BatchNotFound = 13,
    /// A batch's leaf count is 0 or over `MAX_BATCH_LEAVES`.
    InvalidBatch = 14,
}
