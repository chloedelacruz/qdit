import { ApiError, invalidRequest } from "./errors";

/**
 * Request bodies and path ids for `/api/v1` — contract sections 4 and 6.
 *
 *   - JSON only (`Content-Type: application/json`, any parameters), at most
 *     64 KiB, and an object at the top;
 *   - every field is named, and an unknown one is `400 invalid_request`
 *     rather than ignored, so a typo in a client never reads as success;
 *   - every problem found is reported at once in `details.fields`, field name
 *     to problem, so a client fixes a request in one round trip.
 *
 * A malformed id in the *path* is not a 400: the contract treats it as an
 * unknown id, `404 not_found` (section 6), which is what `pathId()` throws.
 *
 * Pure: no Next, no Supabase, so the rules are unit tested directly.
 */

export const MAX_BODY_BYTES = 64 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** doqtri's positional node id: the `node-id` rule of contract section 10. */
const NODE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** DoqtriRegistry `Document.version` is a `u32`. */
const MAX_DOC_VERSION = 4_294_967_295;

/** The longest `doc_url` the database accepts (`project_doc_links`). */
export const MAX_URL_LENGTH = 2048;

/** Titles and labels: 1 to 300 characters after trim, as Postgres counts them. */
export const MAX_TITLE_LENGTH = 300;

export type JsonObject = Record<string, unknown>;

/** The request's JSON object body, or `400 invalid_request`. */
export async function readJsonObject(request: Request): Promise<JsonObject> {
  const type = request.headers.get("content-type") ?? "";
  if (type.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw invalidRequest("The body must be JSON (Content-Type: application/json).", {
      body: "must be application/json",
    });
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw tooLarge();

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalidRequest("The body is not valid JSON.", { body: "must be valid JSON" });
  }

  if (!isObject(parsed)) {
    throw invalidRequest("The body must be a JSON object.", { body: "must be a JSON object" });
  }
  return parsed;
}

function tooLarge(): ApiError {
  return invalidRequest("The body is larger than 64 KiB.", { body: "must be at most 64 KiB" });
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A path segment that must be a UUID; anything else is an unknown id. */
export function pathId(value: string | undefined, notFound: string): string {
  if (!value || !UUID.test(value)) throw new ApiError("not_found", notFound);
  return value.toLowerCase();
}

/**
 * Collects field problems and throws them together. `prefix` names nested
 * fields the way a client wrote them (`link.node_id`).
 */
export class FieldErrors {
  readonly fields: Record<string, string> = {};

  add(field: string, problem: string): void {
    this.fields[field] ??= problem;
  }

  /** Every key of `body` not in `allowed` is an unknown field. */
  rejectUnknown(body: JsonObject, allowed: readonly string[], prefix = "", hints: Record<string, string> = {}): void {
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) this.add(prefix + key, hints[key] ?? "unknown field");
    }
  }

  throwIfAny(): void {
    if (Object.keys(this.fields).length > 0) {
      throw invalidRequest("Some fields are missing or invalid. See details.fields.", this.fields);
    }
  }
}

/** Field readers. Each returns the parsed value, or `undefined` after adding a problem. */

export function uuidField(errors: FieldErrors, name: string, value: unknown): string | undefined {
  if (value === undefined) return void errors.add(name, "is required");
  if (typeof value !== "string" || !UUID.test(value)) return void errors.add(name, "must be a UUID");
  return value.toLowerCase();
}

/** 1 to 300 characters after trim. Returns the trimmed text. */
export function titleField(errors: FieldErrors, name: string, value: unknown): string | undefined {
  if (value === undefined) return void errors.add(name, "is required");
  if (typeof value !== "string") return void errors.add(name, "must be a string");
  const trimmed = value.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > MAX_TITLE_LENGTH) {
    return void errors.add(name, "must be 1 to 300 characters after trimming");
  }
  return trimmed;
}

export function httpsUrlField(errors: FieldErrors, name: string, value: unknown): string | undefined {
  if (value === undefined) return void errors.add(name, "is required");
  if (typeof value !== "string") return void errors.add(name, "must be a string");

  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  // The string is stored as sent, so it is the string that has to be https,
  // not only what `URL` makes of it (which forgives leading spaces).
  if (!url || url.protocol !== "https:" || !url.hostname || !/^https:\/\/[^/?#\s]+/.test(value)) {
    return void errors.add(name, "must be an https URL");
  }
  if (value.length > MAX_URL_LENGTH) return void errors.add(name, "must be at most 2048 characters");
  return value;
}

export function nodeIdField(errors: FieldErrors, name: string, value: unknown): string | undefined {
  if (value === undefined) return void errors.add(name, "is required");
  if (typeof value !== "string" || !NODE_ID.test(value)) {
    return void errors.add(name, "must be a doqtri node id (1 to 64 of A-Z, a-z, 0-9, _ and -)");
  }
  return value;
}

/** Integer >= 1 (a u32), or null. Absent reads as null. */
export function docVersionField(errors: FieldErrors, name: string, value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_DOC_VERSION) {
    return void errors.add(name, "must be an integer from 1 to 4294967295, or null");
  }
  return value;
}

/** Text or null. Absent reads as null. */
export function optionalTextField(errors: FieldErrors, name: string, value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return void errors.add(name, "must be a string or null");
  return value;
}

/** `YYYY-MM-DD`, a real calendar date, or null. Absent reads as null. */
export function optionalDateField(errors: FieldErrors, name: string, value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  const match = typeof value === "string" ? DATE.exec(value) : null;
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      year >= 1 &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return value as string;
    }
  }
  return void errors.add(name, "must be a date as YYYY-MM-DD, or null");
}
