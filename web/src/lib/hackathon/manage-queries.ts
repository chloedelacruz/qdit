import type { SupabaseClient } from "@supabase/supabase-js";

import type { ManagedHackathon } from "@/components/hackathon/manage-hackathons";
import type { Database } from "@/lib/types/database";

/**
 * The management page's data (QDIT-56): `hackathon_manage_list()` (every
 * hackathon for an operator, their own for a hackathon admin) and whether
 * the caller is an operator. Throws on a failed list so the error boundary
 * offers a retry.
 */
export async function loadManagePage(supabase: SupabaseClient<Database>): Promise<{
  hackathons: ManagedHackathon[];
  isOperator: boolean;
  /** The request's clock, for each row's open/closed badge. */
  nowMs: number;
}> {
  const [listRes, operatorRes] = await Promise.all([
    supabase.rpc("hackathon_manage_list"),
    supabase.rpc("is_qdit_operator"),
  ]);
  if (listRes.error) throw new Error("Could not load the hackathons you manage.");

  return {
    hackathons: (listRes.data ?? []).map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      opensAt: r.opens_at,
      closesAt: r.closes_at,
      teamMin: r.team_min,
      teamMax: r.team_max,
      finalistCount: r.finalist_count,
      hidden: r.hidden,
      releasedAt: r.released_at,
      entries: Number(r.entries),
      snapshots: Number(r.snapshots),
      canDelete: r.can_delete,
    })),
    isOperator: operatorRes.data === true,
    nowMs: Date.now(),
  };
}
