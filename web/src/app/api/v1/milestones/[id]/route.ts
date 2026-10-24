import { loadMilestone, requireRole } from "@/lib/api/access";
import { FieldErrors, pathId, readJsonObject, titleField } from "@/lib/api/body";
import { ApiError, conflict, databaseError } from "@/lib/api/errors";
import { apiRoute, endpointNotFound, ok } from "@/lib/api/handler";

const NOT_FOUND = "No such milestone.";

/**
 * `GET /api/v1/milestones/{id}` — one Milestone (contract section 7), the
 * data behind doqtri's preview card. Viewer and above: RLS returns nothing
 * for a milestone the caller cannot see, which is a 404.
 *
 * Carries `link` and the newest anchor's proof and transaction hashes
 * (`anchor`, D-32). Those mirror public chain data and are a pointer, not
 * proof: doqtri reads milestone_proof itself before acting (D-04).
 */
export const GET = apiRoute<{ id: string }>(async ({ auth, params }) => {
  const milestone = await loadMilestone(auth, pathId(params.id, NOT_FOUND));
  if (!milestone) throw new ApiError("not_found", NOT_FOUND);
  return ok(milestone);
});

/**
 * `PATCH /api/v1/milestones/{id}` — renames a linked milestone (D-12).
 * Member and above. The body is exactly `{"title": "..."}`.
 *
 * This is the one way a linked milestone's title changes: qdit's own UI shows
 * it read-only, and the database lets only an OAuth client change it
 * (`guard_milestone_update()`). A trigger sets the link's `node_label` to the
 * same value in the same statement, so the two never differ.
 *
 * The milestone and the caller's role are read first, because a refused
 * UPDATE touches no rows and cannot say whether that was 403, 404 or 409.
 */
export const PATCH = apiRoute<{ id: string }>(async ({ request, auth, params }) => {
  const milestoneId = pathId(params.id, NOT_FOUND);
  const body = await readJsonObject(request);

  const errors = new FieldErrors();
  errors.rejectUnknown(body, ["title"]);
  const title = titleField(errors, "title", body.title);
  errors.throwIfAny();

  const current = await loadMilestone(auth, milestoneId);
  if (!current) throw new ApiError("not_found", NOT_FOUND);

  await requireRole(auth, current.project.id, "member", NOT_FOUND);
  if (!current.link) throw conflict("milestone_not_linked");

  const { data, error } = await auth.supabase
    .from("milestones")
    .update({ title: title! })
    .eq("id", milestoneId)
    .select("id");

  if (error) {
    console.error("api v1 milestones: rename failed", error);
    throw databaseError(error);
  }

  const renamed = await loadMilestone(auth, milestoneId);
  if (!renamed) throw new ApiError("not_found", NOT_FOUND);

  // No row updated: the link went away between the read and the write, so
  // the guard filtered the row out.
  if (!data || data.length === 0) {
    if (!renamed.link) throw conflict("milestone_not_linked");
    throw new ApiError("forbidden", "This token is not allowed to do that.");
  }

  return ok(renamed);
});

// Every other method is an unknown endpoint (D-27, see `endpointNotFound`).
export const HEAD = endpointNotFound;
export const OPTIONS = endpointNotFound;
export const POST = endpointNotFound;
export const PUT = endpointNotFound;
export const DELETE = endpointNotFound;
