import "server-only";

import { sha256Hex } from "@/lib/api/hackathon-snapshot-body";
import {
  readMilestone,
  readRegistryDocument,
  registryConfig,
  type DocumentRead,
  type MilestoneRead,
  type MilestoneTarget,
  type RegistryConfig,
} from "@/lib/chain/doqtri-registry";
import { MIN_ANCHORED_MILESTONES, MIN_ANCHORED_NOTES, parseWindow, qualifyingNotes } from "@/lib/hackathon/eligibility";
import type {
  ChainFacts,
  DoqtriSnapshotNote,
  DoqtriSnapshotV1,
  HackathonWindow,
  QditSnapshotMilestoneAnchor,
  QditSnapshotV1,
} from "@/lib/hackathon/types";
import { SOROBAN_RPC_URL } from "@/lib/stellar";

/**
 * The chain reads behind the two chain eligibility rules (WP-4.7, QDIT-54),
 * made by the grading worker once per version, before the gate runs.
 *
 * Notes: each event note (the ones `notes_during_event` counts) against
 * `DoqtriRegistry.get_document(doc_id)` on this deployment's registry. A note
 * is anchored when the registry holds its document and either
 *
 *   - the registry's version is past the snapshot's (the note was anchored
 *     again after the push: versions only go up, so the pushed text was
 *     anchored on the way), or
 *   - the versions are equal, or the snapshot has none, and the registry's
 *     `content_hash` is the SHA-256 of the pushed markdown.
 *
 * Milestones: each milestone's latest `submit` anchor row in the qdit
 * snapshot, on the project's own `chain_contract_id`, against
 * `get_milestone_status(project_id, milestone_id)` on that contract. The
 * anchor rows are member-written pointers (20260809010655_chain_anchors.sql),
 * so they prove nothing alone; the chain record does. It counts when its
 * ledger timestamp lies inside the event window and its version is at least
 * the row's (with the same proof hash when equal).
 *
 * Reads stop as soon as a rule's bar is met. A read that fails, times out or
 * does not decode is never taken for "not anchored": if a bar is still unmet
 * after every answer that came back, `readChainFacts` throws
 * `ChainUnavailableError` and the worker retries the job (the product
 * owner's call: an entry is never made ineligible because the chain could
 * not be read).
 */

export const CHAIN_FACTS_CONCURRENCY = 5;
/** No read starts after this; well inside the job's 200 s lease. */
export const CHAIN_FACTS_BUDGET_MS = 60_000;

export type ChainUnavailableReason = "unconfigured" | "rpc" | "timeout" | "decode" | "budget";

/** The chain could not answer what the gate needs. */
export class ChainUnavailableError extends Error {
  readonly reason: ChainUnavailableReason;

  constructor(reason: ChainUnavailableReason) {
    super(`chain unavailable: ${reason}`);
    this.name = "ChainUnavailableError";
    this.reason = reason;
  }
}

export type ChainFactsInput = {
  window: Pick<HackathonWindow, "opens_at" | "closes_at">;
  snapshot: QditSnapshotV1;
  doqtri: DoqtriSnapshotV1 | null;
};

export type ChainFactsDeps = {
  registry?: RegistryConfig | null;
  readDocument?: (config: RegistryConfig, docId: string) => Promise<DocumentRead>;
  readMilestone?: (target: MilestoneTarget, projectId: string, milestoneId: string) => Promise<MilestoneRead>;
  now?: () => number;
  budgetMs?: number;
};

type Verdict = "yes" | "no" | ChainUnavailableReason;

/** Is this note's pushed text on the registry? */
export function noteVerdict(read: DocumentRead, note: Pick<DoqtriSnapshotNote, "markdown" | "version">): Verdict {
  if (!read.ok) return read.reason;
  if (read.document === null) return "no";
  const { version, contentHash } = read.document;
  if (note.version != null && version > note.version) return "yes";
  if (note.version != null && version < note.version) return "no";
  return contentHash.toLowerCase() === sha256Hex(note.markdown) ? "yes" : "no";
}

/** Was this milestone submitted on chain during the event, at or past this anchor row? */
export function milestoneVerdict(
  read: MilestoneRead,
  anchor: Pick<QditSnapshotMilestoneAnchor, "version" | "proof_hash">,
  window: { opens: number; closes: number },
): Verdict {
  if (!read.ok) return read.reason;
  const record = read.record;
  if (record === null) return "no";
  const at = record.timestamp * 1000;
  if (at < window.opens || at > window.closes) return "no";
  if (record.version > anchor.version) return "yes";
  if (record.version < anchor.version) return "no";
  return anchor.proof_hash != null && record.proofHash.toLowerCase() === anchor.proof_hash.toLowerCase()
    ? "yes"
    : "no";
}

/**
 * Each milestone's latest `submit` anchor on the project's registered
 * contract, for milestones that are in the snapshot.
 */
export function milestoneCandidates(snapshot: QditSnapshotV1): QditSnapshotMilestoneAnchor[] {
  const contractId = snapshot.project.chain_contract_id;
  if (contractId == null) return [];
  const milestones = new Set(snapshot.milestones.map((m) => m.id));
  const latest = new Map<string, QditSnapshotMilestoneAnchor>();
  for (const a of snapshot.milestone_anchors) {
    if (a.action !== "submit" || a.contract_id !== contractId || !milestones.has(a.milestone_id)) continue;
    const seen = latest.get(a.milestone_id);
    if (!seen || a.version > seen.version) latest.set(a.milestone_id, a);
  }
  return [...latest.values()];
}

/**
 * Runs `check` over `items`, at most CHAIN_FACTS_CONCURRENCY at a time, until
 * `needed` say yes. Returns the confirmed keys, or throws the first failure
 * reason when the bar was not met and something went unanswered.
 */
async function confirm<T>(
  items: readonly T[],
  needed: number,
  key: (item: T) => string,
  check: (item: T) => Promise<Verdict>,
  deadline: number,
  now: () => number,
): Promise<string[]> {
  const confirmed: string[] = [];
  let failure: ChainUnavailableReason | null = null;
  let next = 0;
  const worker = async () => {
    while (next < items.length && confirmed.length < needed) {
      if (now() >= deadline) {
        failure ??= "budget";
        return;
      }
      const item = items[next++];
      let verdict: Verdict;
      try {
        verdict = await check(item);
      } catch {
        verdict = "decode";
      }
      if (verdict === "yes") confirmed.push(key(item));
      else if (verdict !== "no") failure ??= verdict;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHAIN_FACTS_CONCURRENCY, items.length) }, worker));
  if (confirmed.length < needed && failure) throw new ChainUnavailableError(failure);
  return confirmed;
}

/** Throws ChainUnavailableError when the chain could not settle a rule. */
export async function readChainFacts(input: ChainFactsInput, deps: ChainFactsDeps = {}): Promise<ChainFacts> {
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.budgetMs ?? CHAIN_FACTS_BUDGET_MS);
  const window = parseWindow(input.window);

  const notes = input.doqtri ? qualifyingNotes(input.doqtri, input.window) : [];
  // Fewer event notes than the bar fails the rule whatever the chain says: no reads.
  let anchoredNoteIds: string[] = [];
  if (notes.length >= MIN_ANCHORED_NOTES) {
    const registry = deps.registry === undefined ? registryConfig() : deps.registry;
    if (!registry) throw new ChainUnavailableError("unconfigured");
    const read = deps.readDocument ?? readRegistryDocument;
    anchoredNoteIds = await confirm(
      notes,
      MIN_ANCHORED_NOTES,
      (n) => n.doc_id.toLowerCase(),
      async (n) => noteVerdict(await read(registry, n.doc_id.toLowerCase()), n),
      deadline,
      now,
    );
  }

  const read = deps.readMilestone ?? readMilestone;
  const projectId = input.snapshot.project.id;
  const anchoredMilestoneIds = await confirm(
    milestoneCandidates(input.snapshot),
    MIN_ANCHORED_MILESTONES,
    (a) => a.milestone_id,
    async (a) =>
      milestoneVerdict(
        await read(
          { network: a.network, contractId: a.contract_id, rpcUrl: SOROBAN_RPC_URL[a.network] },
          projectId,
          a.milestone_id,
        ),
        a,
        window,
      ),
    deadline,
    now,
  );

  return { anchoredNoteIds, anchoredMilestoneIds };
}
