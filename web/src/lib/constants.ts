/**
 * Display metadata for the product's state machines.
 *
 * These string unions mirror the Postgres enums in supabase/migrations. Keeping
 * the labels here (rather than in the DB) means renaming a label never needs a
 * migration.
 */

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type MilestoneStatus = "proposed" | "submitted" | "approved" | "rejected";
export type ProjectStatus = "active" | "paused" | "completed" | "archived";
export type DeploymentStatus =
  | "not_started"
  | "testnet"
  | "ready_for_mainnet"
  | "mainnet_live";
export type MemberRole = "owner" | "admin" | "member" | "viewer";

/**
 * `tone` maps to the semantic colour tokens in globals.css. The spec allows one
 * accent, so anything that isn't a genuine success/warning/error signal stays
 * neutral.
 */
export type Tone = "neutral" | "accent" | "success" | "warning" | "destructive";

type StateMeta<T extends string> = Record<T, { label: string; tone: Tone }>;

export const TASK_STATUS: StateMeta<TaskStatus> = {
  todo: { label: "Todo", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "accent" },
  done: { label: "Done", tone: "success" },
};

/** Board column order — Todo → In Progress → Done. */
export const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "done"];

/**
 * Task priority, carrying two labels rather than one.
 *
 * `label` is the word — what the form, the facet and the detail panel say,
 * where there is room and the field is named beside it. `short` is the P0–P3
 * form the `task_priority` comment in `20260731135342_task_priority.sql`
 * specifies for the board, where a card is two lines and a chip has to survive
 * beside a status badge, a milestone, a date and an avatar.
 *
 * The numbering inverts the enum: `urgent` is P0 because P0 is the convention
 * everywhere this notation is used, and 'P0' reading as 'the top one' is the
 * whole reason to use it. Postgres orders the enum the other way, low → urgent,
 * which is what makes `order("priority", { ascending: false })` sort P0 first.
 *
 * Only `urgent` and `high` take a signal colour. A scale where every step is
 * coloured has no scale left — and `medium` is the column default, so tinting
 * it would tint essentially every task in the database.
 */
export const TASK_PRIORITY: Record<
  TaskPriority,
  { label: string; short: string; tone: Tone }
> = {
  urgent: { label: "Urgent", short: "P0", tone: "destructive" },
  high: { label: "High", short: "P1", tone: "warning" },
  medium: { label: "Medium", short: "P2", tone: "neutral" },
  low: { label: "Low", short: "P3", tone: "neutral" },
};

/**
 * Most important first, which is the order a menu of priorities is read in.
 * Deliberately not the enum's own order — that one exists to make Postgres sort
 * correctly, and reading a picker top-down as "least important first" inverts
 * what the list is for.
 */
export const TASK_PRIORITY_ORDER: TaskPriority[] = ["urgent", "high", "medium", "low"];

export const MILESTONE_STATUS: StateMeta<MilestoneStatus> = {
  proposed: { label: "Proposed", tone: "neutral" },
  submitted: { label: "Submitted", tone: "accent" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "destructive" },
};

/**
 * The legal milestone transitions — and the reason this is a table rather than
 * a free dropdown.
 *
 * `milestone_status` is the `milestone_proof` contract's state machine, named
 * identically to `MilestoneStatus` in contracts/milestone_proof/src/lib.rs. The
 * contract enforces these rules on-chain; Postgres does not. If the app let a
 * milestone reach, say, `approved` directly from `proposed`, the database would
 * be holding a state the contract will refuse to reproduce when the on-chain
 * call is wired up — and the mismatch would only surface then.
 *
 * So the app enforces the contract's rules today, and the Soroban call later
 * mirrors a transition that has already been validated here.
 */
export const MILESTONE_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  proposed: ["submitted"],
  submitted: ["approved", "rejected"],
  // Terminal on-chain: approve_milestone is only valid from Submitted, and
  // nothing transitions out of Approved.
  approved: [],
  // A rejected milestone may be re-submitted.
  rejected: ["submitted"],
};

/**
 * Transitions the contract gates on `approver == project owner`. Anyone with
 * write access may submit; only the owner rules on it.
 */
export const MILESTONE_OWNER_ONLY: MilestoneStatus[] = ["approved", "rejected"];

/** Verb for a transition, as it reads on a button. */
export function milestoneActionLabel(
  from: MilestoneStatus,
  to: MilestoneStatus,
): string {
  if (to === "submitted") return from === "rejected" ? "Re-submit" : "Submit for approval";
  if (to === "approved") return "Approve";
  return "Reject";
}

export const PROJECT_STATUS: StateMeta<ProjectStatus> = {
  active: { label: "Active", tone: "accent" },
  paused: { label: "Paused", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

export const DEPLOYMENT_STATUS: StateMeta<DeploymentStatus> = {
  not_started: { label: "Not Started", tone: "neutral" },
  testnet: { label: "Deployed to Testnet", tone: "warning" },
  ready_for_mainnet: { label: "Ready for Mainnet", tone: "accent" },
  mainnet_live: { label: "Mainnet Live", tone: "success" },
};

/** Pipeline order, used for the deployment progress indicator. */
export const DEPLOYMENT_STATUS_ORDER: DeploymentStatus[] = [
  "not_started",
  "testnet",
  "ready_for_mainnet",
  "mainnet_live",
];

export const MEMBER_ROLE: Record<MemberRole, { label: string; description: string }> = {
  owner: { label: "Owner", description: "Full control, including deleting the project." },
  admin: { label: "Admin", description: "Manage project settings and members." },
  member: { label: "Member", description: "Create and edit tasks, milestones and proofs." },
  viewer: { label: "Viewer", description: "Read-only access." },
};

/** Tailwind classes per tone, for badges and dots. */
export const TONE_BADGE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground ring-border",
  accent: "bg-accent text-accent-foreground ring-primary/20",
  success: "bg-success/12 text-success ring-success/25",
  warning: "bg-warning/15 text-warning-foreground ring-warning/35 dark:text-warning",
  destructive: "bg-destructive/12 text-destructive ring-destructive/25",
};

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground/50",
  accent: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};
