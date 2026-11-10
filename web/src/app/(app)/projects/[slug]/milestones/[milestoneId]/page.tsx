import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FromDoqtriBadge } from "@/components/doqtri-doc-card";
import { MilestoneRowActions, TaskRowActions, ProofRowActions } from "@/components/entity-row-actions";
import { CreateProofDialog } from "@/components/entity-dialogs";
import { AnchorBadge } from "@/components/milestone-anchor";
import { MilestoneStatusMenu } from "@/components/milestone-status-menu";
import { MilestoneTimeline } from "@/components/milestone-timeline";
import { PageHeader } from "@/components/page-header";
import { ProofListRow, TaskListRow } from "@/components/rows";
import { Section } from "@/components/section";
import { ShareLinkField } from "@/components/share-link";
import { DisabledReason, Hint, InfoBubble } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { milestoneDocCard } from "@/lib/doqtri-doc-card";
import { EMPTY_FILTERS } from "@/lib/filters";
import { ICON } from "@/lib/icons";
import {
  canContribute,
  canEditProof,
  getCurrentUserId,
  getMilestone,
  getProject,
  getProjectRole,
  listMilestoneOptions,
  listProjectMembers,
  listProofs,
  listTasks,
} from "@/lib/queries";
import { NETWORK_LABELS } from "@/lib/stellar";
import { cn } from "@/lib/utils";

/** Anchoring is off unless this deployment names a contract. */
const ANCHORING = Boolean(process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID);

/**
 * A 24px heading button is a 44px target under a finger: the hit area grows
 * through a pseudo-element, so the heading line itself stays its desktop height
 * (spec §Density: increase the hit area, never pad).
 */
const COARSE_HIT =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-2.5";

type Params = Promise<{ slug: string; milestoneId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, milestoneId } = await params;
  const project = await getProject(slug);
  const milestone = project ? await getMilestone(project.id, milestoneId) : null;
  return { title: milestone?.title ?? "Milestone" };
}

/**
 * One milestone, everything about it, on one page (QDIT-34).
 *
 * Before this there was no milestone page at all: its proofs were four clicks
 * away through a filter, its history and certificate sat in a dialog behind a
 * hover-only menu, and its public link in another dialog. Every one of those
 * is now on this page, and this page is one click from any milestone row —
 * the dashboard, the overview, both milestone lists and a notification.
 *
 * Order follows the question a reader brings: where is it (status, progress,
 * chain), can I show it to someone (public link, certificate), what is in it
 * (tasks, proof), and how did it get here (history).
 */
export default async function MilestonePage({ params }: { params: Params }) {
  const { slug, milestoneId } = await params;
  const project = await getProject(slug);
  if (!project) notFound();

  const milestone = await getMilestone(project.id, milestoneId);
  if (!milestone) notFound();

  const scoped = { ...EMPTY_FILTERS, milestone: [milestone.id], limit: 50 };
  const [tasks, proofs, role, userId, milestoneOptions, members] = await Promise.all([
    listTasks({ projectId: project.id }, scoped),
    listProofs({ projectId: project.id }, scoped),
    getProjectRole(project.id),
    getCurrentUserId(),
    listMilestoneOptions(project.id),
    listProjectMembers(project.id),
  ]);

  const canEdit = canContribute(role);
  const isOwner = project.ownerId === userId;
  const registered = Boolean(milestone.chainContractId);
  const anchored = milestone.anchors.length > 0;
  const pct = Math.round(milestone.progress * 100);
  const certificateHref = `/api/export/certificate?project=${slug}&milestone=${milestone.id}`;
  const memberOptions = members.map((member) => ({ id: member.id, name: member.name }));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${slug}` },
          { label: "Milestones", href: `/projects/${slug}/milestones` },
        ]}
        title={milestone.title}
        meta={
          <>
            <MilestoneStatusMenu
              milestoneId={milestone.id}
              status={milestone.status}
              isOwner={isOwner}
              canEdit={canEdit}
            />
            {milestone.link ? (
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
            ) : null}
          </>
        }
        actions={
          <MilestoneRowActions
            milestone={milestone}
            canEdit={canEdit}
            anchoring={ANCHORING}
            isOwner={isOwner}
            persistent
          />
        }
      />

      {milestone.description ? (
        // `wrap-break-word`: a pasted URL has no spaces to wrap at, and at
        // 375px it pushed the whole page sideways.
        <p className="-mt-2 mb-5 max-w-prose text-sm leading-6 wrap-break-word whitespace-pre-line text-muted-foreground">
          {milestone.description}
        </p>
      ) : null}

      {/* The facts, as a definition list: label, value, and the one action
          each fact implies. Two columns on a desktop, one on a phone.

          Keyed to the width the list actually has (`@container` on the
          wrapper — a container cannot query itself), not to the viewport: at
          `sm` a viewport breakpoint split the list into two 300px columns and
          squeezed every value beside its label. Two columns from `@2xl`, where
          each is still wider than 21rem. */}
      <div className="@container">
        <dl className="surface grid overflow-hidden rounded-xl border border-border @2xl:grid-cols-2">
          <Fact icon={ICON.task} label="Progress">
            <span className="tabular-nums">
              {milestone.doneCount}/{milestone.taskCount} tasks
            </span>
            <span
              className="well h-1 w-20 overflow-hidden rounded-full"
              role="progressbar"
              aria-label="Progress"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
            {milestone.dueDate ? (
              <span className="text-xs text-muted-foreground tabular-nums">Due {milestone.dueDate}</span>
            ) : null}
          </Fact>

          {/* Only where this deployment can anchor at all — without a contract
              there is no registration step to point at. */}
          {ANCHORING ? (
          <Fact icon={ICON.anchor} label="On chain">
            {milestone.anchor ? (
              <AnchorBadge anchor={milestone.anchor} stale={milestone.anchorStale} />
            ) : registered ? (
              <span className="text-muted-foreground">Not anchored</span>
            ) : (
              <Link
                href={`/projects/${slug}#chain`}
                className="transition-qdit inline-flex items-center gap-1.5 text-warning hover:underline"
              >
                <ICON.unregistered aria-hidden className="size-3.5" />
                Project not registered
              </Link>
            )}
            {registered && milestone.chainContractId ? (
              <span className="text-xs text-muted-foreground">
                {NETWORK_LABELS[milestone.network]}
              </span>
            ) : null}
          </Fact>
          ) : null}

          <Fact icon={ICON.public} label="Public link" className="@2xl:col-span-2">
            {milestone.publicProofs ? (
              <ShareLinkField
                projectSlug={slug}
                milestoneId={milestone.id}
                anchored={Boolean(milestone.anchor)}
                anchoring={ANCHORING}
                className="min-w-0 flex-1"
              />
            ) : (
              <Link
                href={`/projects/${slug}#publishing`}
                className="transition-qdit inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline"
              >
                <ICON.private aria-hidden className="size-3.5" />
                Private — publishing is off for this project
              </Link>
            )}
          </Fact>
        </dl>
      </div>

      <Section
        priority
        className="mt-6"
        icon={ICON.task}
        title="Tasks"
        count={tasks.matched}
        // The board filtered to this milestone, so "View all" shows exactly
        // what the count counts — this section lists at most 50.
        href={`/projects/${slug}/board?milestone=${milestone.id}`}
        empty="No tasks in this milestone yet."
      >
        {tasks.rows.map((task) => (
          <TaskListRow
            key={task.id}
            task={task}
            actions={
              <TaskRowActions
                task={task}
                milestones={milestoneOptions}
                members={memberOptions}
                canEdit={canEdit}
              />
            }
          />
        ))}
      </Section>

      <Section
        className="mt-6"
        icon={ICON.proof}
        title="Proof"
        count={proofs.matched}
        href={`/projects/${slug}/proofs?milestone=${milestone.id}`}
        empty="No proof recorded for this milestone yet."
        actions={
          canEdit ? (
            <CreateProofDialog
              projectId={project.id}
              milestones={milestoneOptions}
              defaultMilestoneId={milestone.id}
              size="xs"
            />
          ) : null
        }
      >
        {proofs.rows.map((proof) => (
          <ProofListRow
            key={proof.id}
            proof={proof}
            actions={
              <ProofRowActions
                proof={proof}
                milestones={milestoneOptions}
                canEdit={canEditProof(role, proof.createdBy, userId)}
              />
            }
          />
        ))}
      </Section>

      <Section
        id="history"
        className="mt-6"
        icon={ICON.history}
        title="History"
        count={milestone.anchors.length + milestone.reviews.length}
        empty="Nothing has happened yet — no decisions, nothing anchored."
        info={
          <InfoBubble label="the history">
            <p>
              Every anchor and decision, oldest first. The anchor mark means the
              entry is on the ledger and anyone can check it; the person mark
              means it is recorded in qdit.
            </p>
          </InfoBubble>
        }
        actions={
          anchored ? (
            <Hint label="One file, verifiable against the ledger without qdit">
              <Button asChild variant="outline" size="xs" className={COARSE_HIT}>
                <a href={certificateHref} download>
                  <ICON.certificate data-icon="inline-start" />
                  Certificate
                </a>
              </Button>
            </Hint>
          ) : !ANCHORING ? null : (
            // The wrapper takes the pointer for a disabled button, so it is the
            // one that grows; the negative margin keeps the heading line from
            // growing with it.
            <DisabledReason
              reason="Anchor this milestone first — a certificate of nothing proves nothing."
              className="pointer-coarse:-my-2.5 pointer-coarse:py-2.5"
            >
              <Button variant="outline" size="xs" disabled>
                <ICON.certificate data-icon="inline-start" />
                Certificate
              </Button>
            </DisabledReason>
          )
        }
      >
        {milestone.anchors.length + milestone.reviews.length > 0
          ? [<MilestoneTimeline key="timeline" milestone={milestone} />]
          : []}
      </Section>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  className,
  children,
}: {
  icon: typeof ICON.task;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // Label above value on a phone, beside it from `@sm` — the same wrapper
    // the grid queries. Below `@2xl` a fact is the full width of the list, and
    // from `@2xl` each column is still past 21rem, so `@sm` holds for one fact
    // as well as for the list.
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 border-b border-border/70 px-3 py-2.5 last:border-b-0 @sm:flex-row @sm:items-center @sm:gap-3",
        "@2xl:[&:nth-child(odd):not(:last-child)]:border-r",
        className,
      )}
    >
      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">{children}</dd>
    </div>
  );
}
