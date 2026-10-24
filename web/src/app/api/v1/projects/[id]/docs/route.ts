import {
  doqtriUrlField,
  FieldErrors,
  pathId,
  readJsonObject,
  titleField,
  uuidField,
} from "@/lib/api/body";
import { internalError, rpcError } from "@/lib/api/errors";
import { apiRoute, endpointNotFound, ok } from "@/lib/api/handler";
import { toDocLink } from "@/lib/api/resources";
import { doqtriOrigin } from "@/lib/doqtri-origin";

const NOT_FOUND = "No such project.";

/**
 * `POST /api/v1/projects/{id}/docs` — links a doqtri doc to the project
 * (contract section 8, D-09). Admin and above (D-23).
 *
 * `201` when the link is new, `200` when the same doc was already linked
 * here — a re-post refreshes `doc_title` and `doc_url` and is otherwise a
 * no-op, so doqtri can retry freely. A doc linked to another project is
 * `409 doc_linked_elsewhere`.
 *
 * `doc_url` must start with doqtri's origin (D-45, `DOQTRI_ORIGIN`); the
 * database holds it only to https, since the origin is deployment config.
 * A misconfigured `DOQTRI_ORIGIN` throws here and answers `500`, rather than
 * accepting or refusing every doc on a typo.
 *
 * The write is `link_project_doc()` (20261024120000_integration_links.sql):
 * insert-or-refresh has to be one statement to be idempotent under retries,
 * and the refresh is an UPDATE the D-03 guard does not give apps directly.
 * The function checks the caller's role itself.
 */
export const POST = apiRoute<{ id: string }>(async ({ request, auth, params }) => {
  const projectId = pathId(params.id, NOT_FOUND);
  const body = await readJsonObject(request);

  const errors = new FieldErrors();
  errors.rejectUnknown(body, ["doc_id", "doc_title", "doc_url"]);
  const docId = uuidField(errors, "doc_id", body.doc_id);
  const docTitle = titleField(errors, "doc_title", body.doc_title);
  const docUrl = doqtriUrlField(errors, "doc_url", body.doc_url, doqtriOrigin());
  errors.throwIfAny();

  const { data, error } = await auth.supabase.rpc("link_project_doc", {
    p_project_id: projectId,
    p_doc_id: docId!,
    p_doc_title: docTitle!,
    p_doc_url: docUrl!,
  });

  if (error) {
    if (error.code !== "P0002" && error.code !== "QD409") {
      console.error("api v1 project docs: link failed", error);
    }
    throw rpcError(error, { notFound: NOT_FOUND, reasons: ["doc_linked_elsewhere"] });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw internalError();

  return ok(toDocLink(row), row.created ? 201 : 200);
});

// Every other method is an unknown endpoint (D-27, see `endpointNotFound`).
export const GET = endpointNotFound;
export const HEAD = endpointNotFound;
export const OPTIONS = endpointNotFound;
export const PUT = endpointNotFound;
export const PATCH = endpointNotFound;
export const DELETE = endpointNotFound;
