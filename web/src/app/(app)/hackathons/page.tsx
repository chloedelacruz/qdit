import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { loadHackathonOverview, type OverviewHackathon } from "@/lib/hackathon/overview";
import { toPlainText } from "@/lib/hackathon/staff-view";
import { formatManila, stateBadge, windowState } from "@/lib/hackathon/window";
import { ICON } from "@/lib/icons";
import { createClient, getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Hackathons" };

/**
 * Every hackathon, with the way in for whoever is looking (WP-4.7, QDIT-50).
 *
 * Admins and judges see each of their hackathons' submissions, newest first,
 * each one linking to the staff view; admins also get the console. Everyone
 * else sees the hackathon, its window and their own team. Nothing graded is
 * read here: grades stay on the admin console, sealed until release.
 */
export default async function HackathonsPage() {
  const [user, supabase] = await Promise.all([getUser(), createClient()]);
  // The (app) layout already redirects signed-out visitors.
  const { hackathons, nowMs: now, canSubmit, canManage } = user
    ? await loadHackathonOverview(supabase, user.id)
    : { hackathons: [], nowMs: 0, canSubmit: false, canManage: false };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Hackathons"
        info="Events you can enter or run. Admins and judges see every submission to the hackathons they staff."
        actions={
          canManage ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/hackathons/manage">
                <ICON.settings data-icon="inline-start" />
                Manage hackathons
              </Link>
            </Button>
          ) : null
        }
      />

      {hackathons.length === 0 ? (
        <EmptyState
          icon={ICON.hackathon}
          title="No hackathons yet"
          description="When organisers open one, it shows up here."
        />
      ) : (
        hackathons.map((h) => <HackathonCard key={h.id} h={h} now={now} canSubmit={canSubmit} />)
      )}
    </div>
  );
}

function HackathonCard({ h, now, canSubmit }: { h: OverviewHackathon; now: number; canSubmit: boolean }) {
  const state = windowState({ opensAt: h.opensAt, closesAt: h.closesAt, releasedAt: h.releasedAt }, now);
  const base = `/hackathons/${h.slug}`;
  // One click to the submit dialog: a project owner or admin, while it is
  // open. Staff can't be on a team (member_is_staff), so they don't get it.
  // A per-project late pass still works from the event page itself.
  const showSubmit = canSubmit && !h.role && state === "open";

  return (
    <section aria-labelledby={`h-${h.id}`} className="surface rounded-xl border border-border">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`h-${h.id}`} className="text-base font-semibold">
              <Link href={base} className="transition-qdit focus-ring rounded-sm hover:text-primary">
                {toPlainText(h.name, 200)}
              </Link>
            </h2>
            <StatusBadge state={stateBadge(state)} />
            {h.releasedAt ? <StatusBadge state={{ label: "Grades released", tone: "success" }} /> : null}
            {h.unlisted ? <StatusBadge dot={false} state={{ label: "Hidden", tone: "neutral" }} /> : null}
            {h.role ? (
              <StatusBadge dot={false} state={{ label: h.role === "admin" ? "Admin" : "Judge", tone: "accent" }} />
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatManila(h.opensAt)} – {formatManila(h.closesAt)}
          </p>
          {h.myTeam ? (
            <p className="mt-1 text-sm">
              Your team: <span className="font-medium">{toPlainText(h.myTeam, 80)}</span>
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={base}>{h.role ? "Event page" : "Open"}</Link>
          </Button>
          {showSubmit ? (
            <Button asChild size="sm">
              <Link href={`${base}?submit=1`}>
                <ICON.send data-icon="inline-start" />
                {h.myTeam ? "Update submission" : "Submit a project"}
              </Link>
            </Button>
          ) : null}
          {h.role ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`${base}/judge`}>Judging</Link>
            </Button>
          ) : null}
          {h.role === "admin" ? (
            <Button asChild size="sm">
              <Link href={`${base}/admin`}>Admin console</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {h.submissions ? (
        <div className="border-t border-border">
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <h3 className="text-sm font-semibold">
              Submissions
              <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
                {h.submissions.length}
              </span>
            </h3>
          </div>
          {h.submissions.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">No submissions yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {h.submissions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`${base}/admin/submissions/${s.id}`}
                    className="transition-qdit focus-ring group flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-sidebar-accent/45"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium group-hover:text-primary">
                      {toPlainText(s.teamName, 80)}
                    </span>
                    <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                      {s.versions === 1 ? "1 version" : `${s.versions} versions`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.lastSubmittedAt ? formatManila(s.lastSubmittedAt) : ""}
                    </span>
                    <ICON.chevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
