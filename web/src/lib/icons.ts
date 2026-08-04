import {
  CircleDot,
  Clock3,
  Columns3,
  Folder,
  GitBranch,
  LayoutGrid,
  Link2,
  Milestone,
  Settings2,
  SquareStack,
  UserRound,
  type LucideIcon,
} from "lucide-react";

/**
 * One glyph per concept, for the whole app.
 *
 * The point is recognition, not decoration: a milestone looks the same in the
 * sidebar, in a section heading and in an empty state, so the glyph becomes a
 * label you can read at a glance. Anything that needs an icon imports it from
 * here — never inline from `lucide-react` — otherwise the vocabulary drifts and
 * the same concept picks up three different marks.
 *
 * Spec §Iconography: geometric, minimal detail, no literal blockchain imagery,
 * and no literal task/checklist marks. `CircleDot` stands in for a task rather
 * than a ticked checkbox for exactly that reason — it is also how a work item
 * reads in the tools qdit is measured against.
 */
export const ICON = {
  dashboard: LayoutGrid,
  project: Folder,
  overview: SquareStack,
  board: Columns3,
  task: CircleDot,
  milestone: Milestone,
  deployment: GitBranch,
  proof: Link2,
  settings: Settings2,
  /** Work assigned to the signed-in user. */
  assignedToMe: UserRound,
  /** Waiting on someone else — review, approval, sign-off. */
  awaiting: Clock3,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICON;
