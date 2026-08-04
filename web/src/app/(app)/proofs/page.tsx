import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { DataList } from "@/components/data-list";
import { ProofRowActions } from "@/components/entity-row-actions";
import { FilterBar } from "@/components/filter-bar";
import { HashLink } from "@/components/hash-link";
import { PageHeader } from "@/components/page-header";
import { ProofListRow } from "@/components/rows";
import { VerifyTx } from "@/components/verify-tx";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { ICON } from "@/lib/icons";
import {
  canEditProof,
  getCurrentUserId,
  listMilestoneOptionsByProject,
  listProjectOptions,
  listProjectRoles,
  listProofs,
  resolveIdentifier,
} from "@/lib/queries";
import { isContractId, isTxHash, NETWORK_LABELS } from "@/lib/stellar";

export const metadata: Metadata = { title: "Proof registry" };

export default async function ProofRegistryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filters = parseFilters(await searchParams);

  // Pasting a full identifier is a different intent from typing a keyword:
  // the user is asking "what is this?", so answer that above the list.
  const looksLikeIdentifier = isContractId(filters.q) || isTxHash(filters.q);

  const [page, projects, hits, roles, milestonesByProject, userId] = await Promise.all([
    listProofs({}, filters),
    listProjectOptions(),
    looksLikeIdentifier ? resolveIdentifier(filters.q) : Promise.resolve([]),
    listProjectRoles(),
    listMilestoneOptionsByProject(),
    getCurrentUserId(),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Proof registry"
        description="Every contract ID, transaction hash and proof link recorded across the workspace."
      />

      {/* The registry stores what was pasted; this asks the ledger. */}
      <VerifyTx />

      <FilterBar
        filters={filters}
        placeholder="Paste a contract ID or tx hash…"
        sorts={["updated"]}
        facets={[
          {
            key: "project",
            label: "Project",
            options: projects.map((project) => ({
              value: project.id,
              label: project.name,
            })),
          },
          {
            key: "network",
            label: "Network",
            options: Object.entries(NETWORK_LABELS).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
      />

      {looksLikeIdentifier ? <IdentifierResult query={filters.q} hits={hits} /> : null}

      <DataList
        filters={filters}
        total={page.total}
        matched={page.matched}
        shown={page.rows.length}
        noun="proofs"
        empty={{
          icon: ICON.proof,
          title: "Nothing recorded yet",
          description:
            "Proof records appear here as milestones are submitted. Attach a contract ID or transaction hash to a milestone to start the trail.",
        }}
      >
        {page.rows.map((proof) => (
          <ProofListRow
            key={proof.id}
            proof={proof}
            showProject
            actions={
              <ProofRowActions
                proof={proof}
                milestones={milestonesByProject.get(proof.projectId) ?? []}
                canEdit={canEditProof(
                  roles.get(proof.projectId) ?? null,
                  proof.createdBy,
                  userId,
                )}
              />
            }
          />
        ))}
      </DataList>
    </div>
  );
}

/**
 * Answers "what is this identifier and whose is it?" — the lookup a reviewer
 * or a teammate actually arrives with. A well-formed identifier that matches
 * nothing is a meaningful answer too, so it gets its own state.
 */
function IdentifierResult({
  query,
  hits,
}: {
  query: string;
  hits: Awaited<ReturnType<typeof resolveIdentifier>>;
}) {
  const kind = isContractId(query) ? "contract" : "tx";

  if (hits.length === 0) {
    return (
      <div className="well mb-4 rounded-xl border border-dashed border-border-strong px-4 py-3">
        <p className="text-sm font-medium">
          Not recorded in this workspace
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          That looks like a valid {kind === "contract" ? "contract ID" : "transaction hash"},
          but nothing here references it. You can still open it on the explorer.
        </p>
        <div className="mt-2.5">
          <HashLink value={query} kind={kind} network="mainnet" lead={10} tail={10} />
        </div>
      </div>
    );
  }

  return (
    // The page's primary object when it exists: the user pasted an identifier
    // and this is the answer (spec §Visual Priority).
    <div className="surface-primary mb-4 overflow-hidden rounded-xl border border-primary/40">
      <p className="flex items-center gap-1.5 border-b border-border/70 px-4 py-2 text-xs font-medium text-muted-foreground">
        <ICON.proof aria-hidden className="size-3.5 shrink-0 text-primary" />
        Found in {hits.length} {hits.length === 1 ? "record" : "records"}
      </p>

      {hits.map((hit, index) => (
        <Link
          key={`${hit.projectSlug}-${hit.context}-${index}`}
          href={`/projects/${hit.projectSlug}/proofs`}
          className="row focus-ring flex items-center gap-3 border-b border-border/70 px-4 py-2.5 last:border-b-0"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{hit.projectName}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {hit.context} · {NETWORK_LABELS[hit.network]}
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      ))}
    </div>
  );
}
