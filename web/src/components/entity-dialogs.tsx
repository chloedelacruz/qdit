"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Field, FieldRow, FormDialog, SelectField } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DEPLOYMENT_STATUS,
  DEPLOYMENT_STATUS_ORDER,
  MEMBER_ROLE,
  PROJECT_STATUS,
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  TASK_STATUS_ORDER,
} from "@/lib/constants";
import {
  addProjectMember,
  addProjectMemberByIdentifier,
  createDeployment,
  createMilestone,
  createProject,
  createProof,
  createTask,
  updateMilestone,
  updateProfile,
  updateProject,
  updateProof,
  updateProjectMemberRole,
  updateTask,
  type ActionState,
} from "@/lib/actions";
import { ASSIGNABLE_ROLES, slugify } from "@/lib/schemas";
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
  priority: string;
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

      {/* Status and priority pair because they are the two questions that
          classify a task rather than place it: where it is, and how much it
          matters. */}
      <FieldRow>
        <Field id="status" label="Status">
          <SelectField id="status" name="status" defaultValue={defaults?.status ?? "todo"}>
            {TASK_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS[status].label}
              </option>
            ))}
          </SelectField>
        </Field>

        {/* Not marked optional: the column is `not null default 'medium'`, so
            there is no such thing as a task without one — leaving it alone
            picks Medium rather than picking nothing. */}
        <Field id="priority" label="Priority">
          <SelectField
            id="priority"
            name="priority"
            defaultValue={defaults?.priority ?? "medium"}
          >
            {TASK_PRIORITY_ORDER.map((priority) => (
              <option key={priority} value={priority}>
                {TASK_PRIORITY[priority].label}
              </option>
            ))}
          </SelectField>
        </Field>
      </FieldRow>

      <FieldRow>
        <Field id="dueDate" label="Due date" optional error={state.fieldErrors?.dueDate}>
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={defaults?.dueDate ?? ""}
          />
        </Field>

        <Field id="milestoneId" label="Milestone" optional>
          <SelectField
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
          </SelectField>
        </Field>
      </FieldRow>

      {/* Full width, as the odd one out of five — and the field that most wants
          it, since its options are people's names. */}
      <Field id="assigneeId" label="Assignee" optional>
        <SelectField
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
        </SelectField>
      </Field>
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
        <SelectField id="status" name="status" defaultValue={defaults?.status ?? "active"}>
          {Object.entries(PROJECT_STATUS).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </SelectField>
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
          <SelectField
            id="p-network"
            name="network"
            defaultValue={defaults?.network ?? "testnet"}
          >
            {Object.entries(NETWORK_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </Field>

        <Field id="p-milestoneId" label="Milestone" optional>
          <SelectField
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
          </SelectField>
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
              <SelectField id="d-status" name="status" defaultValue="testnet">
                {DEPLOYMENT_STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {DEPLOYMENT_STATUS[status].label}
                  </option>
                ))}
              </SelectField>
            </Field>

            <Field
              id="d-network"
              label="Network"
              // deployments_network_required: anything past not_started has to
              // say where it happened. The schema reports it on this field.
              hint="Required once past Not Started."
              error={state.fieldErrors?.network}
            >
              <SelectField id="d-network" name="network" defaultValue="testnet">
                <option value="">None</option>
                {Object.entries(NETWORK_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectField>
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
 * The caller's own profile — which is now only their display name.
 *
 * The wallet address used to be a second field here, a free-text `G…` box that
 * wrote straight to `profiles.wallet_address`. It is gone, and not because a
 * typo was likely: an address that is typed is *claimed*, and one that arrives
 * through a signed challenge is *proved*. Every address on every profile is now
 * the second kind, which is what the member roster and the anchoring flow have
 * been quietly assuming all along.
 *
 * The address is shown, and bound for the first time, in Settings via
 * `WalletConnect`. After that it cannot be changed at all — see
 * `profiles_freeze_wallet_address`.
 */
export function EditProfileDialog({
  defaults,
  label = "Edit profile",
}: {
  defaults: { displayName: string };
  label?: string;
}) {
  return (
    <FormDialog
      trigger={<Button variant="outline">{label}</Button>}
      title="Edit profile"
      description="How you appear to teammates."
      submitLabel="Save profile"
      successMessage="Profile updated"
      action={updateProfile}
    >
      {(state) => (
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
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/**
 * The role picker, shared by add and edit for the usual reason.
 *
 * `owner` is not among the options: `ASSIGNABLE_ROLES` omits it because the
 * owner row mirrors `projects.owner_id`, which the RLS policies and the
 * contract's approver check both key off. Handing it out here would leave a
 * project with two owners and only one of them recorded where it counts.
 */
function RoleField({ state, defaultValue }: { state: ActionState; defaultValue?: string }) {
  return (
    <Field
      id="m-role"
      label="Role"
      hint={MEMBER_ROLE[(defaultValue as keyof typeof MEMBER_ROLE) ?? "member"]?.description}
      error={state.fieldErrors?.role}
    >
      <SelectField id="m-role" name="role" defaultValue={defaultValue ?? "member"}>
        {ASSIGNABLE_ROLES.map((role) => (
          <option key={role} value={role}>
            {MEMBER_ROLE[role].label}
          </option>
        ))}
      </SelectField>
    </Field>
  );
}

/**
 * Adds someone to a project, by identifier or by picking a known teammate.
 *
 * Two paths because neither subsumes the other. The picker only offers people
 * `shares_project_with()` already matches — in a single-project workspace that
 * is nobody, since the visible set *is* the roster — so it cannot grow a team
 * past whoever was seeded. Typing an identifier can reach anyone with an
 * account, but it means knowing one, and `profiles` is invisible to this client
 * for strangers, so the picker cannot show anything to jog a memory.
 *
 * One field takes all three identifiers rather than a tab per kind: the formats
 * cannot collide, so the server works out what it was given (see
 * `classifyMemberIdentifier`). Three tabs would make an admin classify what
 * they are holding before they may paste it.
 *
 * Typing is the default because it is the path that always works. The picker is
 * offered above it only when it has candidates; otherwise it is absent rather
 * than present-and-empty.
 */
export function AddMemberDialog({
  projectId,
  candidates,
  label = "Add member",
}: {
  projectId: string;
  candidates: { id: string; name: string }[];
  label?: string;
}) {
  const [byIdentifier, setByIdentifier] = useState(true);
  const canPick = candidates.length > 0;
  const useIdentifier = byIdentifier || !canPick;

  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Plus data-icon="inline-start" />
          {label}
        </Button>
      }
      title="Add member"
      description="Give someone access to this project and choose what they may do."
      submitLabel="Add member"
      successMessage="Member added"
      // Two actions, one dialog: the typed path resolves the identifier in a
      // SECURITY DEFINER function, the picker already holds a user id and
      // inserts directly. Sharing one action would mean branching on which
      // field happened to be filled in.
      action={useIdentifier ? addProjectMemberByIdentifier : addProjectMember}
    >
      {(state) => (
        <>
          <input type="hidden" name="projectId" value={projectId} />

          {useIdentifier ? (
            <Field
              id="m-identifier"
              label="Username, email or wallet address"
              hint="They need a qdit account already — this grants access, it does not send an invitation."
              error={state.fieldErrors?.identifier}
            >
              <Input
                id="m-identifier"
                name="identifier"
                // Deliberately not `type="email"`: the browser would refuse to
                // submit a username or a G-address as "not an email", before
                // the server ever saw which of the three it was.
                required
                autoFocus
                autoCapitalize="none"
                spellCheck={false}
                placeholder="ada · them@example.com · G…"
              />
            </Field>
          ) : (
            <Field id="m-userId" label="Person" error={state.fieldErrors?.userId}>
              <SelectField id="m-userId" name="userId" defaultValue="">
                <option value="" disabled>
                  Choose someone…
                </option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </SelectField>
            </Field>
          )}

          {canPick ? (
            <button
              type="button"
              onClick={() => setByIdentifier((current) => !current)}
              className="focus-ring transition-qdit -mt-1 self-start rounded-sm text-xs text-muted-foreground hover:text-primary"
            >
              {useIdentifier
                ? `Or pick from ${candidates.length} teammate${candidates.length === 1 ? "" : "s"}`
                : "Or add by username, email or wallet"}
            </button>
          ) : null}

          <RoleField state={state} />
        </>
      )}
    </FormDialog>
  );
}

/** Changes one member's role. Opened from the row's overflow menu. */
export function EditMemberRoleDialog({
  projectId,
  member,
  open,
  onOpenChange,
}: {
  projectId: string;
  member: { id: string; name: string; role: string };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <FormDialog
      title={`Change ${member.name}'s role`}
      description="Roles decide what someone may create, edit and approve in this project."
      submitLabel="Save role"
      successMessage="Role updated"
      action={updateProjectMemberRole}
      open={open}
      onOpenChange={onOpenChange}
    >
      {(state) => (
        <>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="userId" value={member.id} />
          <RoleField state={state} defaultValue={member.role} />
        </>
      )}
    </FormDialog>
  );
}
