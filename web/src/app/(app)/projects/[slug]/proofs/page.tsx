import type { Metadata } from "next";
import { notFound } from "next/navigation";


import { CreateProofDialog } from "@/components/entity-dialogs";
import { DataList } from "@/components/data-list";
import { ProofRowActions } from "@/components/entity-row-actions";
import { FilterBar } from "@/components/filter-bar";
import { CreateGate } from "@/components/create-gate";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ProofListRow } from "@/components/rows";
import { ICON } from "@/lib/icons";
import { parseFilters, type SearchParams } from "@/lib/filters";
import {
  canContribute,
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
        info="Contract IDs, transaction hashes and proof links recorded against this project."
        actions={
          <>
            {/* The anchor history as a file you can file. A tester copied hashes
                into a quarterly report one by one and asked for exactly this;
                it is the on-chain anchor log, distinct from the pasted-proof
                list below. Download attribute plus the route's own
                Content-Disposition, so it saves rather than navigates. */}
            <Button asChild variant="outline" size="sm">
              <a
                href={`/api/export/anchors?project=${project.slug}`}
                download
                aria-label="Anchor history (CSV)"
              >
                <ICON.download data-icon="inline-start" />
                Anchors CSV
              </a>
            </Button>
            <CreateGate allowed={canContribute(role)} label="Record proof">
              <CreateProofDialog projectId={project.id} milestones={milestones} />
            </CreateGate>
          </>
        }
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
          description: "Attach a contract ID or tx hash to a milestone.",
          action: (
            <CreateGate allowed={canContribute(role)} label="Record your first proof">
              <CreateProofDialog
                projectId={project.id}
                milestones={milestones}
                label="Record your first proof"
              />
            </CreateGate>
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
