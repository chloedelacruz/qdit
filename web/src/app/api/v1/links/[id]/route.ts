import { loadMilestone, requireRole } from "@/lib/api/access";
import { docVersionField, FieldErrors, nodeIdField, pathId, readJsonObject } from "@/lib/api/body";
import { ApiError, conflict, databaseError } from "@/lib/api/errors";
import { apiRoute, endpointNotFound, noContent, ok, type ApiContext } from "@/lib/api/handler";
import type { TablesUpdate } from "@/lib/types/database";

const NOT_FOUND = "No such link.";

type LinkRef = { id: string; milestone_id: string; project_id: string; doc_id: string };

/**
 * The link the path names, and the caller's right to change it (member and
 * above, D-23). The row is read with the caller's token, so a link in a
 * project they cannot see is a 404 like a missing one (section 6).
 */
async function writableLink({ auth, params }: ApiContext<{ id: string }>): Promise<LinkRef> {
  const linkId = pathId(params.id, NOT_FOUND);

  const { data, error } = await auth.supabase
    .from("milestone_external_links")
    .select("id, milestone_id, project_id, doc_id")
    .eq("id", linkId)
    .maybeSingle();

  if (error) {
    console.error("api v1 links: read failed", error);
    throw databaseError(error);
  }
  if (!data) throw new ApiError("not_found", NOT_FOUND);

  await requireRole(auth, data.project_id, "member", NOT_FOUND);
  return data;
}

/**
 * `PATCH /api/v1/links/{id}` — re-points a link in place after its heading
 * moved or the doc was re-anchored (D-21). `{id}` is the link id.
 *
 * `{node_id?, doc_version?}`, at least one. `node_label` is refused: it
 * changes only with the title, through `PATCH /milestones/{id}` (D-12). The
 * database refuses every other column too (`check_milestone_external_link()`).
 * Moving onto a node that already has a milestone is
 * `409 node_already_linked`, naming that milestone.
 */
export const PATCH = apiRoute<{ id: string }>(async (context) => {
  const body = await readJsonObject(context.request);

  const errors = new FieldErrors();
  errors.rejectUnknown(body, ["node_id", "doc_version"], "", {
    node_label: "cannot be set here; rename the milestone with PATCH /milestones/{id}",
  });
  const patch: TablesUpdate<"milestone_external_links"> = {};
  if (body.node_id !== undefined) patch.node_id = nodeIdField(errors, "node_id", body.node_id);
  if (body.doc_version !== undefined) {
    patch.doc_version = docVersionField(errors, "doc_version", body.doc_version);
  }
  if (Object.keys(body).length === 0) {
    errors.add("body", "must include node_id or doc_version");
  }
  errors.throwIfAny();

  const link = await writableLink(context);
  const { auth } = context;

  const { data, error } = await auth.supabase
    .from("milestone_external_links")
    .update(patch)
    .eq("id", link.id)
    .select("id");

  if (error?.code === "23505" && patch.node_id) {
    const { data: holder } = await auth.supabase
      .from("milestone_external_links")
      .select("milestone_id")
      .eq("doc_id", link.doc_id)
      .eq("node_id", patch.node_id)
      .maybeSingle();
    throw conflict("node_already_linked", holder?.milestone_id ?? null);
  }
  if (error) {
    console.error("api v1 links: update failed", error);
    throw databaseError(error);
  }
  if (!data || data.length === 0) throw new ApiError("not_found", NOT_FOUND);

  const milestone = await loadMilestone(auth, link.milestone_id);
  if (!milestone) throw new ApiError("not_found", NOT_FOUND);
  return ok(milestone);
});

/**
 * `DELETE /api/v1/links/{id}` — removes one link (contract section 8). The
 * milestone stays and its title becomes editable in qdit again. `204`; a
 * repeated delete is `404`.
 */
export const DELETE = apiRoute<{ id: string }>(async (context) => {
  const link = await writableLink(context);

  const { data, error } = await context.auth.supabase
    .from("milestone_external_links")
    .delete()
    .eq("id", link.id)
    .select("id");

  if (error) {
    console.error("api v1 links: delete failed", error);
    throw databaseError(error);
  }
  if (!data || data.length === 0) throw new ApiError("not_found", NOT_FOUND);

  return noContent();
});

// Every other method is an unknown endpoint (D-27, see `endpointNotFound`).
export const GET = endpointNotFound;
export const HEAD = endpointNotFound;
export const OPTIONS = endpointNotFound;
export const POST = endpointNotFound;
export const PUT = endpointNotFound;
