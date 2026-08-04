"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Field, FieldRow, FormDialog, NativeSelect } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DEPLOYMENT_STATUS,
  DEPLOYMENT_STATUS_ORDER,
  PROJECT_STATUS,
  TASK_STATUS,
  TASK_STATUS_ORDER,
} from "@/lib/constants";
import {
  createDeployment,
  createMilestone,
  createProject,
  createProof,
  createTask,
  updateMilestone,
  updateProfile,
  updateProject,
  updateProof,
  updateTask,
  type ActionState,
} from "@/lib/actions";
import { slugify } from "@/lib/schemas";
import { NETWORK_LABELS } from "@/lib/stellar";

/**
 * Every create and edit form in the app, built on the shared `FormDialog` shell
 * so they behave identically.
 *
 * Create and edit share one field set per entity — the `*Fields` components
 * below — because a field added to one and forgotten in the other is exactly
 * the drift this file exists to prevent. Create renders them with no defaults
 * and owns its trigger; edit renders them with defaults and is opened from a
 * row's overflow menu.
 */

type Option = { id: string; title?: string; name?: string };

/** Open state passed in by whatever opened an edit dialog. */
type EditProps = { open: boolean; onOpenChange: (open: boolean) => void };

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
// Tasks
// ---------------------------------------------------------------------------

export type TaskDefaults = {
  title: string;
  description: string | null;
  status: string;
  milestoneId: string | null;
  assigneeId: string | null;
  dueDate: string | null;
};

function TaskFields({
  state,
  milestones,
  members,
  defaults,
}: {
  state: ActionState;
  milestones: { id: string; title: string }[];
  members: { id: string; name: string }[];
  defaults?: TaskDefaults;
}) {
  return (
    <>
      <Field id="title" label="Title" error={state.fieldErrors?.title}>
        <Input
          id="title"
          name="title"
          required
          autoFocus
          maxLength={300}
          defaultValue={defaults?.title}
        />
      </Field>

      <Field id="description" label="Description" optional>
        <Textarea
          id="description"
          name="description"
          rows={3}
          maxLength={4000}
          defaultValue={defaults?.description ?? ""}
        />
      </Field>

      <FieldRow>
        <Field id="status" label="Status">
          <NativeSelect id="status" name="status" defaultValue={defaults?.status ?? "todo"}>
            {TASK_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS[status].label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field id="dueDate" label="Due date" optional error={state.fieldErrors?.dueDate}>
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={defaults?.dueDate ?? ""}
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field id="milestoneId" label="Milestone" optional>
          <NativeSelect
            id="milestoneId"
            name="milestoneId"
            defaultValue={defaults?.milestoneId ?? ""}
          >
            <option value="">None</option>
            {milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.title}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field id="assigneeId" label="Assignee" optional>
          <NativeSelect
            id="assigneeId"
            name="assigneeId"
            defaultValue={defaults?.assigneeId ?? ""}
          >
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
  );
}

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
          <TaskFields state={state} milestones={milestones} members={members} />
        </>
      )}
    </FormDialog>
  );
}

export function EditTaskDialog({
  taskId,
  projectId,
  milestones,
  members,
  defaults,
  open,
  onOpenChange,
}: {
  taskId: string;
  projectId: string;
  milestones: { id: string; title: string }[];
  members: { id: string; name: string }[];
  defaults: TaskDefaults;
} & EditProps) {
  return (
    <FormDialog
      title="Edit task"
      submitLabel="Save changes"
      successMessage="Task updated"
      action={updateTask}
      open={open}
      onOpenChange={onOpenChange}
    >
      {(state) => (
        <>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="projectId" value={projectId} />
          <TaskFields
            state={state}
            milestones={milestones}
            members={members}
            defaults={defaults}
          />
        </>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectDefaults = {
  name: string;
  description: string | null;
  status: string;
  repoUrl: string | null;
  demoUrl: string | null;
  docsUrl: string | null;
};

/** Everything except name and slug, which differ between create and edit. */
function ProjectCommonFields({
  state,
  defaults,
}: {
  state: ActionState;
  defaults?: ProjectDefaults;
}) {
  return (
    <>
      <Field id="description" label="Description" optional>
        <Textarea
          id="description"
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={defaults?.description ?? ""}
        />
      </Field>

      <Field id="status" label="Status">
        <NativeSelect id="status" name="status" defaultValue={defaults?.status ?? "active"}>
          {Object.entries(PROJECT_STATUS).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <FieldRow>
        <Field id="repoUrl" label="Repo URL" optional error={state.fieldErrors?.repoUrl}>
          <Input
            id="repoUrl"
            name="repoUrl"
            type="url"
            placeholder="https://"
            defaultValue={defaults?.repoUrl ?? ""}
          />
        </Field>

        <Field id="demoUrl" label="Demo URL" optional error={state.fieldErrors?.demoUrl}>
          <Input
            id="demoUrl"
            name="demoUrl"
            type="url"
            placeholder="https://"
            defaultValue={defaults?.demoUrl ?? ""}
          />
        </Field>
      </FieldRow>

      <Field id="docsUrl" label="Docs URL" optional error={state.fieldErrors?.docsUrl}>
        <Input
          id="docsUrl"
          name="docsUrl"
          type="url"
          placeholder="https://"
          defaultValue={defaults?.docsUrl ?? ""}
        />
      </Field>
    </>
  );
}

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
            hint="Used in the address bar: /projects/your-slug. Fixed once created."
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

          <ProjectCommonFields state={state} />
        </>
      )}
    </FormDialog>
  );
}

export function EditProjectDialog({
  projectId,
  slug,
  defaults,
  open,
  onOpenChange,
}: {
  projectId: string;
  slug: string;
  defaults: ProjectDefaults;
} & EditProps) {
  return (
    <FormDialog
      title="Edit project"
      submitLabel="Save changes"
      successMessage="Project updated"
      action={updateProject}
      open={open}
      onOpenChange={onOpenChange}
    >
      {(state) => (
        <>
          <input type="hidden" name="projectId" value={projectId} />

          <Field id="name" label="Name" error={state.fieldErrors?.name}>
            <Input
              id="name"
              name="name"
              required
              autoFocus
              maxLength={200}
              defaultValue={defaults.name}
            />
          </Field>

          {/* Not a field. The slug is in every URL for this project, so it is
              fixed after creation — and `updateProject` would ignore it even if
              this posted a value. Shown because it is worth knowing, disabled
              because it is not a decision available here. */}
          <Field id="slug-fixed" label="URL slug" hint="Fixed after creation.">
            <Input id="slug-fixed" value={slug} disabled readOnly />
          </Field>

          <ProjectCommonFields state={state} defaults={defaults} />
        </>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export type MilestoneDefaults = {
  title: string;
  description: string | null;
  dueDate: string | null;
};

/**
 * Status is not here, in either mode.
 *
 * `milestone_status` is the contract's state machine, and a milestone moves
 * through it via `MilestoneStatusMenu` — which offers only legal transitions
 * and knows approve/reject belong to the project owner. A status select on this
 * form would be a second, permissive path to the same column.
 */
function MilestoneFields({
  state,
  defaults,
}: {
  state: ActionState;
  defaults?: MilestoneDefaults;
}) {
  return (
    <>
      <Field id="m-title" label="Title" error={state.fieldErrors?.title}>
        <Input
          id="m-title"
          name="title"
          required
          autoFocus
          maxLength={300}
          defaultValue={defaults?.title}
        />
      </Field>

      <Field id="m-description" label="Description" optional>
        <Textarea
          id="m-description"
          name="description"
          rows={3}
          maxLength={4000}
          defaultValue={defaults?.description ?? ""}
        />
      </Field>

      <Field id="m-dueDate" label="Due date" optional error={state.fieldErrors?.dueDate}>
        <Input
          id="m-dueDate"
          name="dueDate"
          type="date"
          defaultValue={defaults?.dueDate ?? ""}
        />
      </Field>
    </>
  );
}

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
          {/* Every milestone starts Proposed — the contract's initial state. */}
          <input type="hidden" name="status" value="proposed" />
          <MilestoneFields state={state} />
        </>
      )}
    </FormDialog>
  );
}

export function EditMilestoneDialog({
  milestoneId,
  projectId,
  defaults,
  open,
  onOpenChange,
}: {
  milestoneId: string;
  projectId: string;
  defaults: MilestoneDefaults;
} & EditProps) {
  return (
    <FormDialog
      title="Edit milestone"
      description="Status moves through the approval flow, not this form."
      submitLabel="Save changes"
      successMessage="Milestone updated"
      action={updateMilestone}
      open={open}
      onOpenChange={onOpenChange}
    >
      {(state) => (
        <>
          <input type="hidden" name="milestoneId" value={milestoneId} />
          <input type="hidden" name="projectId" value={projectId} />
          {/* updateMilestone ignores status; the schema still requires one. */}
          <input type="hidden" name="status" value="proposed" />
          <MilestoneFields state={state} defaults={defaults} />
        </>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

export type ProofDefaults = {
  milestoneId: string | null;
  contractId: string | null;
  txHash: string | null;
  network: string;
  walletAddress: string | null;
  proofUrl: string | null;
  notes: string | null;
};

function ProofFields({
  state,
  milestones,
  defaults,
}: {
  state: ActionState;
  milestones: Option[];
  defaults?: ProofDefaults;
}) {
  return (
    <>
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
        <Input
          id="p-contractId"
          name="contractId"
          placeholder="C…"
          spellCheck={false}
          defaultValue={defaults?.contractId ?? ""}
        />
      </Field>

      <Field id="p-txHash" label="Transaction hash" optional error={state.fieldErrors?.txHash}>
        <Input
          id="p-txHash"
          name="txHash"
          spellCheck={false}
          defaultValue={defaults?.txHash ?? ""}
        />
      </Field>

      <FieldRow>
        <Field id="p-network" label="Network">
          <NativeSelect
            id="p-network"
            name="network"
            defaultValue={defaults?.network ?? "testnet"}
          >
            {Object.entries(NETWORK_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field id="p-milestoneId" label="Milestone" optional>
          <NativeSelect
            id="p-milestoneId"
            name="milestoneId"
            defaultValue={defaults?.milestoneId ?? ""}
          >
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
        id="p-walletAddress"
        label="Wallet address"
        optional
        hint="The Stellar account that submitted the transaction."
        error={state.fieldErrors?.walletAddress}
      >
        <Input
          id="p-walletAddress"
          name="walletAddress"
          placeholder="G…"
          spellCheck={false}
          defaultValue={defaults?.walletAddress ?? ""}
        />
      </Field>

      <Field id="p-proofUrl" label="Proof link" optional error={state.fieldErrors?.proofUrl}>
        <Input
          id="p-proofUrl"
          name="proofUrl"
          type="url"
          placeholder="https://"
          defaultValue={defaults?.proofUrl ?? ""}
        />
      </Field>

      <Field id="p-notes" label="Notes" optional>
        <Textarea
          id="p-notes"
          name="notes"
          rows={2}
          maxLength={2000}
          defaultValue={defaults?.notes ?? ""}
        />
      </Field>
    </>
  );
}

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
          <ProofFields state={state} milestones={milestones} />
        </>
      )}
    </FormDialog>
  );
}

export function EditProofDialog({
  proofId,
  projectId,
  milestones,
  defaults,
  open,
  onOpenChange,
}: {
  proofId: string;
  projectId: string;
  milestones: Option[];
  defaults: ProofDefaults;
} & EditProps) {
  return (
    <FormDialog
      title="Edit proof"
      submitLabel="Save changes"
      successMessage="Proof updated"
      action={updateProof}
      open={open}
      onOpenChange={onOpenChange}
    >
      {(state) => (
        <>
          <input type="hidden" name="proofId" value={proofId} />
          <input type="hidden" name="projectId" value={projectId} />
          <ProofFields state={state} milestones={milestones} defaults={defaults} />
        </>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------

/**
 * The deployment log is append-only: recording a release is how the current
 * state changes, so there is a create dialog and no edit one.
 */
export function CreateDeploymentDialog({
  projectId,
  label = "Record deployment",
}: {
  projectId: string;
  label?: string;
}) {
  return (
    <FormDialog
      trigger={<TriggerButton label={label} />}
      title="Record deployment"
      description="Appends to the release history. The newest entry is the current state."
      submitLabel="Record deployment"
      successMessage="Deployment recorded"
      action={createDeployment}
    >
      {(state) => (
        <>
          <input type="hidden" name="projectId" value={projectId} />

          <FieldRow>
            <Field id="d-status" label="Status" error={state.fieldErrors?.status}>
              <NativeSelect id="d-status" name="status" defaultValue="testnet">
                {DEPLOYMENT_STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {DEPLOYMENT_STATUS[status].label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              id="d-network"
              label="Network"
              // deployments_network_required: anything past not_started has to
              // say where it happened. The schema reports it on this field.
              hint="Required once past Not Started."
              error={state.fieldErrors?.network}
            >
              <NativeSelect id="d-network" name="network" defaultValue="testnet">
                <option value="">None</option>
                {Object.entries(NETWORK_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </FieldRow>

          <Field
            id="d-contractId"
            label="Contract ID"
            optional
            error={state.fieldErrors?.contractId}
          >
            <Input id="d-contractId" name="contractId" placeholder="C…" spellCheck={false} />
          </Field>

          <Field
            id="d-txHash"
            label="Transaction hash"
            optional
            error={state.fieldErrors?.txHash}
          >
            <Input id="d-txHash" name="txHash" spellCheck={false} />
          </Field>

          <Field id="d-releaseNotes" label="Release notes" optional>
            <Textarea id="d-releaseNotes" name="releaseNotes" rows={3} maxLength={4000} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * The caller's own profile. The wallet address matters beyond display: it is
 * the join between a Supabase user and a Stellar account, which is what the
 * contract authenticates against once submit/approve are wired up.
 */
export function EditProfileDialog({
  defaults,
  label = "Edit profile",
}: {
  defaults: { displayName: string; walletAddress: string | null };
  label?: string;
}) {
  return (
    <FormDialog
      trigger={<Button variant="outline">{label}</Button>}
      title="Edit profile"
      description="How you appear to teammates, and the Stellar account you sign with."
      submitLabel="Save profile"
      successMessage="Profile updated"
      action={updateProfile}
    >
      {(state) => (
        <>
          <Field id="displayName" label="Display name" error={state.fieldErrors?.displayName}>
            <Input
              id="displayName"
              name="displayName"
              required
              autoFocus
              maxLength={120}
              defaultValue={defaults.displayName}
            />
          </Field>

          <Field
            id="walletAddress"
            label="Wallet address"
            optional
            hint="Your Stellar account, used to sign milestone proofs."
            error={state.fieldErrors?.walletAddress}
          >
            <Input
              id="walletAddress"
              name="walletAddress"
              placeholder="G…"
              spellCheck={false}
              defaultValue={defaults.walletAddress ?? ""}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
