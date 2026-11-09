"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/form-dialog";
import { DisabledReason } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { releaseGrades, type StaffActionState } from "@/lib/hackathon/staff-actions";
import { formatDuration, formatManila, type JobStatus } from "@/lib/hackathon/staff-view";
import { ICON } from "@/lib/icons";

/** The copy the release panel and its dialog use, exported so the report and tests quote the same words. */
export const RELEASE_COPY = {
  warning:
    "Releasing is permanent. It unseals every AI grade for this hackathon's admins, fixes the top finalists, and cannot be undone or redone.",
  sealed: "Grades are sealed until release.",
  beforeClose: "Release opens when the hackathon closes.",
  confirmHint: "Type the hackathon's slug to confirm.",
  allowIncomplete:
    "Release anyway. Entries still pending or running are ranked without the runs that have not finished, and may miss the finals.",
} as const;

/**
 * Release grades (WP-4.7, D-116). Counts of runs still pending, running and
 * failed; the time to close, ticking; the button disabled until closes_at.
 * The confirm dialog wants the slug typed and offers "allow incomplete" only
 * once the server said grading_incomplete.
 */
export function StaffReleasePanel({
  hackathonId,
  slug,
  closesAt,
  serverNow,
  counts,
  entries,
}: {
  hackathonId: string;
  slug: string;
  closesAt: string;
  /** The server's clock at render, so the first paint matches and never trusts a skewed client alone. */
  serverNow: number;
  counts: Record<JobStatus, number>;
  entries: number;
}) {
  const closes = Date.parse(closesAt);
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    // Offset the client clock by the skew seen at hydration.
    const skew = serverNow - Date.now();
    const id = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(id);
  }, [serverNow]);
  const closed = now >= closes;

  return (
    <div className="space-y-3 px-4 py-3">
      <p className="text-sm text-muted-foreground">{RELEASE_COPY.sealed}</p>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Entries" value={entries} />
        <Stat label="Runs pending" value={counts.pending} />
        <Stat label="Runs running" value={counts.running} />
        <Stat label="Runs failed" value={counts.failed} tone={counts.failed > 0 ? "warn" : undefined} />
        <Stat label="Runs done" value={counts.done} />
      </dl>

      <p className="text-sm">
        {closed ? (
          <>Closed {formatDuration(now - closes)} ago ({formatManila(closesAt)}).</>
        ) : (
          <>
            Closes in <span className="font-medium tabular-nums">{formatDuration(closes - now)}</span> (
            {formatManila(closesAt)}).
          </>
        )}
      </p>

      <p className="flex items-start gap-1.5 text-xs text-destructive">
        <ICON.error aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {RELEASE_COPY.warning}
      </p>

      {closed ? (
        <ReleaseDialog hackathonId={hackathonId} slug={slug} />
      ) : (
        <DisabledReason reason={`${RELEASE_COPY.beforeClose} ${formatManila(closesAt)}.`}>
          <Button variant="destructive" disabled>
            <ICON.locked data-icon="inline-start" />
            Release grades
          </Button>
        </DisabledReason>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="well rounded-lg px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={tone === "warn" ? "text-base font-semibold text-destructive tabular-nums" : "text-base font-semibold tabular-nums"}>
        {value}
      </dd>
    </div>
  );
}

function ReleaseDialog({ hackathonId, slug }: { hackathonId: string; slug: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [allow, setAllow] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: StaffActionState, formData: FormData) => {
      const result = await releaseGrades(prev, formData);
      if (result.ok) {
        setOpen(false);
        toast.success(`Grades released. ${result.finalists ?? 0} finalists.`);
      }
      return result;
    },
    {} as StaffActionState,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setTyped("");
          setAllow(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive">
          <ICON.locked data-icon="inline-start" />
          Release grades
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Release grades for {slug}?</DialogTitle>
          <DialogDescription className="text-destructive">{RELEASE_COPY.warning}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-3.5"
          action={formAction}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => formAction(data));
          }}
        >
          <input type="hidden" name="hackathonId" value={hackathonId} />
          <Field
            id="release-confirm"
            label={`Type ${slug}`}
            hint={RELEASE_COPY.confirmHint}
            error={state.fieldErrors?.confirmSlug}
          >
            <Input
              id="release-confirm"
              name="confirmSlug"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>

          {state.needsAllowIncomplete ? (
            <div className="flex items-start gap-2">
              {/* Posted by hand rather than through Radix's bubble input, so the contract is visible. */}
              {allow ? <input type="hidden" name="allowIncomplete" value="on" /> : null}
              <Checkbox
                id="release-allow"
                checked={allow}
                onCheckedChange={(v) => setAllow(v === true)}
              />
              <Label htmlFor="release-allow" className="text-xs leading-5 font-normal">
                {RELEASE_COPY.allowIncomplete}
              </Label>
            </div>
          ) : null}

          {state.error ? (
            <p role="alert" className="text-xs text-destructive">
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || typed.trim() !== slug}
            >
              {pending ? <ICON.spinner className="animate-spin" data-icon="inline-start" /> : null}
              Release permanently
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
