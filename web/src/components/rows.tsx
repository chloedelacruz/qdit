import { HashLink } from "@/components/hash-link";
import { ListRow, MemberChip, RowControl, RowMeta } from "@/components/data-list";
import { AnchorBadge } from "@/components/milestone-anchor";
import { StatusBadge } from "@/components/status-badge";
import { TaskStatusMenu } from "@/components/task-status-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  DEPLOYMENT_STATUS,
  MEMBER_ROLE,
  MILESTONE_STATUS,
  PROJECT_STATUS,
  TASK_PRIORITY,
  type MemberRole,
  type TaskPriority,
  type Tone,
} from "@/lib/constants";
import { NETWORK_LABELS } from "@/lib/stellar";
import type {
  DeploymentRow,
  MilestoneRow,
  ProjectMember,
  ProjectRow,
  ProofRow,
  TaskRow,
} from "@/lib/queries";

/**
 * One row component per entity, shared between the project-scoped and
 * cross-project views. `showProject` is the only difference between them —
 * inside a project the name is redundant chrome, outside it is essential.
 *
 * Every row is a **single line** (spec §Density: 32–36px). The identifying
 * label holds its width, secondary metadata truncates, and trailing signals
 * stay pinned right so a column of rows scans vertically. Anything that cannot
 * survive that treatment belongs on a detail page, not in a list.
 */

/**
 * Shared layout: leading label, truncating middle, pinned trailing signals.
 *
 * Optional columns below use `@`-prefixed container variants, not viewport
 * breakpoints. The same row renders full-width on `/tasks` and inside a
 * half-width dashboard panel — keyed to the viewport, the panel keeps every
 * column and crushes the title it exists to show.
 */
const LINE = "flex items-center gap-3";

export function ProjectListRow({
  project,
  actions,
}: {
  project: ProjectRow;
  actions?: React.ReactNode;
}) {
  return (
    <ListRow href={`/projects/${project.slug}`} label={project.name}>
      <div className={LINE}>
        <span className="shrink-0 truncate font-medium">{project.name}</span>

        <RowMeta
          className="min-w-0 flex-1"
          items={[
            project.description,
            `${project.doneCount}/${project.taskCount} tasks`,
            project.openMilestoneCount > 0
              ? `${project.openMilestoneCount} open milestone${project.openMilestoneCount === 1 ? "" : "s"}`
              : null,
            NETWORK_LABELS[project.network],
          ]}
        />

        <ProgressPip value={project.progress} />

        {/* Fixed-width, right-aligned: badge labels vary from "Active" to
            "Ready for Mainnet", and without a reserved column every progress
            bar above lands at a different x. A column of rows has to scan
            vertically. */}
        <span className="hidden w-60 shrink-0 items-center justify-end gap-2 @4xl:flex">
          <StatusBadge state={PROJECT_STATUS[project.status]} dot={false} />
          <StatusBadge state={DEPLOYMENT_STATUS[project.deployment]} dot={false} />
        </span>

        {actions ? <RowControl>{actions}</RowControl> : null}
      </div>
    </ListRow>
  );
}

export function TaskListRow({
  task,
  showProject = false,
  actions,
}: {
  task: TaskRow;
  showProject?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <ListRow href={`/projects/${task.projectSlug}/board`} label={task.title}>
      <div className={LINE}>
        {/* Reserved so titles start on a common left edge regardless of status.
            The badge doubles as the control for moving the task. */}
        <RowControl className="w-24">
          <TaskStatusMenu taskId={task.id} status={task.status} />
        </RowControl>

        {/* Reserved too, and for the same reason — `PriorityChip` renders
            nothing for the default, and an unreserved slot would step every
            title left on the majority of rows. */}
        <span className="flex w-9 shrink-0">
          <PriorityChip priority={task.priority} />
        </span>

        <span className="min-w-0 flex-[2] truncate">{task.title}</span>

        <RowMeta
          className="hidden min-w-0 flex-1 @2xl:block"
          items={[
            showProject ? task.projectName : null,
            task.milestoneTitle ?? "No milestone",
          ]}
        />

        {task.dueDate ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {task.dueDate}
          </span>
        ) : null}

        <MemberAvatar
          avatarUrl={task.assigneeAvatarUrl}
          initials={task.assigneeInitials}
          name={task.assigneeName}
        />

        {actions ? <RowControl>{actions}</RowControl> : null}
      </div>
    </ListRow>
  );
}

export function MilestoneListRow({
  milestone,
  showProject = false,
  statusControl,
  actions,
}: {
  milestone: MilestoneRow;
  showProject?: boolean;
  /** The approval-flow control. Falls back to a plain badge when read-only. */
  statusControl?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <ListRow
      href={`/projects/${milestone.projectSlug}/milestones`}
      label={milestone.title}
    >
      <div className={LINE}>
        <span className="shrink-0 truncate font-medium">{milestone.title}</span>

        <RowMeta
          className="min-w-0 flex-1"
          items={[
            showProject ? milestone.projectName : null,
            `${milestone.doneCount}/${milestone.taskCount} tasks`,
            milestone.dueDate ? `Due ${milestone.dueDate}` : null,
            milestone.proofCount > 0
              ? `${milestone.proofCount} proof${milestone.proofCount === 1 ? "" : "s"}`
              : "No proof",
          ]}
        />

        <ProgressPip value={milestone.progress} />

        {/*
          Sits beside the status rather than replacing it: the app's status and
          the ledger's are separate facts, and a milestone can legitimately be
          approved here and unanchored there.
        */}
        {milestone.anchor ? (
          // Carries the explorer link and a copy button, both of which have to
          // out-rank the row's own link rather than sit inside it.
          <RowControl>
            <AnchorBadge anchor={milestone.anchor} stale={milestone.anchorStale} />
          </RowControl>
        ) : null}

        <RowControl className="w-24 justify-end">
          {statusControl ?? (
            <StatusBadge state={MILESTONE_STATUS[milestone.status]} dot={false} />
          )}
        </RowControl>

        {actions ? <RowControl>{actions}</RowControl> : null}
      </div>
    </ListRow>
  );
}

export function ProofListRow({
  proof,
  showProject = false,
  actions,
}: {
  proof: ProofRow;
  showProject?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <ListRow>
      <div className={LINE}>
        <span className="min-w-0 flex-[2] truncate">{proof.notes ?? "Proof record"}</span>

        <RowMeta
          className="hidden min-w-0 flex-1 @2xl:block"
          items={[
            showProject ? proof.projectName : null,
            proof.milestoneTitle,
            proof.authorName,
            proof.createdAt.slice(0, 10),
          ]}
        />

        {/* Who signed it, next to what they signed. Widest containers only —
            two hash pills side by side is the most this row can carry, so the
            signer is the first thing to go when the panel narrows. Labelled
            because an unlabelled strkey reads as another tx hash. */}
        {proof.walletAddress ? (
          <span className="hidden shrink-0 items-center gap-1.5 @4xl:flex">
            <span className="text-xs text-muted-foreground">Signer</span>
            <HashLink
              value={proof.walletAddress}
              kind="account"
              network={proof.network}
              lead={4}
              tail={4}
            />
          </span>
        ) : null}

        {proof.txHash ? (
          <HashLink value={proof.txHash} kind="tx" network={proof.network} />
        ) : null}

        <span className="shrink-0 text-xs text-muted-foreground">
          {NETWORK_LABELS[proof.network]}
        </span>

        {actions}
      </div>
    </ListRow>
  );
}

export function DeploymentListRow({
  deployment,
  showProject = false,
  actions,
}: {
  deployment: DeploymentRow;
  showProject?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <ListRow>
      <div className={LINE}>
        <span className="min-w-0 flex-[2] truncate">
          {deployment.releaseNotes ?? "Deployment"}
        </span>

        <RowMeta
          className="hidden min-w-0 flex-1 @2xl:block"
          items={[
            showProject ? deployment.projectName : null,
            deployment.network ? NETWORK_LABELS[deployment.network] : null,
            deployment.deployedByName,
            deployment.deployedAt.slice(0, 10),
          ]}
        />

        {deployment.txHash && deployment.network ? (
          <HashLink value={deployment.txHash} kind="tx" network={deployment.network} />
        ) : null}

        {deployment.isCurrent ? (
          <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[0.6875rem] font-medium text-accent-foreground">
            Current
          </span>
        ) : null}

        <span className="flex w-36 shrink-0 justify-end">
          <StatusBadge state={DEPLOYMENT_STATUS[deployment.status]} dot={false} />
        </span>

        {actions}
      </div>
    </ListRow>
  );
}

/**
 * A task's priority, as the P0–P3 chip the `task_priority` comment specifies.
 *
 * **Renders nothing for `medium`**, which is what makes it worth having. The
 * column is `not null default 'medium'`, so a chip on every priority is a chip
 * on every task — a column of identical badges carrying no information, on a
 * surface whose entire job is scanning. Absent means normal; a chip means
 * someone made a decision about this task.
 *
 * Callers reserve the width, so hiding the default does not shift the rows
 * around it.
 */
export function PriorityChip({ priority }: { priority: TaskPriority }) {
  if (priority === "medium") return null;

  const meta = TASK_PRIORITY[priority];

  return (
    <StatusBadge
      dot={false}
      state={{ label: meta.short, tone: meta.tone }}
      // "P0" is legible and meaningless read aloud.
      srLabel={`Priority: ${meta.label}`}
      className="shrink-0 px-1.5"
    />
  );
}

/**
 * A member's photo at row scale, degrading to the initials chip.
 *
 * Three states, in order: the OAuth avatar when there is one, initials when
 * there is not, and the dashed outline when nobody is assigned. Radix only
 * swaps the image in once it has actually loaded, so a stale or broken
 * `avatar_url` shows initials rather than a torn image — the fallback is the
 * real component, the photo is the enhancement.
 */
export function MemberAvatar({
  avatarUrl,
  initials,
  name,
  className,
}: {
  avatarUrl?: string | null;
  initials: string | null;
  name: string;
  className?: string;
}) {
  if (!avatarUrl) {
    return <MemberChip initials={initials} name={name} className={className} />;
  }

  return (
    // Sized to the initials chip it replaces, not to the primitive's default —
    // a row is 32–36px and cannot afford the 24px variant.
    <Avatar size="sm" title={name} aria-label={name} className={cn("size-5", className)}>
      <AvatarImage src={avatarUrl} alt="" />
      <AvatarFallback className="bg-accent text-[0.625rem] font-medium text-accent-foreground">
        {initials ?? "–"}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * One person on a project, with what they may do.
 *
 * The role is a badge rather than plain meta text because it is the only thing
 * on this row that is actionable — everything else identifies the person, and
 * the role is what an admin came here to change. Owner and admin get weight so
 * the question the roster really answers, "who decides here", is legible at a
 * glance.
 */
export function MemberListRow({
  member,
  actions,
}: {
  member: ProjectMember;
  actions?: React.ReactNode;
}) {
  const role = MEMBER_ROLE[member.role];

  return (
    <ListRow>
      <div className={LINE}>
        <MemberAvatar
          avatarUrl={member.avatarUrl}
          initials={member.initials}
          name={member.name}
        />

        <span className="min-w-0 flex-1 truncate">{member.name}</span>

        {member.walletAddress ? (
          <span className="hidden shrink-0 @2xl:inline">
            <HashLink value={member.walletAddress} kind="account" network="testnet" />
          </span>
        ) : null}

        <RowMeta className="hidden shrink-0 @lg:block" items={[joinedLabel(member.joinedAt)]} />

        <StatusBadge
          dot={false}
          state={{ label: role.label, tone: ROLE_TONE[member.role] }}
        />

        {actions}
      </div>
    </ListRow>
  );
}

/** Owner and admin carry weight; the rest are quiet. */
const ROLE_TONE: Record<MemberRole, Tone> = {
  owner: "accent",
  admin: "accent",
  member: "neutral",
  viewer: "neutral",
};

function joinedLabel(joinedAt: string | null): string | null {
  return joinedAt ? `Joined ${joinedAt.slice(0, 10)}` : null;
}

/** A hairline progress bar sized for a list row rather than a card. */
function ProgressPip({ value }: { value: number }) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);

  return (
    <span className="hidden shrink-0 items-center gap-1.5 @xl:flex">
      <span
        className="well h-1 w-14 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-8 text-right text-xs text-muted-foreground tabular-nums">
        {pct}%
      </span>
    </span>
  );
}
