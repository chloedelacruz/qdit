"use client";

import { startTransition, useActionState, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveJudgeScore, type StaffActionState } from "@/lib/hackathon/staff-actions";
import { JUDGE_CRITERIA } from "@/lib/hackathon/types";
import { ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

type Criterion = (typeof JUDGE_CRITERIA)[number];

const CRITERION_LABEL: Record<Criterion, string> = {
  clarity: "Clarity",
  structure: "Structure",
  accuracy: "Accuracy",
  connections: "Connections",
  pitch: "Pitch",
};

const POINTS = [1, 2, 3, 4, 5] as const;

export interface JudgeFormScore {
  clarity: number;
  structure: number;
  accuracy: number;
  connections: number;
  pitch: number;
  note: string | null;
}

/**
 * One judge's score for one finalist (WP-4.7, D-119): 1 to 5 on each of the
 * slide's five criteria, an optional note, saved with upsert_judge_score.
 * Shows only the judge's own saved score; nobody else's, and no AI score.
 */
export function StaffJudgeForm({
  submissionId,
  teamName,
  saved,
}: {
  submissionId: string;
  teamName: string;
  saved: JudgeFormScore | null;
}) {
  const [values, setValues] = useState<Partial<Record<Criterion, number>>>(() =>
    saved
      ? Object.fromEntries(JUDGE_CRITERIA.map((k) => [k, saved[k]]))
      : {},
  );
  const [state, formAction, pending] = useActionState(
    async (prev: StaffActionState, formData: FormData) => {
      const result = await saveJudgeScore(prev, formData);
      if (result.ok) toast.success(`Saved your score for ${teamName}.`);
      return result;
    },
    {} as StaffActionState,
  );
  const total = JUDGE_CRITERIA.every((k) => values[k] != null)
    ? JUDGE_CRITERIA.reduce((sum, k) => sum + (values[k] ?? 0), 0)
    : null;

  return (
    <form
      noValidate
      className="space-y-3"
      action={formAction}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <input type="hidden" name="submissionId" value={submissionId} />
      {JUDGE_CRITERIA.map((key) => {
        return (
          <fieldset key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <legend className="sr-only">{CRITERION_LABEL[key]}, 1 to 5</legend>
            <span aria-hidden className="w-24 text-sm">
              {CRITERION_LABEL[key]}
            </span>
            <input type="hidden" name={key} value={values[key] ?? ""} />
            <div role="radiogroup" aria-label={CRITERION_LABEL[key]} className="flex gap-1">
              {POINTS.map((p) => {
                const selected = values[key] === p;
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${CRITERION_LABEL[key]} ${p}`}
                    onClick={() => setValues((v) => ({ ...v, [key]: p }))}
                    className={cn(
                      "focus-ring transition-qdit grid size-8 place-items-center rounded-md border text-sm tabular-nums pointer-coarse:size-11",
                      selected
                        ? "border-primary bg-accent font-semibold text-accent-foreground"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
            {state.fieldErrors?.[key] ? (
              <span className="text-xs text-destructive">{state.fieldErrors[key]}</span>
            ) : null}
          </fieldset>
        );
      })}

      <div className="space-y-1.5">
        <Label htmlFor={`note-${submissionId}`}>
          Note <span className="font-normal text-muted-foreground">Optional</span>
        </Label>
        <Textarea
          id={`note-${submissionId}`}
          name="note"
          rows={2}
          maxLength={2000}
          defaultValue={saved?.note ?? ""}
        />
        {state.fieldErrors?.note ? <p className="text-xs text-destructive">{state.fieldErrors.note}</p> : null}
      </div>

      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <ICON.spinner className="animate-spin" data-icon="inline-start" /> : null}
          {saved ? "Update score" : "Save score"}
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          Your total: {total == null ? "—" : `${total} / 25`}
        </span>
      </div>
    </form>
  );
}
