"use client";

import {
  EditMilestoneDialog,
  EditProjectDialog,
  EditProofDialog,
  EditTaskDialog,
} from "@/components/entity-dialogs";
import { RowActions } from "@/components/row-actions";
import {
  deleteDeployment,
  deleteMilestone,
  deleteProject,
  deleteProof,
  deleteTask,
} from "@/lib/actions";
import type {
  DeploymentRow,
  MilestoneRow,
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
}: {
  task: TaskRow;
  milestones: Options;
  members: { id: string; name: string }[];
  canEdit: boolean;
}) {
  return (
    <RowActions
      label="task"
      canEdit={canEdit}
      canDelete={canEdit}
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

export function MilestoneRowActions({
  milestone,
  canEdit,
}: {
  milestone: MilestoneRow;
  canEdit: boolean;
}) {
  return (
    <RowActions
      label="milestone"
      canEdit={canEdit}
      canDelete={canEdit}
      deleteTitle="Delete this milestone?"
      deleteDescription={`"${milestone.title}" will be removed. Its tasks stay, but they lose their milestone.`}
      onDelete={deleteMilestone.bind(null, milestone.id)}
      renderEdit={(props) => (
        <EditMilestoneDialog
          milestoneId={milestone.id}
          projectId={milestone.projectId}
          defaults={{
            title: milestone.title,
            description: milestone.description,
            dueDate: milestone.dueDate,
          }}
          {...props}
        />
      )}
    />
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
}: {
  project: ProjectRow;
  canAdminister: boolean;
}) {
  return (
    <RowActions
      label="project"
      canEdit={canAdminister}
      canDelete={canAdminister}
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
