import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Download,
  ListFilter,
  Loader2,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sun,
  X,
} from "lucide-react";

import {
  AnchorGlyph,
  ApiGlyph,
  AwaitingGlyph,
  BoardGlyph,
  CertificateGlyph,
  DashboardGlyph,
  DeploymentGlyph,
  DisconnectedGlyph,
  ErrorGlyph,
  ExternalGlyph,
  FailedGlyph,
  GuideGlyph,
  HistoryGlyph,
  InfoGlyph,
  LockedGlyph,
  MembersGlyph,
  MilestoneGlyph,
  MismatchGlyph,
  MissingGlyph,
  NotificationGlyph,
  OverviewGlyph,
  PendingGlyph,
  PersonGlyph,
  PlanDocGlyph,
  PrivateGlyph,
  ProjectGlyph,
  ProofGlyph,
  PublicGlyph,
  ReadyGlyph,
  SettingsGlyph,
  ShareGlyph,
  StaleAnchorGlyph,
  TaskGlyph,
  UncheckedGlyph,
  UnregisteredGlyph,
  VerifiedGlyph,
  WalletGlyph,
  type IconComponent,
} from "@/components/icons/glyphs";

export type { IconComponent, IconProps } from "@/components/icons/glyphs";

/**
 * One glyph per concept, for the whole app.
 *
 * The point is recognition, not decoration: a milestone looks the same in the
 * sidebar, in a section heading and in an empty state, so the glyph becomes a
 * label you can read at a glance. Anything that needs an icon imports it from
 * here — never from `lucide-react` or `components/icons` directly — otherwise
 * the vocabulary drifts and the same concept picks up three different marks.
 *
 * Two kinds of entry (QDIT-34):
 *
 * - **Concepts** are qdit's own glyphs (`components/icons/glyphs.tsx`), drawn
 *   to spec §Iconography. These carry meaning, and since the spec amendment
 *   they may stand in for their label on repeated controls and status marks —
 *   always with an `aria-label` and a tooltip naming them.
 * - **Controls** are plain mechanics — a spinner, a chevron, close, copy —
 *   with no qdit meaning to draw. They come from lucide, through here, so a
 *   control never accidentally borrows a concept's mark.
 */
export const ICON = {
  // Places
  dashboard: DashboardGlyph,
  project: ProjectGlyph,
  overview: OverviewGlyph,
  board: BoardGlyph,
  settings: SettingsGlyph,

  // Work
  task: TaskGlyph,
  milestone: MilestoneGlyph,
  deployment: DeploymentGlyph,
  /** A proof record. A hash in a frame, because that is what a proof is here. */
  proof: ProofGlyph,
  /** A doqtri plan linked to a project (D-09). A page, because a plan is read. */
  planDoc: PlanDocGlyph,

  // People
  /** Work assigned to the signed-in user. */
  assignedToMe: PersonGlyph,
  /** A project's roster. Plural of `assignedToMe`, deliberately. */
  members: MembersGlyph,
  /** A connected Stellar account, used for signing. Never a payment. */
  wallet: WalletGlyph,

  // The ledger
  /** Proof written to the ledger. The one place chain imagery is warranted. */
  anchor: AnchorGlyph,
  /** Anchored, but the milestone has changed since. */
  anchorStale: StaleAnchorGlyph,
  /** The project has no on-chain registration yet. */
  unregistered: UnregisteredGlyph,
  /** Submitted to the network, not yet confirmed. */
  pending: PendingGlyph,
  /** The exported certificate — one file, verifiable without qdit. */
  certificate: CertificateGlyph,
  /** A milestone's sequence of anchors and decisions. */
  history: HistoryGlyph,

  // Visibility
  public: PublicGlyph,
  private: PrivateGlyph,
  locked: LockedGlyph,
  share: ShareGlyph,
  /** Leaves qdit — a doqtri doc, an explorer page. */
  external: ExternalGlyph,

  // Signals
  /** Opens an explainer. Never a status. */
  info: InfoGlyph,
  /** Waiting on someone else — review, approval, sign-off. */
  awaiting: AwaitingGlyph,
  notification: NotificationGlyph,
  /**
   * A setup step that is satisfied — wallet installed, network right, account
   * funded. Deliberately not `task`: this marks a precondition the browser
   * detected, never a work item somebody moved.
   */
  ready: ReadyGlyph,
  verified: VerifiedGlyph,
  mismatch: MismatchGlyph,
  failed: FailedGlyph,
  unchecked: UncheckedGlyph,
  disconnected: DisconnectedGlyph,
  /** Something failed. Error boundaries only — never a status or a warning. */
  error: ErrorGlyph,
  /** Asked for by name, and there is no such thing. 404 only. */
  missing: MissingGlyph,

  // Help
  guide: GuideGlyph,
  api: ApiGlyph,

  // Controls (lucide — mechanics, not concepts)
  spinner: Loader2,
  more: MoreHorizontal,
  menu: Menu,
  close: X,
  add: Plus,
  copy: Copy,
  copied: Check,
  /** The chosen option in a menu or list. */
  selected: Check,
  download: Download,
  search: Search,
  filter: ListFilter,
  next: ArrowRight,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  chooser: ChevronsUpDown,
  refresh: RefreshCw,
  send: Send,
  signOut: LogOut,
  light: Sun,
  dark: Moon,
} as const satisfies Record<string, IconComponent>;

export type IconName = keyof typeof ICON;
