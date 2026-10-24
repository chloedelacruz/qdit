import { databaseError } from "@/lib/api/errors";
import { apiRoute, json } from "@/lib/api/handler";
import {
  afterCursorFilter,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from "@/lib/api/pagination";
import { PROJECT_COLUMNS, toProject, type ApiProject } from "@/lib/api/resources";

/**
 * `GET /api/v1/projects` — the projects the caller is a member of, with the
 * caller's role in each (contract section 8).
 *
 * doqtri shows this list when a workspace admin picks the project a doc
 * belongs to (D-09). Any role may list; what the caller can then *do* in a
 * project is decided per endpoint by that role and by RLS.
 *
 * The `project_members!inner` embed, filtered to the caller, both supplies
 * `role` and restricts the list to member projects. RLS would restrict it
 * anyway ("projects: read as member"); the filter is what makes the embed
 * return exactly the caller's own membership row rather than every member's.
 *
 * One row past `limit` is fetched to learn whether another page exists
 * without a second count query.
 */
export const GET = apiRoute(async ({ request, auth }) => {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params.get("limit"));
  const cursor = decodeCursor(params.get("cursor"));

  let query = auth.supabase
    .from("projects")
    .select(`${PROJECT_COLUMNS}, project_members!inner(role)`)
    .eq("project_members.user_id", auth.userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (cursor) query = query.or(afterCursorFilter(cursor));

  const { data, error } = await query;

  if (error) {
    console.error("api v1 projects: list failed", error);
    throw databaseError(error);
  }

  const rows = data ?? [];
  const page = rows.slice(0, limit);
  const last = page.at(-1);

  const projects: ApiProject[] = page.flatMap((row) => {
    const role = row.project_members[0]?.role;
    // The inner join makes a row without the caller's membership impossible;
    // dropping one is safer than inventing a role for it.
    return role ? [toProject(row, role)] : [];
  });

  return json({
    data: projects,
    next_cursor:
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.created_at, id: last.id })
        : null,
  });
});
