import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseUrl } from "@/lib/supabase/env";
import type { Database } from "@/lib/types/database";

/**
 * The node id of a published, linked milestone's doqtri heading, for the
 * public page's server only (WP-2.12, D-77).
 *
 * Contract section 12 lets the public page show the node id only under the
 * node-evidence rule: the heading's own DoqtriRegistry record names this
 * project and milestone on the project's chain. The page applies the rule,
 * but `public_milestone_proof()` is anon-callable over PostgREST and cannot
 * read the chain, so it no longer sends the node id at all
 * (20261026100200_public_proof_doc_source_hardening.sql). The page still
 * needs it, to know which `get_node` record to read, so it asks
 * `public_milestone_node_id()` here: the same publishing rule, granted to
 * service_role only, so no browser and no OAuth token can call it.
 *
 * Why the secret key, and why that is acceptable here: it is qdit asking its
 * own database for a pointer, not acting for a user, like the webhook outbox
 * (`./webhooks/outbox.ts`). The function is the whole surface: it takes a
 * slug and a milestone id, answers only for a project that publishes, and
 * returns one positional id or null. The page decides what a visitor sees.
 *
 * Never throws. `{ ok: false }` when the key is unset or the call fails: the
 * page then says it could not check the heading, never that it is unsigned.
 */
export type PublicNodeRead = { ok: true; nodeId: string | null } | { ok: false };

export async function readPublicNodeId(slug: string, milestoneId: string): Promise<PublicNodeRead> {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    console.error(
      "public proof: SUPABASE_SECRET_KEY is not set, so the linked doqtri heading cannot be looked up. See web/.env.example.",
    );
    return { ok: false };
  }

  try {
    const admin = createSupabaseClient<Database>(getSupabaseUrl(), secret, {
      // Per call, and never a visitor's session: none is read or written.
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("public_milestone_node_id", {
      p_slug: slug,
      p_milestone_id: milestoneId,
    });
    if (error) {
      console.error("public proof: could not look up the linked doqtri heading", error);
      return { ok: false };
    }
    return { ok: true, nodeId: typeof data === "string" && data !== "" ? data : null };
  } catch (error) {
    console.error("public proof: could not look up the linked doqtri heading", error);
    return { ok: false };
  }
}
