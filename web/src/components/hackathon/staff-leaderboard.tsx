import Link from "next/link";

import { Hint } from "@/components/hint";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeaderboardView } from "@/lib/hackathon/staff-queries";
import { FLAG_LABEL } from "@/lib/hackathon/staff-view";
import { CRITERION_KEYS, type CriterionKey } from "@/lib/hackathon/types";
import { ICON } from "@/lib/icons";

const CRITERION_SHORT: Record<CriterionKey, string> = {
  clarity: "Cla",
  structure: "Str",
  accuracy: "Acc",
  connections: "Con",
  execution: "Exe",
};

const CRITERION_NAME: Record<CriterionKey, string> = {
  clarity: "Clarity",
  structure: "Structure",
  accuracy: "Accuracy",
  connections: "Connections",
  execution: "Execution",
};

function fixed(x: number | null, digits = 2): string {
  return x == null ? "—" : x.toFixed(digits);
}

/**
 * The released results (WP-4.7, D-116, D-119), admins only, in rankFinal's
 * order: finalists by judges' mean, then everyone eligible by AI total,
 * then the ineligible, unranked. Rendered only after release; before it the
 * page never asks for these rows.
 */
export function StaffLeaderboard({ slug, rows }: { slug: string; rows: LeaderboardView[] }) {
  const manipulated = rows.filter((r) => r.flags.includes("manipulation"));

  return (
    <div>
      {manipulated.length > 0 ? (
        <div role="alert" className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <ICON.error aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-semibold">Possible manipulation.</span> The AI review flagged{" "}
            {manipulated.map((r) => r.team_name).join(", ")} for trying to steer the grader. Read the
            submission before it goes on a slide.
          </p>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-right">#</TableHead>
            <TableHead>Team</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Eligible</TableHead>
            <TableHead className="text-right">AI /100</TableHead>
            {CRITERION_KEYS.map((key) => (
              <TableHead key={key} className="text-right">
                <abbr title={`${CRITERION_NAME[key]} (0-10)`} className="no-underline">
                  {CRITERION_SHORT[key]}
                </abbr>
              </TableHead>
            ))}
            <TableHead className="text-right">
              <abbr title="Spread: highest minus lowest run total" className="no-underline">
                Spread
              </abbr>
            </TableHead>
            <TableHead>Flags</TableHead>
            <TableHead>Finalist</TableHead>
            <TableHead className="text-right">Judges /25</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.submission_id} className={r.flags.includes("manipulation") ? "bg-destructive/5" : undefined}>
              <TableCell className="text-right font-medium tabular-nums">{r.final_rank ?? "—"}</TableCell>
              <TableCell className="max-w-48 truncate">
                <Link
                  className="transition-qdit hover:text-primary"
                  href={`/hackathons/${slug}/admin/submissions/${r.submission_id}`}
                >
                  {r.team_name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{r.project_slug}</TableCell>
              <TableCell>
                <StatusBadge state={r.eligible ? { label: "Yes", tone: "success" } : { label: "No", tone: "neutral" }} />
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">{fixed(r.ai_total)}</TableCell>
              {CRITERION_KEYS.map((key) => (
                <TableCell key={key} className="text-right text-muted-foreground tabular-nums">
                  {fixed(r.ai_criteria?.[key] ?? null, 1)}
                </TableCell>
              ))}
              <TableCell className="text-right tabular-nums">
                <Hint label={`${r.run_count} counted run${r.run_count === 1 ? "" : "s"}; mean of totals ${fixed(r.ai_mean)}`}>
                  <button type="button" className="focus-ring rounded-md">
                    {fixed(r.spread)}
                  </button>
                </Hint>
              </TableCell>
              <TableCell>
                <div className="flex max-w-64 flex-wrap gap-1">
                  {r.flags.map((flag) => (
                    <StatusBadge
                      key={flag}
                      dot={false}
                      state={{
                        label: FLAG_LABEL[flag],
                        tone: flag === "manipulation" ? "destructive" : flag === "disagreement" ? "warning" : "neutral",
                      }}
                      className={flag === "manipulation" ? "font-semibold" : undefined}
                    />
                  ))}
                </div>
              </TableCell>
              <TableCell>
                {r.finalist ? (
                  <StatusBadge
                    state={{ label: r.pitch_order ? `Finalist · pitch ${r.pitch_order}` : "Finalist", tone: "accent" }}
                  />
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.judge_mean == null ? "—" : fixed(r.judge_mean)}
                <span className="ml-1 text-xs text-muted-foreground">
                  ({r.judge_count} judge{r.judge_count === 1 ? "" : "s"})
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
