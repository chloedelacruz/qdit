/**
 * The seeded rows these specs assert against, in one place.
 *
 * `supabase/seed.sql` is the source of truth; this mirrors it so a change there
 * breaks one file instead of nine. Counts that would drift as the workspace
 * grows are deliberately *not* recorded here — those tests are written to be
 * size-independent instead.
 */

export const PROJECT = {
  name: "Milestone Proof Registry",
  slug: "milestone-proof-registry",
  status: "Active",
} as const;

export const MEMBERS = {
  ada: { name: "Ada Builder", initials: "AB" },
  ben: { name: "Ben Reviewer", initials: "BR" },
  cleo: { name: "Cleo Observer", initials: "CO" },
} as const;

/** 5 tasks: 2 done, 1 in progress, 2 todo. */
export const BOARD_COUNTS = { todo: 2, in_progress: 1, done: 2 } as const;
export const TASK_TOTAL = 5;

export const TASKS = {
  done: "Model the milestone state machine",
  inProgress: "Publish the WASM to Testnet",
  todo: "Build the task board",
  /** The only task with no milestone and no assignee. */
  unassigned: "Draft the grant progress update",
} as const;

/** 3 milestones: 1 approved, 1 submitted, 1 proposed. */
export const MILESTONES = {
  approved: "Contract scaffold + tests",
  submitted: "Testnet deployment",
  proposed: "Dashboard MVP",
} as const;
export const MILESTONE_TOTAL = 3;

/** 2 proofs, both testnet; one carries a contract id and tx hash. */
export const PROOF_TOTAL = 2;

/** 2 deployment rows for the one project, so the cross-project view shows 1. */
export const DEPLOYMENT_ROWS = 2;
export const DEPLOYMENT_CURRENT = 1;
