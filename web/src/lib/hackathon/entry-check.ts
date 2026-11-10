import "server-only";

import { ChainUnavailableError, readChainFacts, type ChainFactsInput } from "@/lib/hackathon/chain-facts";
import { checkEligibility } from "@/lib/hackathon/eligibility";
import { CHAIN_RULES, CHAIN_UNCHECKED_REASON } from "@/lib/hackathon/entry-check-copy";
import { asDoqtriSnapshot, asQditSnapshot } from "@/lib/hackathon/grading-store";
import type { ChainFacts, EntryCheck, HackathonWindow } from "@/lib/hackathon/types";

/**
 * The submission dialog's pre-submit check (WP-4.7, QDIT-55): the eligibility
 * gate run on what `submit_hackathon_entry()` would freeze right now, as
 * `preview_hackathon_entry()` returns it.
 *
 * Advisory only. The dialog shows the result and always offers "Submit
 * anyway"; grading never reads it and computes the gate itself from the
 * frozen version (QDIT-54).
 *
 * A chain that does not answer (or no registry configured) does not fail the
 * check: the two chain rules come back unchecked (`passed: null`), the rest
 * are judged as usual.
 */

/** The dialog cannot wait as long as the grader may. */
export const ENTRY_CHECK_CHAIN_BUDGET_MS = 15_000;

const NO_CHAIN: ChainFacts = { anchoredNoteIds: [], anchoredMilestoneIds: [] };

export type EntryCheckInput = {
  window: HackathonWindow;
  memberIds: readonly string[];
  hasGlobalMindmapImage: boolean;
  /** `preview_hackathon_entry()`'s answer, unparsed. */
  preview: unknown;
};

export type EntryCheckDeps = {
  readChain?: (input: ChainFactsInput) => Promise<ChainFacts>;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Throws on a preview that is not the RPC's shape. */
export async function checkEntry(input: EntryCheckInput, deps: EntryCheckDeps = {}): Promise<EntryCheck> {
  const preview = isRecord(input.preview) ? input.preview : {};
  const snapshot = asQditSnapshot(preview.qdit_snapshot);
  const doqtri = asDoqtriSnapshot(preview.doqtri_snapshot ?? null);
  const receivedAt = typeof preview.doqtri_received_at === "string" ? preview.doqtri_received_at : null;
  const noteCount = typeof preview.doqtri_note_count === "number" ? preview.doqtri_note_count : null;

  const readChain =
    deps.readChain ?? ((chainInput) => readChainFacts(chainInput, { budgetMs: ENTRY_CHECK_CHAIN_BUDGET_MS }));

  let chain = NO_CHAIN;
  let chainUnavailable = false;
  try {
    chain = await readChain({ window: input.window, snapshot, doqtri });
  } catch (error) {
    if (!(error instanceof ChainUnavailableError)) throw error;
    chainUnavailable = true;
  }

  const result = checkEligibility({
    window: input.window,
    teamMemberIds: input.memberIds,
    snapshot,
    doqtri,
    hasGlobalMindmapImage: input.hasGlobalMindmapImage,
    chain,
  });

  const rules = result.rules.map((rule) =>
    chainUnavailable && CHAIN_RULES.has(rule.id)
      ? { id: rule.id, passed: null, reason: CHAIN_UNCHECKED_REASON }
      : { id: rule.id, passed: rule.passed, reason: rule.reason },
  );

  return {
    allPassed: rules.every((r) => r.passed === true),
    rules,
    chainUnavailable,
    doqtri: doqtri && receivedAt && noteCount != null ? { receivedAt, noteCount } : null,
  };
}
