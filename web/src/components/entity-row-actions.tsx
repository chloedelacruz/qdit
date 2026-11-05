"use client";

import {
  EditMemberRoleDialog,
  EditMilestoneDialog,
  EditProjectDialog,
  EditProofDialog,
  EditTaskDialog,
} from "@/components/entity-dialogs";
import { MilestoneAnchorDialog } from "@/components/milestone-anchor";
import { ShareLinkButton } from "@/components/share-link";
import type { AnchorAction } from "@/lib/chain/actions";
import { RowActions } from "@/components/row-actions";
import {
  deleteDeployment,
  deleteMilestone,
  deleteProject,
  deleteProof,
  deleteTask,
  removeProjectMember,
} from "@/lib/actions";
import type {
  DeploymentRow,
  MilestoneRow,
  ProjectMember,
  ProjectRow,
  ProofRow,
  TaskRow,
} from "@/lib/queries";

/**
 * One wrapper per entity, binding a row to its edit dialog and its delete
 * action.
 *
 * These exist because `RowActions` takes a render prop for the edit dialog, and
 * a function cannot cross the server/client boundary. The row components in
 * `rows.tsx` stay server-rendered and receive one of these as an already-built
 * element; the closure over the dialog stays on this side of the line.
 *
 * `canEdit` is decided by the caller from `getProjectRole`, because the rule
 * differs per entity — see the RLS table in the migrations.
 */

type Options = { id: string; title: string }[];

export function TaskRowActions({
  task,
  milestones,
  members,
  canEdit,
  persistent = false,
}: {
  task: TaskRow;
  milestones: Options;
  members: { id: string; name: string }[];
  canEdit: boolean;
  /** For the detail panel, which has no row to hover. */
  persistent?: boolean;
}) {
  return (
    <RowActions
      label="task"
      canEdit={canEdit}
      canDelete={canEdit}
      persistent={persistent}
      deleteTitle="Delete this task?"
      deleteDescription={`"${task.title}" will be removed. This cannot be undone.`}
      onDelete={deleteTask.bind(null, task.id)}
      renderEdit={(props) => (
        <EditTaskDialog
          taskId={task.id}
          projectId={task.projectId}
          milestones={milestones}
          members={members}
          defaults={{
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            milestoneId: task.milestoneId,
            assigneeId: task.assigneeId,
            dueDate: task.dueDate,
          }}
          {...props}
        />
      )}
    />
  );
}

/**
 * `anchoring` gates the on-chain items.
 *
 * False when this deployment has no contract configured, in which case the
 * whole feature is absent rather than present-and-broken. Approve and reject
 * are offered only to the project owner, matching both `MILESTONE_OWNER_ONLY`
 * and the contract's own auth check.
 */
export function MilestoneRowActions({
  milestone,
  canEdit,
  anchoring = false,
  isOwner = false,
  persistent = false,
}: {
  milestone: MilestoneRow;
  canEdit: boolean;
  anchoring?: boolean;
  isOwner?: boolean;
  /** For the milestone's own page header, which has no row to hover. */
  persistent?: boolean;
}) {
  /*
    History, the certificate and the public link live on the milestone's own
    page now (QDIT-34), one click from any row — not in dialogs behind this
    menu. The share control stays on the row as well: public proof links answer
    the loudest complaint in the tester round, and a feature nobody can see is
    a feature nobody uses.
  */
  /*
    Only what the contract would accept next, read from the newest anchor: an
    approval is final (nothing more), and approve or reject needs a submission
    to decide on. Offering the rest only led to "not in a status that permits
    this transition" after the click.
  */
  const lastAnchor = milestone.anchor?.action ?? null;
  /*
    An unregistered project cannot anchor anything, so the item says so where
    it stands instead of opening a dialog that only explains it cannot.
  */
  const unregistered = !milestone.chainContractId
    ? {
        reason: "Register this project on chain first.",
        fix: {
          href: `/projects/${milestone.projectSlug}#chain`,
          label: "Go to the project overview",
        },
      }
    : undefined;

  const anchorItems: {
    key: AnchorAction;
    label: string;
    disabled?: typeof unregistered;
  }[] =
    anchoring && canEdit && lastAnchor !== "approve"
      ? [
          { key: "submit", label: "Anchor proof on chain", disabled: unregistered },
          ...(isOwner && lastAnchor === "submit"
            ? [
                { key: "approve" as const, label: "Approve on chain" },
                { key: "reject" as const, label: "Reject on chain" },
              ]
            : []),
        ]
      : [];

  return (
    <span className="flex items-center gap-0.5">
      {milestone.publicProofs ? (
        <ShareLinkButton
          projectSlug={milestone.projectSlug}
          milestoneId={milestone.id}
          anchored={Boolean(milestone.anchor)}
        />
      ) : null}

      <RowActions
        label="milestone"
        canEdit={canEdit}
        canDelete={canEdit}
        deleteTitle="Delete this milestone?"
        deleteDescription={`"${milestone.title}" will be removed. Its tasks stay, but they lose their milestone.`}
        onDelete={deleteMilestone.bind(null, milestone.id)}
        persistent={persistent}
        extraItems={[
          ...anchorItems.map((item) => ({
            key: item.key,
            label: item.label,
            disabled: item.disabled,
            render: (props: { open: boolean; onOpenChange: (open: boolean) => void }) => (
              <MilestoneAnchorDialog
                milestoneId={milestone.id}
                milestoneTitle={milestone.title}
                action={item.key}
                network={milestone.network}
                registered={Boolean(milestone.chainContractId)}
                {...props}
              />
            ),
          })),
        ]}
        renderEdit={(props) => (
          <EditMilestoneDialog
            milestoneId={milestone.id}
            projectId={milestone.projectId}
            defaults={{
              title: milestone.title,
              description: milestone.description,
              dueDate: milestone.dueDate,
            }}
            titleLocked={Boolean(milestone.link)}
            {...props}
          />
        )}
      />
    </span>
  );
}

export function ProofRowActions({
  proof,
  milestones,
  canEdit,
}: {
  proof: ProofRow;
  milestones: Options;
  canEdit: boolean;
}) {
  return (
    <RowActions
      label="proof"
      canEdit={canEdit}
      canDelete={canEdit}
      deleteTitle="Delete this proof?"
      deleteDescription="The on-chain transaction is unaffected — only this record of it is removed."
      onDelete={deleteProof.bind(null, proof.id)}
      renderEdit={(props) => (
        <EditProofDialog
          proofId={proof.id}
          projectId={proof.projectId}
          milestones={milestones}
          defaults={{
            milestoneId: proof.milestoneId,
            contractId: proof.contractId,
            txHash: proof.txHash,
            network: proof.network,
            walletAddress: proof.walletAddress,
            proofUrl: proof.proofUrl,
            notes: proof.notes,
          }}
          {...props}
        />
      )}
    />
  );
}

export function ProjectRowActions({
  project,
  canAdminister,
  persistent = false,
}: {
  project: ProjectRow;
  canAdminister: boolean;
  persistent?: boolean;
}) {
  return (
    <RowActions
      label="project"
      canEdit={canAdminister}
      canDelete={canAdminister}
      persistent={persistent}
      deleteTitle="Delete this project?"
      deleteDescription={`"${project.name}" and every task, milestone, deployment and proof inside it will be removed. This cannot be undone.`}
      onDelete={deleteProject.bind(null, project.id)}
      renderEdit={(props) => (
        <EditProjectDialog
          projectId={project.id}
          slug={project.slug}
          defaults={{
            name: project.name,
            description: project.description,
            status: project.status,
            repoUrl: project.repoUrl,
            demoUrl: project.demoUrl,
            docsUrl: project.docsUrl,
          }}
          {...props}
        />
      )}
    />
  );
}

/**
 * Delete only. The deployment log is append-only — a release that happened
 * cannot be edited into a different one; recording the next one is how the
 * current state changes. Delete stays for rows entered by mistake.
 */
export function DeploymentRowActions({
  deployment,
  canAdminister,
}: {
  deployment: DeploymentRow;
  canAdminister: boolean;
}) {
  return (
    <RowActions
      label="deployment"
      canEdit={false}
      canDelete={canAdminister}
      deleteTitle="Delete this deployment record?"
      deleteDescription="The release history is a log. Removing an entry rewrites it — prefer recording a correction."
      onDelete={deleteDeployment.bind(null, deployment.id)}
    />
  );
}

/**
 * Change a member's role, or remove them from the project.
 *
 * `canManage` is decided by the page from `canAdminister(role)`, matching the
 * `project_members` insert/update/delete policies. The two rules RLS does not
 * encode — an admin may not touch the owner's row, and may not change their
 * own — are enforced in the actions, and shown here as disabled items with the
 * reason. Hiding the controls instead would leave an admin wondering why their
 * own row looks different from everyone else's.
 */
export function MemberRowActions({
  projectId,
  member,
  canManage,
  isSelf = false,
}: {
  projectId: string;
  member: ProjectMember;
  canManage: boolean;
  /** This row is the signed-in person. */
  isSelf?: boolean;
}) {
  // The two rules RLS does not encode, said up front now (QDIT-34) rather than
  // after the form is submitted. The actions still enforce both.
  const owner = member.role === "owner";
  const editBlocked = owner
    ? "The owner's role can't be changed."
    : isSelf
      ? "You can't change your own role. Ask an admin or the owner."
      : undefined;
  const deleteBlocked = owner
    ? "The owner can't be removed."
    : isSelf
      ? "You can't remove yourself from a project you administer."
      : undefined;

  return (
    <RowActions
      label="member"
      canEdit={canManage}
      canDelete={canManage}
      editBlocked={editBlocked}
      deleteBlocked={deleteBlocked}
      deleteTitle={`Remove ${member.name}?`}
      deleteDescription="They lose access to this project immediately. Anything they created stays, and they can be added again later."
      onDelete={removeProjectMember.bind(null, projectId, member.id)}
      renderEdit={(props) => (
        <EditMemberRoleDialog
          projectId={projectId}
          member={{ id: member.id, name: member.name, role: member.role }}
          {...props}
        />
      )}
    />
  );
}
