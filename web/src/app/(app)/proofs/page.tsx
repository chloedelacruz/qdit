import type { Metadata } from "next";
import { Link2 } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Proof registry" };

export default function ProofsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Proof registry"
        description="Every contract ID, transaction hash and proof link recorded against this workspace."
      />

      <EmptyState
        icon={Link2}
        title="Nothing recorded yet"
        description="Proof records appear here as milestones are submitted. Wire this page to the stellar_proofs table."
      />
    </div>
  );
}
