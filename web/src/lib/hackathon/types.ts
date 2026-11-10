import type { Enums } from "@/lib/types/database";

/**
 * The shared contract for hackathon grading (WP-4.7, D-119).
 *
 * Everything here is plain data: the two frozen snapshots a submission is
 * graded from, the event window, and the shapes the AI review and the judges
 * produce. The rules that read them (eligibility, rubric, leaderboard) are pure
 * functions next to this file, so the grader, the admin UI and the tests all
 * compute the same answer from the same input.
 *
 * Column names and enum values mirror `supabase/migrations/` and
 * `src/lib/types/database.ts`. Timestamps are ISO 8601 strings; `due_date`
 * columns are SQL `date`, so they arrive as `YYYY-MM-DD`.
 */

/* -------------------------------------------------------------------------- */
/* Enum unions, re-exported so callers need only this module                  */
/* -------------------------------------------------------------------------- */

export type ProjectStatus = Enums<"project_status">;
export type MemberRole = Enums<"member_role">;
export type MilestoneStatus = Enums<"milestone_status">;
export type TaskStatus = Enums<"task_status">;
export type TaskPriority = Enums<"task_priority">;
export type StellarNetwork = Enums<"stellar_network">;
export type DeploymentStatus = Enums<"deployment_status">;
export type AnchorAction = Enums<"anchor_action">;

/* -------------------------------------------------------------------------- */
/* qdit snapshot                                                              */
/* -------------------------------------------------------------------------- */

/** `public.projects`, minus owner and chain-registration bookkeeping. */
export interface QditSnapshotProject {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  repo_url: string | null;
  demo_url: string | null;
  docs_url: string | null;
  created_at: string;
  /** Set once the project is registered on chain; null before. */
  chain_contract_id: string | null;
  public_proofs: boolean;
}

/** `public.project_members` joined to `public.profiles`. */
export interface QditSnapshotMember {
  user_id: string;
  role: MemberRole;
  joined_at: string;
  /** Unique, lowercase. Null on accounts predating usernames. */
  username: string | null;
  display_name: string | null;
  wallet_address: string | null;
}

/** `public.milestones`. */
export interface QditSnapshotMilestone {
  id: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  /** SQL `date`: `YYYY-MM-DD`. */
  due_date: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** `public.tasks`. */
export interface QditSnapshotTask {
  id: string;
  milestone_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee_id: string | null;
  /** `not null default 'medium'` in SQL, so never null in a real snapshot. */
  priority: TaskPriority;
  /** SQL `date`: `YYYY-MM-DD`. */
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

/** `public.milestone_reviews`. */
export interface QditSnapshotMilestoneReview {
  id: string;
  milestone_id: string;
  from_status: MilestoneStatus;
  to_status: MilestoneStatus;
  reason: string | null;
  reviewer_id: string | null;
  created_at: string;
}

/** `public.milestone_anchors`. */
export interface QditSnapshotMilestoneAnchor {
  id: string;
  milestone_id: string;
  action: AnchorAction;
  /** Null exactly when `action` is 'reject'. */
  proof_hash: string | null;
  version: number;
  contract_id: string;
  network: StellarNetwork;
  tx_hash: string;
  signer_address: string;
  ledger: number | null;
  created_at: string;
}

/** `public.stellar_proofs`. */
export interface QditSnapshotStellarProof {
  id: string;
  milestone_id: string | null;
  contract_id: string | null;
  tx_hash: string | null;
  network: StellarNetwork;
  wallet_address: string | null;
  proof_url: string | null;
  notes: string | null;
  created_at: string;
}

/** `public.deployments`. */
export interface QditSnapshotDeployment {
  id: string;
  status: DeploymentStatus;
  network: StellarNetwork | null;
  contract_id: string | null;
  tx_hash: string | null;
  release_notes: string | null;
  deployed_at: string | null;
  created_at: string;
}

/** `public.project_doc_links`. */
export interface QditSnapshotDocLink {
  doc_id: string;
  doc_title: string;
  doc_url: string;
}

/** `public.milestone_external_links`. */
export interface QditSnapshotMilestoneLink {
  milestone_id: string;
  doc_id: string;
  node_id: string;
  node_label: string;
  /** DoqtriRegistry `Document.version`, or null when not anchored. */
  doc_version: number | null;
}

/** The frozen qdit project a submission is graded from. */
export interface QditSnapshotV1 {
  schema_version: 1;
  captured_at: string;
  /** True when the producer cut any list short. */
  truncated: boolean;
  project: QditSnapshotProject;
  members: QditSnapshotMember[];
  milestones: QditSnapshotMilestone[];
  tasks: QditSnapshotTask[];
  milestone_reviews: QditSnapshotMilestoneReview[];
  milestone_anchors: QditSnapshotMilestoneAnchor[];
  stellar_proofs: QditSnapshotStellarProof[];
  deployments: QditSnapshotDeployment[];
  doc_links: QditSnapshotDocLink[];
  milestone_links: QditSnapshotMilestoneLink[];
}

/* -------------------------------------------------------------------------- */
/* doqtri snapshot (integration contract)                                     */
/* -------------------------------------------------------------------------- */

/** How a note came to exist. Template and import notes do not count as event work. */
export type DoqtriNoteSource = "editor" | "template" | "import";

export interface DoqtriSnapshotNote {
  doc_id: string;
  title: string;
  markdown: string;
  /** The note's own stored mindmap, opaque to qdit. */
  mindmap: unknown | null;
  created_at: string;
  updated_at: string;
  version: number | null;
  /** Null for notes created before doqtri recorded a source. */
  source: DoqtriNoteSource | null;
}

export interface DoqtriGlobalMindmapNode {
  id: string;
  label: string;
  kind: string;
  depth: number;
  /** The notes that reach this node. */
  doc_ids: string[];
}

export interface DoqtriGlobalMindmapLink {
  source: string;
  target: string;
}

export interface DoqtriGlobalMindmap {
  nodes: DoqtriGlobalMindmapNode[];
  links: DoqtriGlobalMindmapLink[];
}

/** What doqtri pushes to qdit for one team's hackathon entry. */
export interface DoqtriSnapshotV1 {
  hackathon_slug: string;
  snapshot_id: string;
  workspace_id: string;
  generated_at: string;
  notes: DoqtriSnapshotNote[];
  global_mindmap: DoqtriGlobalMindmap;
}

/* -------------------------------------------------------------------------- */
/* Event                                                                      */
/* -------------------------------------------------------------------------- */

/** The event's own zone: calendar-day questions ("is this card overdue?") are asked here. */
export const HACKATHON_TIMEZONE = "Asia/Manila";

export interface HackathonWindow {
  /** ISO 8601 with `Z` or `±hh:mm`; anything else makes the rules throw. */
  opens_at: string;
  closes_at: string;
  team_min: number;
  team_max: number;
}

/* -------------------------------------------------------------------------- */
/* Eligibility                                                                */
/* -------------------------------------------------------------------------- */

export const ELIGIBILITY_RULE_IDS = [
  "team_size",
  "members_joined",
  "cards",
  "board_current",
  "notes_during_event",
  "notes_connected",
  "global_mindmap_image",
  "notes_on_chain",
  "milestones_on_chain",
] as const;

export type EligibilityRuleId = (typeof ELIGIBILITY_RULE_IDS)[number];

export interface EligibilityRuleResult {
  id: EligibilityRuleId;
  passed: boolean;
  /** Short, human, with counts. Shown to admins as-is. */
  reason: string;
}

export interface EligibilityResult {
  eligible: boolean;
  /** Always every rule, in `ELIGIBILITY_RULE_IDS` order. */
  rules: EligibilityRuleResult[];
}

export interface EligibilityInput {
  window: HackathonWindow;
  teamMemberIds: readonly string[];
  snapshot: QditSnapshotV1;
  doqtri: DoqtriSnapshotV1 | null;
  hasGlobalMindmapImage: boolean;
  /** What the chain said, read by the grading worker before the gate runs (chain-facts.ts). */
  chain: ChainFacts;
}

/**
 * What the chain confirmed for one submission (WP-4.7, QDIT-54), read once
 * per version by `lib/hackathon/chain-facts.ts`. Only confirmations are
 * listed: a read that failed never produces a ChainFacts at all, so an
 * absent id always means "the chain answered, and not this one".
 */
export interface ChainFacts {
  /** Lowercase doc_ids of event notes anchored on this deployment's DoqtriRegistry. */
  anchoredNoteIds: readonly string[];
  /** Milestone ids whose on-chain record was submitted inside the event window. */
  anchoredMilestoneIds: readonly string[];
}

/**
 * The submission dialog's pre-submit check (QDIT-55): the gate run on the
 * team's current work. Advisory only; grading recomputes it from the frozen
 * version.
 */
export interface EntryCheckRule {
  id: EligibilityRuleId;
  /** Null when the rule could not be checked (the chain did not answer). */
  passed: boolean | null;
  reason: string;
}

export interface EntryCheck {
  /** Every rule passed: the dialog submits without asking. */
  allPassed: boolean;
  rules: EntryCheckRule[];
  /** The chain could not be read, so the two chain rules are unchecked. */
  chainUnavailable: boolean;
  /** The doqtri snapshot the check read (the one submit would attach), or null. */
  doqtri: { receivedAt: string; noteCount: number } | null;
}

/* -------------------------------------------------------------------------- */
/* AI review                                                                  */
/* -------------------------------------------------------------------------- */

export const CRITERION_KEYS = [
  "clarity",
  "structure",
  "accuracy",
  "connections",
  "execution",
] as const;

export type CriterionKey = (typeof CRITERION_KEYS)[number];

export const AI_FLAGS = [
  "manipulation",
  "placeholder",
  "off_topic",
  "images_unreadable",
  "images_contradict_notes",
  "truncated_input",
  "disagreement",
] as const;

export type AiFlag = (typeof AI_FLAGS)[number];

export interface AiCriterionScore {
  /** 0–10. Clamped and rounded by `clampScore` before any arithmetic. */
  score: number;
  evidence: string;
}

/** One model run's structured output. The model never computes a total. */
export interface AiRunOutput {
  criteria: Record<CriterionKey, AiCriterionScore>;
  summary: string;
  flags: AiFlag[];
}

/* -------------------------------------------------------------------------- */
/* Human round                                                                */
/* -------------------------------------------------------------------------- */

/** One judge's scores for one finalist. Each criterion is an integer 1–5. */
export interface JudgeScore {
  judge_id: string;
  clarity: number;
  structure: number;
  accuracy: number;
  connections: number;
  pitch: number;
}

export const JUDGE_CRITERIA = [
  "clarity",
  "structure",
  "accuracy",
  "connections",
  "pitch",
] as const satisfies readonly Exclude<keyof JudgeScore, "judge_id">[];
