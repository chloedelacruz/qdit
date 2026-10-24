import { loadMilestone } from "@/lib/api/access";
import {
  docVersionField,
  FieldErrors,
  isObject,
  nodeIdField,
  optionalDateField,
  optionalTextField,
  readJsonObject,
  titleField,
  uuidField,
} from "@/lib/api/body";
import { internalError, rpcError } from "@/lib/api/errors";
import { apiRoute, endpointNotFound, ok } from "@/lib/api/handler";

/**
 * `POST /api/v1/milestones` — creates a milestone and its doqtri link in one
 * transaction (contract section 8). Member and above in `project_id` (D-23).
 *
 * Status always starts at `proposed` and the milestone goes after the
 * project's last `order_index`. The title is stored as both `milestones.title`
 * and `link.node_label`, trimmed.
 *
 * `create_linked_milestone()` (20261024120000_integration_links.sql) does the
 * work: it re-checks the caller's role, refuses a doc that is not linked to
 * the project (`409 doc_not_linked`) and a node that already has a milestone
 * (`409 node_already_linked`, naming that milestone so a retried create can
 * recover). The response is then read back with the caller's token, as any
 * GET would be.
 */
export const POST = apiRoute(async ({ request, auth }) => {
  const body = await readJsonObject(request);

  const errors = new FieldErrors();
  errors.rejectUnknown(body, ["project_id", "title", "description", "due_date", "link"]);
  const projectId = uuidField(errors, "project_id", body.project_id);
  const title = titleField(errors, "title", body.title);
  const description = optionalTextField(errors, "description", body.description);
  const dueDate = optionalDateField(errors, "due_date", body.due_date);

  let docId: string | undefined;
  let nodeId: string | undefined;
  let docVersion: number | null | undefined;
  if (body.link === undefined) {
    errors.add("link", "is required");
  } else if (!isObject(body.link)) {
    errors.add("link", "must be an object");
  } else {
    errors.rejectUnknown(body.link, ["doc_id", "node_id", "doc_version"], "link.");
    docId = uuidField(errors, "link.doc_id", body.link.doc_id);
    nodeId = nodeIdField(errors, "link.node_id", body.link.node_id);
    docVersion = docVersionField(errors, "link.doc_version", body.link.doc_version);
  }
  errors.throwIfAny();

  const { data: milestoneId, error } = await auth.supabase.rpc("create_linked_milestone", {
    p_project_id: projectId!,
    p_title: title!,
    p_description: description ?? null,
    p_due_date: dueDate ?? null,
    p_doc_id: docId!,
    p_node_id: nodeId!,
    p_doc_version: docVersion ?? null,
  });

  if (error) {
    if (error.code !== "P0002" && error.code !== "QD409") {
      console.error("api v1 milestones: create failed", error);
    }
    throw rpcError(error, {
      notFound: "No such project.",
      reasons: ["doc_not_linked", "node_already_linked"],
    });
  }

  const milestone = milestoneId ? await loadMilestone(auth, milestoneId) : null;
  if (!milestone) throw internalError();

  return ok(milestone, 201);
});

// Every other method is an unknown endpoint (D-27, see `endpointNotFound`).
export const GET = endpointNotFound;
export const HEAD = endpointNotFound;
export const OPTIONS = endpointNotFound;
export const PUT = endpointNotFound;
export const PATCH = endpointNotFound;
export const DELETE = endpointNotFound;
