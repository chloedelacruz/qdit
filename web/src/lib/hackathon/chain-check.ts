import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { sha256Hex } from "@/lib/api/hackathon-snapshot-body";
import {
  readRegistryDocument,
  registryConfig,
  type DocumentRead,
  type RegistryConfig,
} from "@/lib/chain/doqtri-registry";
import { getSupabaseUrl } from "@/lib/supabase/env";
import type { Database, Json } from "@/lib/types/database";

/**
 * The chain check of a doqtri hackathon snapshot (WP-4.7, contract section 8,
 * "Chain check"), run in `after()` once the push has been answered.
 *
 * For each note: the lowercase hex SHA-256 of its markdown's UTF-8 bytes,
 * exactly as sent (section 12's `content_hash`), against
 * `DoqtriRegistry.get_document(doc_id).content_hash` on this deployment's
 * registry. Per `doc_id`:
 *
 *   matched       the registry holds the document with this hash
 *   mismatch      the registry holds the document with another hash
 *   not_anchored  the registry has no such document
 *   unchecked     no answer to trust: no registry configured, a read that
 *                 failed, timed out or did not decode, or the time budget
 *                 ran out before the note's turn (D-93: never `matched`)
 *
 * The result is for review in qdit only. It is not in the response and never
 * refuses a snapshot; a failure to record it is logged and dropped.
 *
 * Reads run at most `CHAIN_CHECK_CONCURRENCY` at a time. Each read already
 * gives up after `READ_TIMEOUT_MS` (5 s), and no read starts after
 * `CHAIN_CHECK_BUDGET_MS`, so 200 notes against a dead RPC finish inside the
 * route's `maxDuration`.
 *
 * The write is `record_doqtri_chain_check()`, granted to service_role only,
 * so it goes through a service-role client: qdit recording its own finding,
 * not acting for the caller. That is the only service-role use on this
 * endpoint (contract section 5). The client factory below is local on
 * purpose, the same ad-hoc pattern as `lib/public-node.ts` and
 * `lib/api/audit.ts`.
 */

export const CHAIN_CHECK_STATES = ["matched", "mismatch", "not_anchored", "unchecked"] as const;
export type ChainCheckState = (typeof CHAIN_CHECK_STATES)[number];

export const CHAIN_CHECK_CONCURRENCY = 5;
export const CHAIN_CHECK_BUDGET_MS = 45_000;

export type ChainCheckNote = { doc_id: string; markdown: string };

/** What is stored in `hackathon_doqtri_snapshots.chain_check`. */
export type ChainCheck = {
  checked_at: string;
  /** The registry read, or null when none is configured (then every note is `unchecked`). */
  registry: { network: string; contract_id: string } | null;
  notes: Record<string, ChainCheckState>;
};

export type ChainCheckDeps = {
  config?: RegistryConfig | null;
  read?: (config: RegistryConfig, docId: string) => Promise<DocumentRead>;
  now?: () => number;
  budgetMs?: number;
};

function verdict(read: DocumentRead, hash: string): ChainCheckState {
  if (!read.ok) return "unchecked";
  if (read.document === null) return "not_anchored";
  return read.document.contentHash.toLowerCase() === hash ? "matched" : "mismatch";
}

/** Checks every note. Never throws. */
export async function checkNotesOnChain(notes: readonly ChainCheckNote[], deps: ChainCheckDeps = {}): Promise<ChainCheck> {
  const config = deps.config === undefined ? registryConfig() : deps.config;
  const read = deps.read ?? readRegistryDocument;
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.budgetMs ?? CHAIN_CHECK_BUDGET_MS);

  const results: Record<string, ChainCheckState> = {};
  for (const note of notes) results[note.doc_id.toLowerCase()] = "unchecked";

  if (config) {
    let next = 0;
    const worker = async () => {
      while (next < notes.length && now() < deadline) {
        const note = notes[next++];
        const docId = note.doc_id.toLowerCase();
        let state: ChainCheckState = "unchecked";
        try {
          state = verdict(await read(config, docId), sha256Hex(note.markdown));
        } catch (error) {
          console.error(`hackathon chain check: reading ${docId} failed`, error);
        }
        results[docId] = state;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHAIN_CHECK_CONCURRENCY, notes.length) }, worker));
  }

  return {
    checked_at: new Date(now()).toISOString(),
    registry: config ? { network: config.network, contract_id: config.contractId } : null,
    notes: results,
  };
}

/** A per-call service-role client, or null when the key is not set. */
function serviceClient(): SupabaseClient<Database> | null {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createSupabaseClient<Database>(getSupabaseUrl(), secret, {
    // qdit acting for itself: no session is read or written.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Checks `notes` and stores the result on snapshot `id` (qdit's id, not
 * doqtri's `snapshot_id`). Never throws: it runs after the response.
 */
export async function recordChainCheck(
  id: string,
  notes: readonly ChainCheckNote[],
  deps: ChainCheckDeps & { client?: () => Pick<SupabaseClient<Database>, "rpc"> | null } = {},
): Promise<void> {
  try {
    const client = (deps.client ?? serviceClient)();
    if (!client) {
      console.error(
        "hackathon chain check: SUPABASE_SECRET_KEY is not set, so the result for snapshot " +
          `${id} cannot be stored. See web/.env.example.`,
      );
      return;
    }

    const check = await checkNotesOnChain(notes, deps);
    const { error } = await client.rpc("record_doqtri_chain_check", {
      p_snapshot_id: id,
      p_chain_check: check as unknown as Json,
    });
    if (error) console.error(`hackathon chain check: storing the result for snapshot ${id} failed`, error);
  } catch (error) {
    console.error(`hackathon chain check: snapshot ${id} failed`, error);
  }
}
