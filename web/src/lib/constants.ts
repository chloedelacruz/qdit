/**
 * Display metadata for the product's state machines.
 *
 * These string unions mirror the Postgres enums in supabase/migrations. Keeping
 * the labels here (rather than in the DB) means renaming a label never needs a
 * migration.
 */

export type TaskStatus = "todo" | "in_progress" | "done";
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

export const MILESTONE_STATUS: StateMeta<MilestoneStatus> = {
  proposed: { label: "Proposed", tone: "neutral" },
  submitted: { label: "Submitted", tone: "accent" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "destructive" },
};

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
