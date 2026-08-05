import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AddMemberDialog } from "@/components/entity-dialogs";
import { MemberRowActions } from "@/components/entity-row-actions";
import { PageHeader } from "@/components/page-header";
import { MemberListRow } from "@/components/rows";
import { Section } from "@/components/section";
import { ICON } from "@/lib/icons";
import {
  canAdminister,
  getProject,
  getProjectRole,
  listAddableMembers,
  listProjectMembers,
} from "@/lib/queries";

export const metadata: Metadata = { title: "Members" };

/**
 * Spec §10's "simple members list", and the surface the rest of the app had
 * been depending on without having.
 *
 * Role gating shipped before any way to assign a role did: `getProjectRole`
 * decides which controls render on every other project page, but
 * `project_members` was read-only from the app, so a project's team could only
 * be changed with SQL. This is where that stops.
 *
 * The roster itself is readable by any member — `project_members: read as
 * member` is viewer+ — and only the writes are admin-gated, so everyone can see
 * who they are working with and a few people can change it.
 */
export default async function ProjectMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) notFound();

  const [members, role] = await Promise.all([
    listProjectMembers(project.id),
    getProjectRole(project.id),
  ]);

  const canManage = canAdminister(role);

  // Only fetched for someone who can act on it: this is a second round trip
  // that reads every profile the caller can see, and a viewer has no use for it.
  const candidates = canManage ? await listAddableMembers(project.id) : [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${slug}` },
        ]}
        title="Members"
        description="Who can see this project, and what each of them may do."
        actions={
          canManage ? (
            <AddMemberDialog projectId={project.id} candidates={candidates} />
          ) : null
        }
      />

      <Section
        priority
        icon={ICON.members}
        title="Team"
        count={members.length}
        empty="No members yet."
      >
        {members.map((member) => (
          <MemberListRow
            key={member.id}
            member={member}
            actions={
              <MemberRowActions
                projectId={project.id}
                member={member}
                canManage={canManage}
              />
            }
          />
        ))}
      </Section>
    </div>
  );
}
