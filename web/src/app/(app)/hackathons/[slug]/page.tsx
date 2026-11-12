/* eslint-disable @next/next/no-img-element -- thumbnails are short-lived
   signed Storage URLs; next/image would cache them past their expiry. */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Countdown } from "@/components/hackathon/countdown";
import { SubmitForm, type SubmitProject } from "@/components/hackathon/submit-form";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { DEFAULT_DOQTRI_ORIGIN, doqtriOrigin } from "@/lib/doqtri-origin";
import { mindmapLink } from "@/lib/hackathon/mindmap-link";
import { getHackathonPage, type MyEntry, type MyProject } from "@/lib/hackathon/queries";
import {
  canSubmitIn,
  formatManila,
  stateBadge,
  windowState,
  type HackathonWindow,
} from "@/lib/hackathon/window";
import { ICON } from "@/lib/icons";
import { getUser } from "@/lib/supabase/server";

/**
 * The participant's hackathon page (WP-4.7, QDIT-47, D-115, D-116).
 *
 * What the event is, how long is left, and what the caller's team has sent.
 * An entry shows "Received" and nothing more: how entries are assessed is never
 * shown to the people who sent them.
 *
 * Reached by link (`/hackathons/<slug>`), not from the sidebar.
 *
 * `maxDuration` covers the Server Action on this page as well (Next applies a
 * page's value to its actions): the work it starts in `after()` runs inside
 * that budget once "Received" has been sent.
 */
export const maxDuration = 300;

const loadPage = cache(getHackathonPage);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const page = await loadPage((await params).slug);
  return { title: page?.hackathon.name ?? "Hackathon" };
}

/** `DOQTRI_ORIGIN` for the Mindmap link's placeholder; the default when misconfigured (the server still checks). */
function placeholderOrigin(): string {
  try {
    return doqtriOrigin();
  } catch {
    return DEFAULT_DOQTRI_ORIGIN;
  }
}

function snapshotLine(project: MyProject): string | null {
  const latest = project.latestSnapshot;
  if (!latest) return null;
  const notes = `${latest.noteCount} ${latest.noteCount === 1 ? "note" : "notes"}`;
  const base = `doqtri snapshot received: ${notes}, ${formatManila(latest.receivedAt)}.`;
  if (project.entry && project.entry.snapshotId !== latest.id) {
    return `${base} It is newer than your submission. Submit again to include it.`;
  }
  return base;
}

export default async function HackathonPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  // "Submit a project" on the Hackathons index lands here with the dialog open.
  const autoOpen = query.submit === "1";
  const [page, user] = await Promise.all([loadPage(slug), getUser()]);
  if (!page || !user) notFound();
  const userId = user.id;

  const { hackathon, nowMs, projects } = page;
  const event: HackathonWindow = {
    opensAt: hackathon.opensAt,
    closesAt: hackathon.closesAt,
    releasedAt: hackathon.releasedAt,
  };

  const state = windowState(event, nowMs);
  const adminProjects = projects.filter((p) => p.canSubmit);

  // A late pass is per project; the page shows the latest one the caller has.
  const activePasses = projects
    .map((p) => p.latePassUntil)
    .filter((until): until is string => until !== null && windowState(event, nowMs, until) === "late");
  const latePassUntil = activePasses.sort().at(-1) ?? null;
  const shownState = state === "closed" && latePassUntil ? "late" : state;

  const submittable: SubmitProject[] = adminProjects
    .filter((p) => canSubmitIn(windowState(event, nowMs, p.latePassUntil)))
    .map((p) => ({
      id: p.id,
      name: p.name,
      members: p.members,
      doqtriStatus: snapshotLine(p),
      snapshotMindmapUrl: p.latestSnapshot?.mindmapUrl ?? null,
      entry: p.entry
        ? {
            teamName: p.entry.teamName,
            memberIds: p.entry.members.map((m) => m.id),
            images: p.entry.images,
            slidesUrl: p.entry.slidesUrl,
            mindmapUrl: p.entry.mindmapUrl,
            submittedAt: p.entry.lastSubmittedAt,
          }
        : null,
    }));

  const label = adminProjects.some((p) => p.entry) ? "Update submission" : "Add submission to hackathon";

  let disabledReason: string | null = null;
  if (submittable.length === 0) {
    disabledReason =
      state === "not_open"
        ? `Submissions open ${formatManila(hackathon.opensAt)}.`
        : `Submissions closed ${formatManila(hackathon.closesAt)}.`;
  }

  const entries = projects.flatMap((p) => (p.entry ? [{ project: p, entry: p.entry }] : []));
  const teamSize =
    hackathon.teamMin === hackathon.teamMax
      ? `Teams of ${hackathon.teamMin}`
      : `Teams of ${hackathon.teamMin} to ${hackathon.teamMax}`;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={hackathon.name}
        description={hackathon.description ?? undefined}
        meta={<StatusBadge state={stateBadge(shownState, latePassUntil)} />}
        actions={
          adminProjects.length > 0 ? (
            <SubmitForm
              userId={userId}
              hackathonId={hackathon.id}
              teamMin={hackathon.teamMin}
              teamMax={hackathon.teamMax}
              projects={submittable}
              label={label}
              disabledReason={disabledReason}
              autoOpen={autoOpen}
              doqtriOrigin={placeholderOrigin()}
            />
          ) : null
        }
      />

      {/* The window. Reference material, so it sits on the sunken plane; the
          countdown is the one live thing in it. */}
      <div className="well flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-border px-3 py-2.5">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_auto_auto]">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Opens</dt>
            <dd>{formatManila(hackathon.opensAt)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Closes</dt>
            <dd>{formatManila(hackathon.closesAt)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="sr-only">Team size</dt>
            <dd className="text-muted-foreground">{teamSize}</dd>
          </div>
        </dl>
        <Countdown event={event} serverNowMs={nowMs} latePassUntil={latePassUntil} />
      </div>

      {adminProjects.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Only a project&apos;s owner or admin can submit it. To enter, create your team&apos;s
          project in qdit and add your teammates as members, or ask your team&apos;s owner to
          submit.
        </p>
      ) : null}

      <Section
        priority
        className="mt-6"
        icon={ICON.project}
        title="My entry"
        count={entries.length > 1 ? entries.length : undefined}
        empty="No submission yet."
      >
        {entries.map(({ project, entry }) => (
          <EntryCard key={entry.submissionId} project={project} entry={entry} />
        ))}
      </Section>

      <p className="mt-6 text-xs text-muted-foreground">
        {submittable.length > 0
          ? "You can submit again until the window closes. The last submission counts. "
          : null}
        <Link href="/user-guide#hackathon" className="underline-offset-4 hover:text-foreground hover:underline">
          How to submit
        </Link>
      </p>
    </div>
  );
}

function EntryCard({ project, entry }: { project: MyProject; entry: MyEntry }) {
  const latest = project.latestSnapshot;
  const notes = latest ? `${latest.noteCount} ${latest.noteCount === 1 ? "note" : "notes"}` : null;
  const included = latest !== null && entry.snapshotId === latest.id;
  // The version's link, checked against DOQTRI_ORIGIN again (QDIT-66).
  const mindmapUrl = mindmapLink(entry.mindmapUrl);

  return (
    <article className="space-y-3 border-t border-border p-3 first:border-t-0 sm:p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{entry.teamName}</h3>
          <p className="text-xs text-muted-foreground">
            <Link
              href={`/projects/${entry.projectSlug}`}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {entry.projectName}
            </Link>
          </p>
        </div>
        <StatusBadge state={{ label: "Received", tone: "success" }} />
      </header>

      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-xs text-muted-foreground sm:text-sm">Members</dt>
        <dd>
          {entry.members.length > 0
            ? entry.members
                .map((m) => (m.username ? `${m.name} (@${m.username})` : m.name))
                .join(", ")
            : "None"}
        </dd>

        <dt className="text-xs text-muted-foreground sm:text-sm">Submitted</dt>
        <dd>
          {entry.lastSubmittedAt ? formatManila(entry.lastSubmittedAt) : "Not yet"}
          <span className="text-muted-foreground">
            {" "}
            · {entry.versionCount} {entry.versionCount === 1 ? "version" : "versions"}
          </span>
        </dd>

        <dt className="text-xs text-muted-foreground sm:text-sm">Slides</dt>
        <dd className="min-w-0">
          {entry.slidesUrl ? (
            <a
              href={entry.slidesUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="focus-ring block truncate underline underline-offset-2"
            >
              {entry.slidesUrl}
            </a>
          ) : (
            <span className="text-muted-foreground">
              Not in this submission yet. Update the submission to add the link.
            </span>
          )}
        </dd>

        {mindmapUrl ? (
          <>
            <dt className="text-xs text-muted-foreground sm:text-sm">Mindmap</dt>
            <dd className="min-w-0">
              <a
                href={mindmapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring inline-flex items-center gap-1 underline underline-offset-2"
              >
                Open mindmap
                <ICON.external className="size-3.5" aria-hidden />
              </a>
            </dd>
          </>
        ) : null}

        <dt className="text-xs text-muted-foreground sm:text-sm">doqtri snapshot</dt>
        <dd>
          {latest ? (
            <>
              {notes}, received {formatManila(latest.receivedAt)}
              {included ? null : (
                <span className="block text-xs text-muted-foreground">
                  {entry.snapshotId
                    ? "A newer snapshot arrived after this submission. Update the submission to include it."
                    : "Not in this submission yet. Update the submission to include it."}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">
              None yet. In doqtri, open the global mindmap and use Send to qdit hackathon.
            </span>
          )}
        </dd>
      </dl>

      {entry.images.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2" aria-label="Mindmap images">
          {entry.images.map((image, index) => {
            const name = index === 0 ? "Global mindmap" : `Note map ${index}`;
            return (
              <li key={image.path} className="space-y-1">
                {image.url ? (
                  <a
                    href={image.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="well focus-ring block aspect-[4/3] overflow-hidden rounded-lg border border-border"
                  >
                    <img src={image.url} alt={name} className="size-full object-contain" loading="lazy" />
                  </a>
                ) : (
                  <div className="well grid aspect-[4/3] place-items-center rounded-lg border border-border text-xs text-muted-foreground">
                    Unavailable
                  </div>
                )}
                <p className="truncate text-xs text-muted-foreground">{name}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}
