"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Field, FieldRow, FormDialog, NativeSelect } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  MILESTONE_STATUS,
  PROJECT_STATUS,
  TASK_STATUS,
  TASK_STATUS_ORDER,
} from "@/lib/constants";
import { createMilestone, createProject, createProof, createTask } from "@/lib/actions";
import { slugify } from "@/lib/schemas";
import { NETWORK_LABELS } from "@/lib/stellar";

/**
 * Every create form in the app, built on the shared `FormDialog` shell so they
 * behave identically. Each exports a `label` variant so the same dialog can be
 * triggered from a page header and from an empty state without the two drifting
 * apart.
 */

type Option = { id: string; title?: string; name?: string };

/**
 * Must spread `props`.
 *
 * `<DialogTrigger asChild>` clones its child to inject the click handler, the
 * ref and the `aria-expanded`/`aria-controls` wiring. A component that ignores
 * incoming props swallows all of it silently — the button renders and looks
 * correct, and clicking it does nothing at all.
 */
function TriggerButton({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof Button>) {
  return (
    <Button {...props}>
      <Plus data-icon="inline-start" />
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------

export function CreateTaskDialog({
  projectId,
  milestones,
  members,
  label = "New task",
}: {
  projectId: string;
  milestones: { id: string; title: string }[];
  members: { id: string; name: string }[];
  label?: string;
}) {
  return (
    <FormDialog
      trigger={<TriggerButton label={label} />}
      title="New task"
      description="Only a title is required. Everything else can be filled in later."
      submitLabel="Create task"
      successMessage="Task created"
      action={createTask}
    >
      {(state) => (
        <>
          <input type="hidden" name="projectId" value={projectId} />

          <Field id="title" label="Title" error={state.fieldErrors?.title}>
            <Input id="title" name="title" required autoFocus maxLength={300} />
          </Field>

          <Field id="description" label="Description" optional>
            <Textarea id="description" name="description" rows={3} maxLength={4000} />
          </Field>

          <FieldRow>
            <Field id="status" label="Status">
              <NativeSelect id="status" name="status" defaultValue="todo">
                {TASK_STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {TASK_STATUS[status].label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field id="dueDate" label="Due date" optional error={state.fieldErrors?.dueDate}>
              <Input id="dueDate" name="dueDate" type="date" />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field id="milestoneId" label="Milestone" optional>
              <NativeSelect id="milestoneId" name="milestoneId" defaultValue="">
                <option value="">None</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field id="assigneeId" label="Assignee" optional>
              <NativeSelect id="assigneeId" name="assigneeId" defaultValue="">
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </FieldRow>
        </>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------

export function CreateProjectDialog({ label = "New project" }: { label?: string }) {
  // The slug is derived from the name until the user edits it themselves —
  // after that it is theirs, and retyping the name must not overwrite it.
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <FormDialog
      trigger={<TriggerButton label={label} />}
      title="New project"
      description="A project holds its own tasks, milestones and proof trail."
      submitLabel="Create project"
      successMessage="Project created"
      action={createProject}
    >
      {(state) => (
        <>
          <Field id="name" label="Name" error={state.fieldErrors?.name}>
            <Input
              id="name"
              name="name"
              required
              autoFocus
              maxLength={200}
              onChange={(event) => {
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
            />
          </Field>

          <Field
            id="slug"
            label="URL slug"
            hint="Used in the address bar: /projects/your-slug"
            error={state.fieldErrors?.slug}
          >
            <Input
              id="slug"
              name="slug"
              required
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
            />
          </Field>

          <Field id="description" label="Description" optional>
            <Textarea id="description" name="description" rows={3} maxLength={2000} />
          </Field>

          <Field id="status" label="Status">
            <NativeSelect id="status" name="status" defaultValue="active">
              {Object.entries(PROJECT_STATUS).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <FieldRow>
            <Field id="repoUrl" label="Repo URL" optional error={state.fieldErrors?.repoUrl}>
              <Input id="repoUrl" name="repoUrl" type="url" placeholder="https://" />
            </Field>

            <Field id="demoUrl" label="Demo URL" optional error={state.fieldErrors?.demoUrl}>
              <Input id="demoUrl" name="demoUrl" type="url" placeholder="https://" />
            </Field>
          </FieldRow>
        </>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------

export function CreateMilestoneDialog({
  projectId,
  label = "New milestone",
}: {
  projectId: string;
  label?: string;
}) {
  return (
    <FormDialog
      trigger={<TriggerButton label={label} />}
      title="New milestone"
      description="Group tasks so completion can be submitted and proved on-chain."
      submitLabel="Create milestone"
      successMessage="Milestone created"
      action={createMilestone}
    >
      {(state) => (
        <>
          <input type="hidden" name="projectId" value={projectId} />

          <Field id="m-title" label="Title" error={state.fieldErrors?.title}>
            <Input id="m-title" name="title" required autoFocus maxLength={300} />
          </Field>

          <Field id="m-description" label="Description" optional>
            <Textarea id="m-description" name="description" rows={3} maxLength={4000} />
          </Field>

          <FieldRow>
            <Field id="m-status" label="Status">
              <NativeSelect id="m-status" name="status" defaultValue="proposed">
                {Object.entries(MILESTONE_STATUS).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              id="m-dueDate"
              label="Due date"
              optional
              error={state.fieldErrors?.dueDate}
            >
              <Input id="m-dueDate" name="dueDate" type="date" />
            </Field>
          </FieldRow>
        </>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------

export function CreateProofDialog({
  projectId,
  milestones,
  label = "Record proof",
}: {
  projectId: string;
  milestones: Option[];
  label?: string;
}) {
  return (
    <FormDialog
      trigger={<TriggerButton label={label} />}
      title="Record proof"
      description="Attach on-chain evidence a reviewer can verify independently."
      submitLabel="Record proof"
      successMessage="Proof recorded"
      action={createProof}
    >
      {(state) => (
        <>
          <input type="hidden" name="projectId" value={projectId} />

          <Field
            id="p-contractId"
            label="Contract ID"
            optional
            // The schema requires at least one of contract id / tx hash / URL,
            // mirroring the stellar_proofs_has_evidence CHECK. The refinement
            // reports on this field, so the rule is stated here.
            hint="Add at least one of contract ID, transaction hash or proof link."
            error={state.fieldErrors?.contractId}
          >
            <Input id="p-contractId" name="contractId" placeholder="C…" spellCheck={false} />
          </Field>

          <Field
            id="p-txHash"
            label="Transaction hash"
            optional
            error={state.fieldErrors?.txHash}
          >
            <Input id="p-txHash" name="txHash" spellCheck={false} />
          </Field>

          <FieldRow>
            <Field id="p-network" label="Network">
              <NativeSelect id="p-network" name="network" defaultValue="testnet">
                {Object.entries(NETWORK_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field id="p-milestoneId" label="Milestone" optional>
              <NativeSelect id="p-milestoneId" name="milestoneId" defaultValue="">
                <option value="">None</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.title ?? milestone.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </FieldRow>

          <Field
            id="p-proofUrl"
            label="Proof link"
            optional
            error={state.fieldErrors?.proofUrl}
          >
            <Input id="p-proofUrl" name="proofUrl" type="url" placeholder="https://" />
          </Field>

          <Field id="p-notes" label="Notes" optional>
            <Textarea id="p-notes" name="notes" rows={2} maxLength={2000} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
