import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StaffPlainText } from "@/components/hackathon/staff-plain-text";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { MILESTONE_STATUS, TASK_PRIORITY, TASK_STATUS } from "@/lib/constants";
import { MINDMAP_LINK_DEAD, mindmapLinkView } from "@/lib/hackathon/mindmap-link";
import { checkMindmapLinks, statusOf } from "@/lib/hackathon/mindmap-link-status";
import { getStaffHackathon, getStaffRole, loadSubmissionView } from "@/lib/hackathon/staff-queries";
import { formatManila, groupTasksByStatus, toPlainText } from "@/lib/hackathon/staff-view";
import { ICON } from "@/lib/icons";
import { createClient, getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Submission" };

/** How many mindmap labels are listed before the rest are counted. */
const LABEL_LIMIT = 300;

/**
 * One entry as it was frozen at submit (WP-4.7, QDIT-48; D-115, Q-15):
 * the qdit snapshot (board, milestones, members, proofs), the doqtri notes
 * and global mindmap counts, and the uploaded images.
 *
 * Staff only, judges included; anyone else gets a 404. Never a score: this
 * page selects no grade, eligibility or override column. Team content is
 * printed as text (StaffPlainText, React-escaped), never as markdown or HTML,
 * and images come through 5-minute signed URLs made under the viewer's
 * session.
 */
export default async function HackathonSubmissionPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const user = await getUser();
  if (!user) notFound();

  const supabase = await createClient();
  const hackathon = await getStaffHackathon(supabase, slug);
  if (!hackathon) notFound();
  const role = await getStaffRole(supabase, hackathon.id, user.id);
  if (!role) notFound();

  const view = await loadSubmissionView(supabase, hackathon.id, id);
  if (!view) notFound();

  const { qdit, doqtri } = view;
  const people = new Map(qdit.members.map((m) => [m.user_id, m]));
  const personName = (userId: string | null) => {
    if (!userId) return null;
    const m = people.get(userId);
    return m ? (m.username ? `@${m.username}` : (m.display_name ?? userId.slice(0, 8))) : userId.slice(0, 8);
  };
  const columns = groupTasksByStatus(qdit.tasks);
  const team = new Set(view.member_ids);
  // The version's link, so it outlives the snapshot; checked against DOQTRI_ORIGIN again (QDIT-66),
  // and shown as a link only while doqtri does not say it is dead (QDIT-67, one call, at most 2 s).
  const statuses = await checkMindmapLinks([view.mindmap_url]);
  const mindmap = mindmapLinkView(view.mindmap_url, statusOf(statuses, view.mindmap_url));
  const mindmapUrl = mindmap.kind === "link" ? mindmap.url : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Hackathons", href: "/hackathons" }, { label: hackathon.name, href: `/hackathons/${slug}` },
          ...(role === "admin" ? [{ label: "Admin", href: `/hackathons/${slug}/admin` }] : [{ label: "Judging", href: `/hackathons/${slug}/judge` }]),
        ]}
        title={toPlainText(view.team_name, 80)}
        info="The entry exactly as frozen when the team submitted. Team content is shown as plain text."
        meta={
          <span className="text-xs text-muted-foreground">
            Version {view.version_no} · submitted {formatManila(view.submitted_at)} · project {qdit.project.slug}
            {qdit.truncated ? " · snapshot truncated" : ""}
            {view.slides_url ? "" : " · no slides link"}
          </span>
        }
        actions={
          view.slides_url || mindmap.kind !== "none" ? (
            <>
              {mindmap.kind === "dead" ? (
                <span className="self-center text-xs text-muted-foreground">{MINDMAP_LINK_DEAD}</span>
              ) : null}
              {mindmapUrl ? (
                <Button asChild size="sm" variant="outline">
                  <a href={mindmapUrl} target="_blank" rel="noopener noreferrer">
                    <ICON.external data-icon="inline-start" />
                    Open mindmap
                  </a>
                </Button>
              ) : null}
              {view.slides_url ? (
                // Only a link hackathon_slides_url_ok() accepted reaches here: https, on a known host.
                <Button asChild size="sm" variant="outline">
                  <a href={view.slides_url} target="_blank" rel="noreferrer noopener">
                    <ICON.external data-icon="inline-start" />
                    Open slides
                  </a>
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <Section priority icon={ICON.board} title="Board" count={qdit.tasks.length} empty="No cards.">
        {qdit.tasks.length > 0
          ? [
              <div key="board" className="grid gap-3 p-3 md:grid-cols-3">
                {columns.map((col) => (
                  <div key={col.status} className="well rounded-lg p-2">
                    <h3 className="mb-1.5 px-1 text-xs font-semibold text-muted-foreground">
                      {TASK_STATUS[col.status as keyof typeof TASK_STATUS]?.label ?? toPlainText(col.status, 40)} ·{" "}
                      {col.tasks.length}
                    </h3>
                    <ul className="space-y-1.5">
                      {col.tasks.map((task) => {
                        const priority = TASK_PRIORITY[task.priority as keyof typeof TASK_PRIORITY];
                        return (
                          <li key={task.id} className="surface rounded-md border border-border px-2 py-1.5 text-sm">
                            <p className="break-words">{toPlainText(task.title, 500)}</p>
                            <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                              <span>{personName(task.assignee_id) ?? "No owner"}</span>
                              <span>{priority ? priority.short : "No priority"}</span>
                              <span>{task.due_date ? `Due ${task.due_date}` : "No due date"}</span>
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>,
            ]
          : []}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section icon={ICON.milestone} title="Milestones" count={qdit.milestones.length} empty="No milestones.">
          {qdit.milestones.map((m) => (
            <div key={m.id} className="flex min-h-9 items-center gap-3 border-b border-border px-3 py-1.5 text-sm last:border-0">
              <span className="min-w-0 flex-1 truncate">{toPlainText(m.title, 300)}</span>
              {m.status && m.status in MILESTONE_STATUS ? (
                <StatusBadge state={MILESTONE_STATUS[m.status as keyof typeof MILESTONE_STATUS]} />
              ) : null}
              <span className="text-xs text-muted-foreground">{m.due_date ?? "—"}</span>
            </div>
          ))}
        </Section>

        <Section icon={ICON.members} title="Members" count={qdit.members.length} empty="No members.">
          {qdit.members.map((m) => (
            <div key={m.user_id} className="flex min-h-9 items-center gap-3 border-b border-border px-3 py-1.5 text-sm last:border-0">
              <span className="min-w-0 flex-1 truncate">
                {m.username ? `@${m.username}` : m.user_id.slice(0, 8)}
                {m.display_name ? <span className="ml-2 text-muted-foreground">{toPlainText(m.display_name, 120)}</span> : null}
              </span>
              <span className="text-xs text-muted-foreground">{m.role}</span>
              {team.has(m.user_id) ? <StatusBadge dot={false} state={{ label: "On team", tone: "accent" }} /> : null}
            </div>
          ))}
        </Section>
      </div>

      <Section icon={ICON.proof} title="Proofs" count={qdit.proofs.length} empty={`No proofs. ${qdit.anchors} milestone anchors.`}>
        {qdit.proofs.map((p) => (
          <div key={p.id} className="space-y-1 border-b border-border px-3 py-2 text-sm last:border-0">
            <p className="flex flex-wrap gap-x-3 font-mono text-xs">
              <span>{p.network ?? "—"}</span>
              {p.tx_hash ? <span className="break-all">tx {toPlainText(p.tx_hash, 200)}</span> : null}
              {p.contract_id ? <span className="break-all">contract {toPlainText(p.contract_id, 200)}</span> : null}
            </p>
            {p.proof_url ? <p className="break-all text-xs text-muted-foreground">{toPlainText(p.proof_url, 500)}</p> : null}
            {p.notes ? <StaffPlainText value={p.notes} className="max-h-32" /> : null}
          </div>
        ))}
      </Section>

      <Section icon={ICON.planDoc} title="Mindmap images" count={view.images.length} empty="No images.">
        {view.images.length > 0
          ? [
              <div key="images" className="grid gap-3 p-3 md:grid-cols-3">
                {view.images.map((img) => (
                  <figure key={img.path} className="space-y-1">
                    {img.url ? (
                      <a href={img.url} target="_blank" rel="noreferrer noopener">
                        {/* A short-lived signed URL; next/image would cache it past its life. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt={img.label}
                          className="well max-h-80 w-full rounded-lg object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </a>
                    ) : (
                      <p className="well rounded-lg px-3 py-8 text-center text-xs text-muted-foreground">Image unavailable</p>
                    )}
                    <figcaption className="text-xs text-muted-foreground">{img.label}</figcaption>
                  </figure>
                ))}
              </div>,
            ]
          : []}
      </Section>

      <Section
        icon={ICON.planDoc}
        title="doqtri notes"
        count={doqtri?.notes.length ?? 0}
        empty={doqtri ? "The snapshot holds no notes." : "No doqtri snapshot was attached to this version."}
      >
        {(doqtri?.notes ?? []).map((note) => (
          <article key={note.doc_id} className="space-y-1.5 border-b border-border px-3 py-3 last:border-0">
            <h3 className="text-sm font-semibold break-words">{toPlainText(note.title, 300) || "(untitled)"}</h3>
            <p className="text-xs text-muted-foreground">
              Created {formatManila(note.created_at)}
              {note.source ? ` · ${toPlainText(note.source, 20)}` : ""}
            </p>
            <StaffPlainText value={note.markdown} />
          </article>
        ))}
      </Section>

      {doqtri ? (
        <Section icon={ICON.planDoc} title="Global mindmap" empty="">
          <div className="space-y-2 px-3 py-3 text-sm">
            <p>
              <span className="font-medium tabular-nums">{doqtri.nodeCount}</span> nodes ·{" "}
              <span className="font-medium tabular-nums">{doqtri.linkCount}</span> links
              {view.doqtri_received_at ? (
                <span className="text-muted-foreground"> · received {formatManila(view.doqtri_received_at)}</span>
              ) : null}
            </p>
            {doqtri.labels.length > 0 ? (
              <ul className="well flex max-h-64 flex-wrap gap-1 overflow-auto rounded-lg p-2 text-xs">
                {doqtri.labels.slice(0, LABEL_LIMIT).map((label) => (
                  <li key={label} className="surface rounded border border-border px-1.5 py-0.5 break-all">
                    {toPlainText(label, 200)}
                  </li>
                ))}
                {doqtri.labels.length > LABEL_LIMIT ? (
                  <li className="px-1.5 py-0.5 text-muted-foreground">+{doqtri.labels.length - LABEL_LIMIT} more</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
