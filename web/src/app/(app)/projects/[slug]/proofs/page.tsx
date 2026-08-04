import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CreateProofDialog } from "@/components/entity-dialogs";
import { DataList } from "@/components/data-list";
import { ProofRowActions } from "@/components/entity-row-actions";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { ProofListRow } from "@/components/rows";
import { ICON } from "@/lib/icons";
import { parseFilters, type SearchParams } from "@/lib/filters";
import {
  canEditProof,
  getCurrentUserId,
  getProject,
  getProjectRole,
  listMilestoneOptions,
  listProofs,
} from "@/lib/queries";
import { NETWORK_LABELS } from "@/lib/stellar";

export const metadata: Metadata = { title: "Proofs" };

export default async function ProjectProofsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) notFound();

  const filters = parseFilters(await searchParams);
  const [page, milestones, role, userId] = await Promise.all([
    listProofs({ projectId: project.id }, filters),
    listMilestoneOptions(project.id),
    getProjectRole(project.id),
    getCurrentUserId(),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${slug}` },
        ]}
        title="Proofs"
        description="Contract IDs, transaction hashes and proof links recorded against this project."
        actions={<CreateProofDialog projectId={project.id} milestones={milestones} />}
      />

      <FilterBar
        filters={filters}
        placeholder="Paste a tx hash or search notes…"
        sorts={["updated"]}
        facets={[
          {
            key: "network",
            label: "Network",
            options: Object.entries(NETWORK_LABELS).map(([value, label]) => ({
              value,
              label,
            })),
          },
          {
            key: "milestone",
            label: "Milestone",
            options: milestones.map((milestone) => ({
              value: milestone.id,
              label: milestone.title,
            })),
          },
        ]}
      />

      <DataList
        filters={filters}
        total={page.total}
        matched={page.matched}
        shown={page.rows.length}
        noun="proofs"
        empty={{
          icon: ICON.proof,
          title: "No proof recorded yet",
          description:
            "Attach a contract ID or transaction hash to a milestone and it becomes part of the record a reviewer can verify.",
          action: (
            <CreateProofDialog
              projectId={project.id}
              milestones={milestones}
              label="Record your first proof"
            />
          ),
        }}
      >
        {page.rows.map((proof) => (
          <ProofListRow
            key={proof.id}
            proof={proof}
            actions={
              <ProofRowActions
                proof={proof}
                milestones={milestones}
                // "update own or as admin" — the author keeps their own record.
                canEdit={canEditProof(role, proof.createdBy, userId)}
              />
            }
          />
        ))}
      </DataList>
    </div>
  );
}
