import { pathId } from "@/lib/api/body";
import { rpcError } from "@/lib/api/errors";
import { apiRoute, endpointNotFound, ok } from "@/lib/api/handler";

/**
 * One message for "no such project" and "this doc is not linked here": the
 * contract (section 8) says a 404 means either, and doqtri tells them apart
 * with `GET /projects`, never from this response.
 */
const NOT_FOUND = "No such doc link in this project.";

/**
 * `DELETE /api/v1/projects/{id}/docs/{doc_id}` — unlinks the doc and, in the
 * same transaction, every milestone link into it (D-22). Admin and above
 * (D-23). Milestones stay and their titles become editable in qdit again.
 *
 * `unlink_project_doc()` returns the ids of the link rows it removed, which
 * doqtri uses to clear its own `node_links`; `[]` when there were none.
 */
export const DELETE = apiRoute<{ id: string; doc_id: string }>(async ({ auth, params }) => {
  const projectId = pathId(params.id, NOT_FOUND);
  const docId = pathId(params.doc_id, NOT_FOUND);

  const { data, error } = await auth.supabase.rpc("unlink_project_doc", {
    p_project_id: projectId,
    p_doc_id: docId,
  });

  if (error) {
    if (error.code !== "P0002") console.error("api v1 project docs: unlink failed", error);
    throw rpcError(error, { notFound: NOT_FOUND, reasons: [] });
  }

  return ok({ removed_link_ids: data ?? [] });
});

// Every other method is an unknown endpoint (D-27, see `endpointNotFound`).
export const GET = endpointNotFound;
export const HEAD = endpointNotFound;
export const OPTIONS = endpointNotFound;
export const POST = endpointNotFound;
export const PUT = endpointNotFound;
export const PATCH = endpointNotFound;
