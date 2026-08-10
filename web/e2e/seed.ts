/**
 * The seeded rows these specs assert against, in one place.
 *
 * `supabase/seed.sql` is the source of truth; this mirrors it so a change there
 * breaks one file instead of nine. Counts that would drift as the workspace
 * grows are deliberately *not* recorded here — those tests are written to be
 * size-independent instead.
 */

export const PROJECT = {
  /** Fixed in `seed.sql`, so `reseed.setup.ts` can scope its writes to it. */
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "Milestone Proof Registry",
  slug: "milestone-proof-registry",
  status: "Active",
} as const;

/**
 * The roster, as the hosted e2e database actually has it.
 *
 * `owner` is **the signed-in account** — `E2E_EMAIL` — and that is forced, not
 * a preference. `board.spec.ts` asserts the owner's name on the card for
 * `TASKS.inProgress`, and `dashboard.spec.ts` asserts that same task appears
 * under "My open tasks", which only holds for tasks assigned to whoever is
 * signed in. The two can only both pass if the signed-in user *is* the owner
 * persona, so the real account holds it in the hosted database: the memberships,
 * task assignments, proofs and deployments all sit with it.
 *
 * `supabase/seed.sql` creates "Ada Builder" for that role instead, because it
 * seeds a local stack where there is no real account to hand anything to. That
 * divergence is deliberate; see the e2e section of README.md.
 *
 * Pointing `E2E_EMAIL` at anyone else — including Ada on the hosted project,
 * where she holds no membership — fails ~50 specs on their empty states rather
 * than on sign-in. `web/.env.example` describes the symptom.
 */
export const MEMBERS = {
  owner: { name: "chloedelacruz", initials: "CH" },
  ben: { name: "Ben Reviewer", initials: "BR" },
  cleo: { name: "Cleo Observer", initials: "CO" },
} as const;

/**
 * An account that exists and belongs to no project, for the invite-by-email
 * path.
 *
 * That combination is what makes her the right subject: RLS hides a
 * non-teammate's `profiles` row from every query the client can make, so she
 * cannot be reached through the member picker at all. Adding her exercises
 * `add_project_member_by_email` doing the one thing only it can do.
 *
 * No password here — the specs never sign in as her, they add her.
 */
export const OUTSIDER = {
  email: "ada@qdit.test",
  name: "Ada Builder",
} as const;

export const TASKS = {
  done: "Model the milestone state machine",
  inProgress: "Publish the WASM to Testnet",
  todo: "Build the task board",
  /** The only task with no milestone and no assignee. */
  unassigned: "Draft the grant progress update",
} as const;

/**
 * Which column each seeded task belongs in.
 *
 * This is the column the board is *supposed* to show, which is not the same
 * claim as "the column it currently shows" — dragging a card during manual
 * testing moves a seeded row and nothing puts it back, which is exactly how
 * the counts below drifted once already. `reseed.setup.ts` restores these
 * before every run, so the two cannot disagree for long.
 *
 * Titles rather than ids: they are unique within the seeded project, stable
 * across a `supabase db reset` (which reassigns ids), and they are what the
 * specs already assert on.
 */
export const SEEDED_TASKS = [
  { title: TASKS.done, status: "done" },
  { title: "Write contract unit tests", status: "done" },
  { title: TASKS.inProgress, status: "in_progress" },
  { title: TASKS.todo, status: "todo" },
  { title: TASKS.unassigned, status: "todo" },
] as const satisfies readonly { title: string; status: TaskStatus }[];

type TaskStatus = "todo" | "in_progress" | "done";

/**
 * Derived, never typed by hand.
 *
 * The previous version was a literal beside a comment reading "5 tasks: 2
 * done, 1 in progress, 2 todo", and a literal can disagree with the rows it
 * describes without anything noticing. Counting `SEEDED_TASKS` means the only
 * way to change a count is to change the row it comes from.
 */
export const BOARD_COUNTS: Record<TaskStatus, number> = SEEDED_TASKS.reduce(
  (counts, task) => ({ ...counts, [task.status]: counts[task.status] + 1 }),
  { todo: 0, in_progress: 0, done: 0 } as Record<TaskStatus, number>,
);

export const TASK_TOTAL = SEEDED_TASKS.length;

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
