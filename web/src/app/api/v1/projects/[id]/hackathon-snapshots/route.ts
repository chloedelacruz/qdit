import { after } from "next/server";

import { requireRole } from "@/lib/api/access";
import { pathId, readJsonBody } from "@/lib/api/body";
import {
  ApiError,
  databaseError,
  internalError,
  invalidRequest,
  unauthorized,
  type DatabaseErrorLike,
} from "@/lib/api/errors";
import { apiRoute, endpointNotFound, ok } from "@/lib/api/handler";
import {
  MAX_SNAPSHOT_BODY_BYTES,
  sha256Hex,
  validateHackathonSnapshot,
} from "@/lib/api/hackathon-snapshot-body";
import { recordChainCheck } from "@/lib/hackathon/chain-check";
import type { Json } from "@/lib/types/database";

const NO_PROJECT = "No such project.";
const NO_HACKATHON = "No such hackathon.";

/**
 * The chain check runs in `after()` within this budget: at most 45 s of
 * registry reads (`lib/hackathon/chain-check.ts`) plus the write.
 */
export const maxDuration = 60;

/** Section 8's four 409 reasons for this endpoint, with a sentence a caller may show. */
const SNAPSHOT_CONFLICTS = {
  snapshot_conflict: "This snapshot_id was already sent to this project with a different body. Send a new snapshot_id.",
  snapshot_limit: "This project has sent the most snapshots it may (30) to this hackathon.",
  hackathon_not_open: "This hackathon has not opened yet.",
  hackathon_closed: "This hackathon is closed for this project.",
} as const;

type SnapshotConflict = keyof typeof SNAPSHOT_CONFLICTS;

/**
 * `POST /api/v1/projects/{id}/hackathon-snapshots` — doqtri sends a
 * workspace snapshot to the project's entry in a qdit hackathon (contract
 * section 8, WP-4.7, D-117, D-118). Admin and above, doqtri's OAuth client
 * only. `201` when stored, `200` for a replay of the same bytes.
 *
 * The contract fixes the check order, first failure wins:
 *
 *   1. the token (`apiRoute`, 401), then the client: not doqtri's is 403.
 *      `is_doqtri_oauth_client()` answers from integration_settings, which
 *      no client reads; unset, every client is refused;
 *   2. the project: not a member (or a malformed id) is 404;
 *   3. the role: below admin is 403 (`requireRole`, as RLS sees it);
 *   4. the body: content type and size (2 MiB, `body`), then shape and
 *      limits (`@/lib/api/hackathon-snapshot-body`), 400;
 *   5-8. replay or `snapshot_conflict`, the hackathon (404), the cap and
 *      the window: all inside `push_doqtri_hackathon_snapshot()`, which also
 *      repeats 1 to 3 itself, since a hand-written PostgREST call skips
 *      this route.
 *
 * Steps 1 to 3 run before the body is read so that a caller who may not
 * push learns nothing from how its body is judged, and pays no 2 MiB parse.
 *
 * The idempotency hash is the SHA-256 of the raw body bytes, as received,
 * not of a re-serialization: a retry with the same bytes is a replay
 * whatever its key order or whitespace.
 *
 * Everything here runs with the caller's token. The one service-role write,
 * the chain check's result, happens after the response in `after()`, and
 * only for a snapshot this request stored (a replay was checked by the
 * request that stored it).
 */
export const POST = apiRoute<{ id: string }>(async ({ request, auth, params }) => {
  const { data: isDoqtri, error: clientError } = await auth.supabase.rpc("is_doqtri_oauth_client", {
    p_client_id: auth.clientId,
  });
  if (clientError) {
    console.error("api v1 hackathon snapshots: client check failed", clientError);
    throw databaseError(clientError);
  }
  if (isDoqtri !== true) {
    throw new ApiError("forbidden", "Only doqtri can send hackathon snapshots.");
  }

  const projectId = pathId(params.id, NO_PROJECT);
  await requireRole(auth, projectId, "admin", NO_PROJECT);

  const { body, bytes } = await readJsonBody(request, MAX_SNAPSHOT_BODY_BYTES);
  const checked = validateHackathonSnapshot(body);
  if (!checked.ok) {
    throw invalidRequest("Some fields are missing or invalid. See details.fields.", checked.fields);
  }
  const { snapshot } = checked;

  const { data, error } = await auth.supabase.rpc("push_doqtri_hackathon_snapshot", {
    p_hackathon_slug: snapshot.hackathon_slug,
    p_project_id: projectId,
    p_snapshot_id: checked.snapshotId,
    p_workspace_id: checked.workspaceId,
    p_payload: body as Json,
    p_payload_sha256: sha256Hex(bytes),
    p_note_count: snapshot.notes.length,
  });
  if (error) throw pushError(error);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.id !== "string") {
    console.error("api v1 hackathon snapshots: the push returned no row", data);
    throw internalError();
  }

  if (!row.replay) {
    const notes = snapshot.notes.map(({ doc_id, markdown }) => ({ doc_id, markdown }));
    after(() => recordChainCheck(row.id, notes));
  }

  return ok(
    {
      id: row.id,
      note_count: row.note_count,
      received_at: row.received_at,
      submission_state: row.submission_state,
    },
    row.replay ? 200 : 201,
  );
});

/**
 * Maps `push_doqtri_hackathon_snapshot()`'s errors onto the contract
 * (20261110100000_hackathons.sql):
 *
 *   42501 revoked       -> 401 (the token was revoked after `authenticate`)
 *   42501 otherwise     -> 403 (not doqtri's client, below admin)
 *   P0002               -> 404 (the hackathon, or the project if membership
 *                               changed since step 2)
 *   QD409 <reason>      -> 409 with details.reason, for the four reasons
 *   QD413               -> 400 body (not raised by this function today;
 *                               the contract never answers 413 itself)
 *   22023 snapshot_id   -> 400 on that field; 22023 payload -> 400 body;
 *                          any other 22023 is the route's bug -> 500
 *   anything else       -> databaseError() (503 unreachable, 401 JWT, 500)
 */
function pushError(error: DatabaseErrorLike): ApiError {
  switch (error.code) {
    case "42501":
      if (error.message === "This app's access to qdit was revoked.") return unauthorized();
      return new ApiError("forbidden", "This token is not allowed to send a snapshot to this project.");
    case "P0002":
      return new ApiError("not_found", error.message === NO_HACKATHON ? NO_HACKATHON : NO_PROJECT);
    case "QD409": {
      const reason = error.message as SnapshotConflict;
      if (Object.prototype.hasOwnProperty.call(SNAPSHOT_CONFLICTS, reason)) {
        return new ApiError("conflict", SNAPSHOT_CONFLICTS[reason], { details: { reason } });
      }
      console.error("api v1 hackathon snapshots: unknown conflict", error);
      return internalError();
    }
    case "QD413":
      return invalidRequest("The snapshot is too large to store.", { body: "is too large to store" });
    case "22023":
      if (error.hint === "snapshot_id") {
        return invalidRequest("Some fields are missing or invalid. See details.fields.", { snapshot_id: error.message ?? "is invalid" });
      }
      if (error.hint === "payload") {
        return invalidRequest("Some fields are missing or invalid. See details.fields.", { body: error.message ?? "is invalid" });
      }
      console.error("api v1 hackathon snapshots: the push refused an argument", error);
      return internalError();
    default:
      console.error("api v1 hackathon snapshots: push failed", error);
      return databaseError(error);
  }
}

// Every other method is an unknown endpoint (D-27, see `endpointNotFound`).
export const GET = endpointNotFound;
export const HEAD = endpointNotFound;
export const OPTIONS = endpointNotFound;
export const PUT = endpointNotFound;
export const PATCH = endpointNotFound;
export const DELETE = endpointNotFound;
