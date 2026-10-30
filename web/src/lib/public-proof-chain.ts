import { checkDocSource, checkMilestoneRecord, type DocSourceCheck } from "@/lib/chain/doqtri-registry";
import { contradictsQditRecord, proofChain, type ChainStep } from "@/lib/proof-chain";
import type { PublicProof } from "@/lib/queries";

/**
 * The chain reads behind the public milestone page's proof chain and
 * "Planned in doqtri" block (WP-3.2, WP-3.3, contract section 12).
 *
 * The plan version is checked on doqtri's registry (its own network), the
 * heading's record against this project's milestone_proof registration. The
 * project id comes only with a registration. The milestone's own record is
 * read alongside; both reads share one cache entry, so it is one request.
 *
 * D-97: steps 2 and 3 set that record against qdit's anchors, which come
 * fresh from the database, while the record may be up to 30 s old. A reader
 * who loaded the page just before the owner approved would otherwise get
 * "Does not match" until the cache expired. So when the first chain shows
 * such a contradiction, the reads run once more with the milestone's record
 * uncached (`fresh`), and the chain is built from that: a contradiction is
 * shown only when a fresh read still has it. The fresh read is reused for a
 * few seconds (FRESH_REUSE_MS), so a page whose records really disagree does
 * not bypass the cache on every reload.
 */

export type PublicChain = { check: DocSourceCheck; steps: ChainStep[] };

export async function readPublicChain(
  proof: PublicProof,
  options: { now?: () => number; env?: Record<string, string | undefined> } = {},
): Promise<PublicChain | null> {
  const source = proof.docSource;
  if (!source) return null;

  const project =
    proof.network && proof.contractId && source.projectId
      ? { id: source.projectId, network: proof.network, contractId: proof.contractId }
      : null;

  const read = async (fresh: boolean): Promise<PublicChain> => {
    const [check, milestone] = await Promise.all([
      checkDocSource(source, { milestoneId: proof.milestoneId, project }, { ...options, freshMilestone: fresh }),
      project ? checkMilestoneRecord(project, proof.milestoneId, { now: options.now, fresh }) : null,
    ]);
    const steps = proofChain({
      network: proof.network,
      contractId: proof.contractId,
      anchors: proof.anchors,
      source,
      check,
      milestone,
    });
    return { check, steps };
  };

  const first = await read(false);
  return contradictsQditRecord(first.steps) ? read(true) : first;
}
