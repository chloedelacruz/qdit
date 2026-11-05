
import { HashLink } from "@/components/hash-link";
import { Hint } from "@/components/hint";
import { ListRow, MemberChip, RowControl, RowMeta } from "@/components/data-list";
import { FromDoqtriBadge, PlanDocConnectionBadge } from "@/components/doqtri-doc-card";
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
import { milestoneDocCard, planDocCard } from "@/lib/doqtri-doc-card";
import { NETWORK_LABELS, type StellarNetwork } from "@/lib/stellar";
import type {
  DeploymentRow,
  MilestoneRow,
  PlanDocRow,
  ProjectMember,
  ProjectRow,
  ProofRow,
  TaskRow,
} from "@/lib/queries";
import { ICON } from "@/lib/icons";

/**
 * A member's wallet is on whatever network this deployment runs on — there is no
 * per-member network to read, so the explorer link has to follow the app.
 */
const APP_NETWORK: StellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

/**
 * One row component per entity, shared between the project-scoped and
 * cross-project views. `showProject` is the only difference between them —
 * inside a project the name is redundant chrome, outside it is essential.
 *
 * From `@md` up every row is a **single line** (spec §Density: 32–36px). The
 * identifying label holds its width, secondary metadata truncates, and
 * trailing signals stay pinned right so a column of rows scans vertically.
 * Anything that cannot survive that treatment belongs on a detail page, not in
 * a list.
 *
 * Below `@md` — a phone, in practice — the same row stacks into **two lines**:
 * the title, then the meta and signals under it (QDIT-34). One line at 343px
 * left the title a dozen characters wide behind a status badge and a hash pill;
 * two lines give the title the full width and let the signals wrap rather than
 * push the row out sideways. The ⋯ menu (and a member's avatar, on the
 * roster) stays beside both lines rather than in either, so it sits where a
 * thumb expects it on every row.
 */

/**
 * Shared layout: leading label, truncating middle, pinned trailing signals.
 *
 * Optional columns below use `@`-prefixed container variants, not viewport
 * breakpoints. The same row renders full-width on `/tasks` and inside a
 * half-width dashboard panel — keyed to the viewport, the panel keeps every
 * column and crushes the title it exists to show. `@md` (28rem) is the stacking
 * point because the narrowest desktop panel — half the dashboard at 1280px —
 * is still wider than that, so desktop density is untouched.
 */
const LINE = "flex items-center gap-3";

/**
 * The two lines, as one block beside the row's controls.
 *
 * `@md:contents` is what keeps the desktop row exactly what it was: from `@md`
 * up the line wrappers dissolve and their children become plain items of one
 * flex row, in source order. That is also why each row lists its children in
 * desktop order and only reaches for `order` where the phone layout needs a
 * signal on the title line that the desktop puts further right.
 */
const LINES = "flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-row @md:items-center @md:gap-3";
const TITLE_LINE = "flex min-w-0 items-center gap-2 @md:contents";
// Wraps rather than overflowing: on a phone a status badge plus a hash pill
// can be wider than what is left of the line, and a third line beats a row
// that scrolls the page sideways. The meta inside is `flex-1` with a zero
// basis, so it truncates first and never causes the wrap itself.
const META_LINE = "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 empty:hidden @md:contents";

export function milestonePath(projectSlug: string, milestoneId: string): string {
  return `/projects/${projectSlug}/milestones/${milestoneId}`;
}

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
        <div className={LINES}>
          <span className="min-w-0 truncate font-medium @md:shrink-0">{project.name}</span>

          <div className={META_LINE}>
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
                "Ready for Mainnet", and without a reserved column every
                progress bar above lands at a different x. A column of rows has
                to scan vertically. */}
            <span className="hidden w-60 shrink-0 items-center justify-end gap-2 @4xl:flex">
              <StatusBadge state={PROJECT_STATUS[project.status]} dot={false} />
              <StatusBadge state={DEPLOYMENT_STATUS[project.deployment]} dot={false} />
            </span>
          </div>
        </div>

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
    // Straight to the task's panel on its board (QDIT-34), not to the board
    // with the task still to be found among the columns.
    <ListRow href={`/projects/${task.projectSlug}/board?task=${task.id}`} label={task.title}>
      <div className={LINE}>
        <div className={LINES}>
          <div className={TITLE_LINE}>
            {/* Reserved so titles start on a common left edge regardless of
                status. The badge doubles as the control for moving the task.
                Only from `@md`: on the stacked phone row the title has a line
                of its own to start on, and the reservation is just a gap. */}
            <RowControl className="@md:w-24">
              <TaskStatusMenu taskId={task.id} status={task.status} />
            </RowControl>

            {/* Reserved too, and for the same reason — `PriorityChip` renders
                nothing for the default, and an unreserved slot would step every
                title left on the majority of rows. Collapsed when empty below
                `@md`, for the same reason as the status slot. */}
            <span className="flex shrink-0 @md:w-9 @max-md:empty:hidden">
              <PriorityChip priority={task.priority} />
            </span>

            <span className="min-w-0 flex-1 truncate @md:flex-[2]">{task.title}</span>
          </div>

          <div className={META_LINE}>
            {/* Shown on the stacked row, where the second line has room for it,
                hidden on a narrow single line, back on a wide one. */}
            <RowMeta
              className="min-w-0 flex-1 @md:hidden @2xl:block"
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

            {/* Lifted above the row link so its name hint can open — under the
                overlay a hover or a tap reaches the link, never the avatar. */}
            <RowControl>
              <MemberAvatar
                avatarUrl={task.assigneeAvatarUrl}
                initials={task.assigneeInitials}
                name={task.assigneeName}
              />
            </RowControl>
          </div>
        </div>

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
  // The decision that produced the current state, if there was one. Only the
  // newest matters on a row: earlier rounds are history, and history belongs on
  // a milestone's own view rather than in a list.
  const decision = milestone.reviews[0];

  return (
    // The milestone's own page (QDIT-34): tasks, proof, history, certificate
    // and the public link, one click from wherever the row is shown.
    <ListRow
      href={milestonePath(milestone.projectSlug, milestone.id)}
      label={milestone.title}
    >
      <div className={LINE}>
        <div className={LINES}>
          <div className={TITLE_LINE}>
            <span className="min-w-0 truncate font-medium @md:shrink-0">{milestone.title}</span>

            {/*
              Says where the title comes from, beside the title it is about: a
              linked milestone's title is doqtri's (D-12), and the edit form
              shows it read-only. It opens the doc card (WP-2.6), so it is a
              control lifted above the row's own link.
            */}
            {milestone.link ? (
              <RowControl>
                <FromDoqtriBadge
                  card={milestoneDocCard(
                    milestone.link,
                    milestone.anchor
                      ? {
                          action: milestone.anchor.action,
                          version: milestone.anchor.version,
                          txHash: milestone.anchor.txHash,
                          network: milestone.anchor.network,
                        }
                      : null,
                    milestone.anchorStale,
                  )}
                />
              </RowControl>
            ) : null}
          </div>

          <div className={META_LINE}>
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
              Sits beside the status rather than replacing it: the app's status
              and the ledger's are separate facts, and a milestone can
              legitimately be approved here and unanchored there.
            */}
            {milestone.anchor ? (
              // Carries the explorer link and a copy button, both of which have
              // to out-rank the row's own link rather than sit inside it.
              <RowControl>
                <AnchorBadge anchor={milestone.anchor} stale={milestone.anchorStale} />
              </RowControl>
            ) : null}

            {/*
              `min-w-24`, not `w-24` — and only from `@md`.

              The width is here so a column of status badges lines up
              vertically, and a fixed one did that until the control grew a
              second child: a rejected milestone now carries a Re-submit button
              beside its badge, which is wider than 6rem, and `shrink-0` plus
              `justify-end` sent the overflow left — straight over the anchor
              badge next to it. A minimum keeps the alignment for every row that
              fits and lets the one that does not push the row out instead of
              painting on its neighbour. On the stacked phone row nothing lines
              up with anything, so the minimum would only be dead width.
            */}
            <RowControl className="justify-end @md:min-w-24">
              {statusControl ?? (
                <StatusBadge state={MILESTONE_STATUS[milestone.status]} dot={false} />
              )}
            </RowControl>
          </div>
        </div>

        {actions ? <RowControl>{actions}</RowControl> : null}
      </div>

      {/*
        The one place a desktop row is allowed a second line.

        Spec §Density says one line per row, and every other row here obeys it
        from `@md` up. This is the exception the tester round bought: a
        rejection whose reason is one click away is a rejection people do not
        read, and four of twenty said they were left guessing what they had done
        wrong. The reason is the row's most important content the moment it
        exists, so it renders where the eye already is. Only for a rejection,
        only the newest one, and clamped to two lines so a long note cannot turn
        a list into an essay.
      */}
      {milestone.status === "rejected" && decision?.reason ? (
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          <span className="text-destructive">Rejected</span> by {decision.reviewerName}
          {" — "}
          {decision.reason}
        </p>
      ) : null}
    </ListRow>
  );
}

/**
 * One doqtri plan linked to the project. Read-only here: docs are linked and
 * unlinked from doqtri (D-10), so the row offers the plan itself and nothing
 * to change. The doc URL leaves qdit, so it is a plain anchor in a new tab,
 * not the row's overlay link.
 *
 * Only a URL on doqtri's origin is a link (D-45, `listPlanDocs`); any other
 * shows the title as plain text and says why. The row still names the host
 * a link opens, so what it says and where it goes cannot differ.
 */
export function PlanDocListRow({ doc }: { doc: PlanDocRow }) {
  return (
    <ListRow>
      <div className={LINE}>
        <div className={LINES}>
          {doc.url ? (
            <PlanDocLink title={doc.title} url={doc.url} host={doc.host} />
          ) : (
            // A hint, not `title=`: a native tooltip never shows on a phone,
            // and this one is the only place the row says *why* it is not a
            // link. Focusable so the keyboard can reach the reason too.
            <Hint label="This URL is not on doqtri, so qdit does not link to it.">
              <span
                tabIndex={0}
                className="focus-ring max-w-full min-w-0 shrink truncate rounded-sm font-medium @max-md:self-start"
              >
                {doc.title}
              </span>
            </Hint>
          )}

          <div className={META_LINE}>
            <RowMeta
              className="min-w-0 flex-1"
              items={[
                doc.url ? doc.host : "Not a doqtri link",
                doc.milestoneCount === 1
                  ? "1 linked milestone"
                  : `${doc.milestoneCount} linked milestones`,
                `Linked ${doc.linkedAt.slice(0, 10)}`,
              ]}
            />

            {/* The doc card (WP-2.6): version, proof state and whether doqtri
                still keeps this plan linked. */}
            <RowControl>
              <PlanDocConnectionBadge card={planDocCard(doc)} />
            </RowControl>
          </div>
        </div>
      </div>
    </ListRow>
  );
}

/** The doc title as a link out to doqtri, in a new tab. */
function PlanDocLink({ title, url, host }: { title: string; url: string; host: string }) {
  return (
    <RowControl className="min-w-0 shrink">
      {/* The full address as a hint rather than `title=`, which a phone never
          shows. `break-all` because a URL has no spaces to wrap at. */}
      <Hint label={url} className="break-all">
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="transition-qdit flex min-w-0 items-center gap-1.5 font-medium hover:underline"
        >
          <span className="truncate">{title}</span>
          <ICON.external aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          <span className="sr-only">{host ? `(opens ${host} in a new tab)` : "(opens in a new tab)"}</span>
        </a>
      </Hint>
    </RowControl>
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
        <div className={LINES}>
          <span className="min-w-0 truncate @md:flex-[2]">{proof.notes ?? "Proof record"}</span>

          <div className={META_LINE}>
            {/* On the stacked row too: the second line has room for it. */}
            <RowMeta
              className="min-w-0 flex-1 @md:hidden @2xl:block"
              items={[
                showProject ? proof.projectName : null,
                proof.milestoneTitle,
                proof.authorName,
                proof.createdAt.slice(0, 10),
              ]}
            />

            {/* Who signed it, next to what they signed. Widest containers only
                — two hash pills side by side is the most this row can carry,
                so the signer is the first thing to go when the panel narrows.
                Labelled because an unlabelled strkey reads as another tx
                hash. */}
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
          </div>
        </div>

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
        <div className={LINES}>
          <span className="min-w-0 truncate @md:flex-[2]">
            {deployment.releaseNotes ?? "Deployment"}
          </span>

          <div className={META_LINE}>
            {/* On the stacked row too: the second line has room for it. */}
            <RowMeta
              className="min-w-0 flex-1 @md:hidden @2xl:block"
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

            {/* A reserved column so the badges line up — from `@md` only. At
                375px its 9rem was most of the line and pushed the row wider
                than the screen. */}
            <span className="flex shrink-0 justify-end @md:w-36">
              <StatusBadge state={DEPLOYMENT_STATUS[deployment.status]} dot={false} />
            </span>
          </div>
        </div>

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
    // The name as a hint rather than `title=`, so a tap on a phone shows it
    // too — the same as the initials chip this stands in for.
    <Hint label={name}>
      {/* Sized to the initials chip it replaces, not to the primitive's
          default — a row is 32–36px and cannot afford the 24px variant. */}
      <Avatar size="sm" role="img" aria-label={name} className={cn("size-5", className)}>
        <AvatarImage src={avatarUrl} alt="" />
        <AvatarFallback className="bg-accent text-[0.625rem] font-medium text-accent-foreground">
          {initials ?? "–"}
        </AvatarFallback>
      </Avatar>
    </Hint>
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

        <div className={LINES}>
          <div className={TITLE_LINE}>
            <span className="min-w-0 flex-1 truncate">{member.name}</span>

            {/* On the title line of the stacked row, since it is what an admin
                came to read; `order` puts it back at the end of the single
                desktop line, after the wallet and the join date. */}
            <StatusBadge
              dot={false}
              state={{ label: role.label, tone: ROLE_TONE[member.role] }}
              className="shrink-0 @md:order-1"
            />
          </div>

          <div className={META_LINE}>
            {/* Shown on the stacked row, where the second line has room, then
                hidden until the single line is wide enough for them again. */}
            {member.walletAddress ? (
              <span className="shrink-0 @md:hidden @2xl:inline">
                <HashLink value={member.walletAddress} kind="account" network={APP_NETWORK} />
              </span>
            ) : null}

            <RowMeta
              className="min-w-0 @md:hidden @md:shrink-0 @lg:block"
              items={[joinedLabel(member.joinedAt)]}
            />
          </div>
        </div>

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
