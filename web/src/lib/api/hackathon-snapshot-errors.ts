import { ApiError, databaseError, internalError, invalidRequest, unauthorized, type DatabaseErrorLike } from "./errors";

/**
 * How `push_doqtri_hackathon_snapshot()` (20261110100000_hackathons.sql)
 * fails, mapped onto contract section 8 for
 * `POST /api/v1/projects/{id}/hackathon-snapshots`.
 *
 * Some of it keys on the database's message text, which is brittle: the
 * strings below are asserted verbatim against the migration by
 * `hackathon-snapshot-errors.test.ts`, so a rewording in SQL fails the tests
 * rather than silently turning a 401 into a 403 or a 409 into a 500.
 */

export const NO_PROJECT = "No such project.";

/** `raise exception 'No such hackathon.' using errcode = 'P0002'`. */
export const NO_HACKATHON = "No such hackathon.";

/** `raise exception 'This app''s access to qdit was revoked.' using errcode = '42501'`. */
export const REVOKED_MESSAGE = "This app's access to qdit was revoked.";

/** The 22023 hints that name a field of the request (the others are the route's own arguments). */
export const FIELD_HINTS = { snapshot_id: "snapshot_id", payload: "body" } as const;

/** Section 8's four 409 reasons (the QD409 MESSAGE token), with a sentence a caller may show. */
export const SNAPSHOT_CONFLICTS = {
  snapshot_conflict: "This snapshot_id was already sent to this project with a different body. Send a new snapshot_id.",
  snapshot_limit: "This project has sent the most snapshots it may (30) to this hackathon.",
  hackathon_not_open: "This hackathon has not opened yet.",
  hackathon_closed: "This hackathon is closed for this project.",
} as const;

export type SnapshotConflict = keyof typeof SNAPSHOT_CONFLICTS;

/**
 *   42501 revoked       -> 401 (the token was revoked after `authenticate`)
 *   42501 otherwise     -> 403 (not doqtri's client, below admin)
 *   P0002               -> 404 (the hackathon, or the project if membership
 *                               changed since the route's own check)
 *   QD409 <reason>      -> 409 with details.reason, for the four reasons;
 *                          any other token -> 500
 *   QD413               -> 400 body (`payload_too_large`: the payload over
 *                               2 MiB as the database measures it; the
 *                               contract never answers 413 itself)
 *   22023 snapshot_id   -> 400 on that field; 22023 payload -> 400 body;
 *                          any other 22023 is the route's bug -> 500
 *   anything else       -> databaseError() (503 unreachable, 401 JWT, 500)
 */
export function pushError(error: DatabaseErrorLike): ApiError {
  switch (error.code) {
    case "42501":
      if (error.message === REVOKED_MESSAGE) return unauthorized();
      return new ApiError("forbidden", "This token is not allowed to send a snapshot to this project.");
    case "P0002":
      return new ApiError("not_found", error.message === NO_HACKATHON ? NO_HACKATHON : NO_PROJECT);
    case "QD409": {
      const reason = error.message ?? "";
      if (Object.hasOwn(SNAPSHOT_CONFLICTS, reason)) {
        return new ApiError("conflict", SNAPSHOT_CONFLICTS[reason as SnapshotConflict], { details: { reason } });
      }
      console.error("api v1 hackathon snapshots: unknown conflict", error);
      return internalError();
    }
    case "QD413":
      return invalidRequest("The snapshot is too large to store.", { body: "is too large to store" });
    case "22023": {
      const hint = error.hint ?? "";
      if (Object.hasOwn(FIELD_HINTS, hint)) {
        return invalidRequest("Some fields are missing or invalid. See details.fields.", {
          [FIELD_HINTS[hint as keyof typeof FIELD_HINTS]]: error.message ?? "is invalid",
        });
      }
      console.error("api v1 hackathon snapshots: the push refused an argument", error);
      return internalError();
    }
    default:
      console.error("api v1 hackathon snapshots: push failed", error);
      return databaseError(error);
  }
}
