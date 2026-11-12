import { after } from "next/server";

import { requireRole } from "@/lib/api/access";
import { pathId, readJsonBody } from "@/lib/api/body";
import { ApiError, databaseError, internalError, invalidRequest } from "@/lib/api/errors";
import { apiRoute, endpointNotFound, ok } from "@/lib/api/handler";
import {
  MAX_SNAPSHOT_BODY_BYTES,
  sha256Hex,
  validateHackathonSnapshot,
} from "@/lib/api/hackathon-snapshot-body";
import { NO_PROJECT, pushError } from "@/lib/api/hackathon-snapshot-errors";
import { doqtriOrigin } from "@/lib/doqtri-origin";
import { recordChainCheck } from "@/lib/hackathon/chain-check";
import type { Json } from "@/lib/types/database";

/**
 * The chain check runs in `after()` within this budget: at most 45 s of
 * registry reads (`lib/hackathon/chain-check.ts`) plus the write.
 */
export const maxDuration = 60;

/**
 * `POST /api/v1/projects/{id}/hackathon-snapshots` — doqtri sends a
 * workspace snapshot to the project's entry in a qdit hackathon (contract
 * section 8, WP-4.7, D-117, D-118). Admin and above, doqtri's OAuth client
 * only. `201` when stored, `200` for a replay of the same bytes.
 *
 * The contract fixes the check order, first failure wins:
 *
 *   1. the token (`apiRoute`, 401): `authenticate()` verifies it and asks
 *      `oauth_token_revoked()` (D-59) before this handler runs at all, so a
 *      revoked token is refused before any step below. Then the client: not
 *      doqtri's is 403.
 *      `is_doqtri_oauth_client()` answers from integration_settings, which
 *      no client reads; unset, every client is refused;
 *   2. the project: not a member (or a malformed id) is 404;
 *   3. the role: below admin is 403 (`requireRole`, as RLS sees it);
 *   4. the body: content type and size (2 MiB, `body`), then shape and
 *      limits (`@/lib/api/hackathon-snapshot-body`), 400; the optional
 *      `mindmap_url` against `DOQTRI_ORIGIN` (v1.4.0, QDIT-66), which the
 *      database stores from the payload in its own column;
 *   5-8. replay or `snapshot_conflict`, the hackathon (404), the cap and
 *      the window: all inside `push_doqtri_hackathon_snapshot()`, which also
 *      repeats 1 to 3 itself, since a hand-written PostgREST call skips
 *      this route.
 *
 * Steps 1 to 3 run before the body is read so that a caller who may not
 * push learns nothing from how its body is judged, and pays no 2 MiB parse.
 *
 * The idempotency hash is the SHA-256 of the raw body bytes, as received,
 * not of a re-serialization: only a retry with the very same bytes is a
 * replay (any other body under the key, even one that parses the same, is
 * `snapshot_conflict`). What is stored is the parsed object; for duplicate
 * keys that is the last one (`readJsonBody`).
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
  const checked = validateHackathonSnapshot(body, { doqtriOrigin: () => doqtriOrigin() });
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
  // The function's errors, mapped in `@/lib/api/hackathon-snapshot-errors`.
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

// Every other method is an unknown endpoint (D-27, see `endpointNotFound`).
export const GET = endpointNotFound;
export const HEAD = endpointNotFound;
export const OPTIONS = endpointNotFound;
export const PUT = endpointNotFound;
export const PATCH = endpointNotFound;
export const DELETE = endpointNotFound;
