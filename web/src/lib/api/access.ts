import type { MemberRole } from "@/lib/types/database";

import type { ApiAuth } from "./auth";
import { ApiError, databaseError } from "./errors";
import {
  MILESTONE_RESOURCE_COLUMNS,
  toMilestone,
  type ApiMilestone,
  type MilestoneResourceRow,
} from "./resources";

/**
 * The two reads most `/api/v1` writes start with, both made with the caller's
 * token so RLS answers them.
 *
 * Contract section 8: a caller below an endpoint's minimum role gets
 * `403 forbidden` on a project they can see and `404 not_found` on one they
 * cannot. RLS alone cannot tell those apart — a refused UPDATE or DELETE just
 * touches no rows — so endpoints that write through PostgREST first ask for
 * the caller's own membership row, which the D-03 guard leaves readable to an
 * app for exactly this (20261024110000_oauth_client_guards.sql, section 4).
 * The RPCs make the same check inside the database.
 */

const RANK: Record<MemberRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: MemberRole, min: MemberRole): boolean {
  return RANK[role] >= RANK[min];
}

/**
 * The caller's role in `projectId`, if it is at least `min`. Throws
 * `not_found` (with `notFound`) when they are not a member, `forbidden` when
 * their role is too low.
 */
export async function requireRole(
  auth: ApiAuth,
  projectId: string,
  min: MemberRole,
  notFound: string,
): Promise<MemberRole> {
  const { data, error } = await auth.supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (error) {
    console.error("api v1: membership read failed", error);
    throw databaseError(error);
  }
  if (!data) throw new ApiError("not_found", notFound);

  if (!roleAtLeast(data.role, min)) {
    throw new ApiError(
      "forbidden",
      `This needs the ${min} role or higher in the project.`,
    );
  }
  return data.role;
}

/** One Milestone in the contract shape, or null when the caller cannot see it. */
export async function loadMilestone(
  auth: ApiAuth,
  milestoneId: string,
): Promise<ApiMilestone | null> {
  const { data, error } = await auth.supabase
    .from("milestones")
    .select(MILESTONE_RESOURCE_COLUMNS)
    .eq("id", milestoneId)
    .maybeSingle();

  if (error) {
    console.error("api v1: milestone read failed", error);
    throw databaseError(error);
  }
  return data ? toMilestone(data as unknown as MilestoneResourceRow) : null;
}
