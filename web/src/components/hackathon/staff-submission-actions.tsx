"use client";

import { useState } from "react";

import { Field, FormDialog, SelectField } from "@/components/form-dialog";
import { DisabledReason } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  grantLatePass,
  regradeSubmission,
  setEligibilityOverride,
} from "@/lib/hackathon/staff-actions";
import { formatManila, isoToManilaLocal, toPlainText } from "@/lib/hackathon/staff-view";

/**
 * The per-entry controls of the admin submissions table (WP-4.7, QDIT-48):
 * eligibility override (reason required), regrade, late pass. Each is a
 * dialog on the shared FormDialog shell, so a failure shows inline and the
 * dialog closes only on success.
 */
export function StaffSubmissionActions({
  hackathonId,
  submissionId,
  projectId,
  teamName,
  override,
  overrideReason,
  latePassUntil,
  closesAt,
  released,
}: {
  hackathonId: string;
  submissionId: string;
  projectId: string;
  teamName: string;
  override: boolean | null;
  overrideReason: string | null;
  latePassUntil: string | null;
  closesAt: string;
  released: boolean;
}) {
  const name = toPlainText(teamName, 80);
  return (
    <div className="flex items-center justify-end gap-1">
      {/* Gone after release: finalists are fixed and the RPC refuses (already_released). */}
      {released ? (
        <>
          <DisabledReason reason="Grades are released; finalists are fixed.">
            <Button size="xs" variant="ghost" disabled>
              Regrade
            </Button>
          </DisabledReason>
          <DisabledReason reason="Grades are released; no late pass applies any more.">
            <Button size="xs" variant="ghost" disabled>
              Late pass
            </Button>
          </DisabledReason>
        </>
      ) : (
        <>
          <OverrideDialog
            submissionId={submissionId}
            teamName={name}
            override={override}
            overrideReason={overrideReason}
          />
          <RegradeDialog submissionId={submissionId} teamName={name} />
          <LatePassDialog
            hackathonId={hackathonId}
            projectId={projectId}
            teamName={name}
            latePassUntil={latePassUntil}
            closesAt={closesAt}
          />
        </>
      )}
    </div>
  );
}

function OverrideDialog({
  submissionId,
  teamName,
  override,
  overrideReason,
}: {
  submissionId: string;
  teamName: string;
  override: boolean | null;
  overrideReason: string | null;
}) {
  const [value, setValue] = useState(override == null ? "clear" : String(override));
  return (
    <FormDialog
      trigger={
        <Button size="xs" variant="ghost">
          Override
        </Button>
      }
      title={`Eligibility override: ${teamName}`}
      description="Your call wins over the rules. Eligible lets an entry that failed a rule be graded; not eligible keeps it out of the finals."
      submitLabel="Save override"
      successMessage="Override saved."
      action={setEligibilityOverride}
    >
      {(state) => (
        <>
          <input type="hidden" name="submissionId" value={submissionId} />
          <Field id={`override-${submissionId}`} label="Decision" error={state.fieldErrors?.value}>
            <SelectField
              id={`override-${submissionId}`}
              name="value"
              value={value}
              onValueChange={setValue}
            >
              <option value="true">Eligible</option>
              <option value="false">Not eligible</option>
              <option value="clear">Clear: the rules decide</option>
            </SelectField>
          </Field>
          {value !== "clear" ? (
            <Field
              id={`override-reason-${submissionId}`}
              label="Reason"
              hint="Required. Up to 500 characters; other admins see it."
              error={state.fieldErrors?.reason}
            >
              <Textarea
                id={`override-reason-${submissionId}`}
                name="reason"
                maxLength={500}
                rows={3}
                defaultValue={overrideReason ?? ""}
              />
            </Field>
          ) : null}
        </>
      )}
    </FormDialog>
  );
}

function RegradeDialog({ submissionId, teamName }: { submissionId: string; teamName: string }) {
  return (
    <FormDialog
      trigger={
        <Button size="xs" variant="ghost">
          Regrade
        </Button>
      }
      title={`Regrade ${teamName}?`}
      description="Every run of the current version stops counting and two fresh runs are queued. Use it after a failed run or an override."
      submitLabel="Regrade"
      successMessage="Two fresh runs queued."
      action={() => regradeSubmission(submissionId)}
    >
      {() => null}
    </FormDialog>
  );
}

function LatePassDialog({
  hackathonId,
  projectId,
  teamName,
  latePassUntil,
  closesAt,
}: {
  hackathonId: string;
  projectId: string;
  teamName: string;
  latePassUntil: string | null;
  closesAt: string;
}) {
  const initial = isoToManilaLocal(
    latePassUntil ?? new Date(Date.parse(closesAt) + 10 * 60 * 1000).toISOString(),
  );
  return (
    <FormDialog
      trigger={
        <Button size="xs" variant="ghost">
          Late pass
        </Button>
      }
      title={`Late pass: ${teamName}`}
      description={
        latePassUntil
          ? `Current pass ends ${formatManila(latePassUntil)}. A time in the past ends it now.`
          : "Lets this team submit after closing time, until the time you set. A time in the past ends a pass."
      }
      submitLabel="Save late pass"
      successMessage="Late pass saved."
      action={grantLatePass}
    >
      {(state) => (
        <>
          <input type="hidden" name="hackathonId" value={hackathonId} />
          <input type="hidden" name="projectId" value={projectId} />
          <Field
            id={`late-${projectId}`}
            label="Until (Asia/Manila)"
            hint="Manila time, whatever your own time zone."
            error={state.fieldErrors?.until}
          >
            <Input id={`late-${projectId}`} name="until" type="datetime-local" defaultValue={initial} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
