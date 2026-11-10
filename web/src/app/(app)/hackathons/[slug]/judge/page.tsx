import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StaffJudgeForm } from "@/components/hackathon/staff-judge-form";
import { EmptyState, PageHeader } from "@/components/page-header";
import { getStaffHackathon, getStaffRole, loadJudgeConsole } from "@/lib/hackathon/staff-queries";
import { JUDGE_COPY, toPlainText } from "@/lib/hackathon/staff-view";
import { ICON } from "@/lib/icons";
import { createClient, getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Judging" };

/**
 * The judges' console (WP-4.7, QDIT-48; D-119). Judges and admins only;
 * anyone else gets a 404.
 *
 * Before release there is nothing to judge. After it, the finalists in pitch
 * order (hackathon_finals_for_judge), each with the slide's five 1-5
 * criteria and a note. A judge sees only their own saved score: never
 * another judge's, and never an AI score or rank.
 */
export default async function HackathonJudgePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getUser();
  if (!user) notFound();

  const supabase = await createClient();
  const hackathon = await getStaffHackathon(supabase, slug);
  if (!hackathon) notFound();
  const role = await getStaffRole(supabase, hackathon.id, user.id);
  if (!role) notFound();

  const header = (
    <PageHeader
      breadcrumb={[{ label: "Hackathons", href: "/hackathons" }, { label: hackathon.name, href: `/hackathons/${slug}` }]}
      title="Judging"
      info="Score each finalist from 1 to 5 on Clarity, Structure, Accuracy, Connections and Pitch. Only you see your scores; the final order is the judges' mean."
    />
  );

  if (hackathon.released_at == null) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <EmptyState icon={ICON.locked} title={JUDGE_COPY.beforeRelease} description={JUDGE_COPY.beforeReleaseDetail} />
      </div>
    );
  }

  const { finalists, mine } = await loadJudgeConsole(supabase, hackathon.id, user.id);

  return (
    <div className="mx-auto max-w-3xl">
      {header}
      {finalists.length === 0 ? (
        <EmptyState icon={ICON.members} title="No finalists" description="No entry qualified for the finals." />
      ) : (
        <ol className="space-y-4">
          {finalists.map((f, i) => (
            <li key={f.submission_id} className="surface rounded-xl border border-border px-4 py-3">
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xs text-muted-foreground tabular-nums">Pitch {f.pitch_order ?? i + 1}</span>
                <h2 className="text-base font-semibold">{toPlainText(f.team_name, 80)}</h2>
                <span className="text-xs text-muted-foreground">{f.project_slug}</span>
                <Link
                  href={`/hackathons/${slug}/admin/submissions/${f.submission_id}`}
                  className="transition-qdit ml-auto text-xs text-muted-foreground hover:text-primary"
                >
                  View submission
                </Link>
              </div>
              <StaffJudgeForm
                submissionId={f.submission_id}
                teamName={f.team_name}
                saved={mine[f.submission_id] ?? null}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
