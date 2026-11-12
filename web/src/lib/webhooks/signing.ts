import "server-only";

import { createHmac } from "node:crypto";

import type { MilestoneStatus } from "@/lib/types/database";

/**
 * The webhook body and its signature, exactly as docs/integration/CONTRACT.md
 * section 9 spells them. `signing.test.ts` checks the contract's worked
 * example byte for byte; change nothing here without changing the contract
 * in both repos first.
 */

/** The first event type of v1: a linked milestone's status changed (section 9). */
export const WEBHOOK_EVENT = "milestone.status_changed";

/** Contract v1.5.0 (QDIT-67): a hackathon's grades were released (section 9). */
export const HACKATHON_RELEASED_EVENT = "hackathon.released";

/**
 * An outbox row as `claim_integration_events` returns it. The database's
 * `integration_events_shape` check guarantees that a milestone event has
 * its project, milestone and status and a release event its slug and
 * `released_at`; `eventBody` refuses a row that breaks that rather than send
 * a body with nulls in it.
 */
export type WebhookEventRow = {
  id: string;
  event: string;
  project_id: string | null;
  milestone_id: string | null;
  status: MilestoneStatus | null;
  hackathon_slug?: string | null;
  /** As the database returns it; any RFC 3339 offset. */
  released_at?: string | null;
  /** As the database returns it; any RFC 3339 offset. */
  occurred_at: string;
};

/**
 * `occurred_at` in UTC with milliseconds and a `Z`, as in the contract's
 * example. The outbox stores whole milliseconds, so this is lossless, and
 * the same row always gives the same string: a retry resends the same bytes.
 */
export function formatOccurredAt(value: string): string {
  return formatTimestamp(value, "occurred_at");
}

/** The same for any body timestamp (`released_at` too, v1.5.0). */
function formatTimestamp(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`webhooks: ${field} is not a timestamp: ${value}`);
  }
  return date.toISOString();
}

/**
 * The raw body. Key order is the contract's; it carries ids, a status or a
 * release time only, never titles or other content. Throws on a row whose
 * type is unknown or whose columns do not fit its type.
 */
export function eventBody(row: WebhookEventRow): string {
  if (row.event === WEBHOOK_EVENT) {
    if (!row.project_id || !row.milestone_id || !row.status) {
      throw new Error(`webhooks: event ${row.id} is a milestone event without its milestone`);
    }
    return JSON.stringify({
      id: row.id,
      event: row.event,
      project_id: row.project_id,
      milestone_id: row.milestone_id,
      status: row.status,
      occurred_at: formatOccurredAt(row.occurred_at),
    });
  }
  if (row.event === HACKATHON_RELEASED_EVENT) {
    if (!row.hackathon_slug || !row.released_at) {
      throw new Error(`webhooks: event ${row.id} is a release event without its hackathon`);
    }
    return JSON.stringify({
      id: row.id,
      event: row.event,
      hackathon_slug: row.hackathon_slug,
      released_at: formatTimestamp(row.released_at, "released_at"),
      occurred_at: formatOccurredAt(row.occurred_at),
    });
  }
  throw new Error(`webhooks: event ${row.id} has an unknown type`);
}

/** `X-Qdit-Timestamp`: Unix time in whole seconds, as a decimal string. */
export function webhookTimestamp(now: Date): string {
  return Math.floor(now.getTime() / 1000).toString();
}

/**
 * Lowercase hex HMAC-SHA256, keyed with the UTF-8 bytes of the secret, over
 * `<timestamp>.<raw body>`.
 */
export function webhookSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
}

/**
 * `X-Qdit-Signature`: one `sha256=<hex>` per secret, comma-separated. Two
 * secrets only while one is being rotated in; a match on any one is valid
 * for the receiver.
 */
export function signatureHeader(
  secrets: readonly string[],
  timestamp: string,
  rawBody: string,
): string {
  if (secrets.length === 0) throw new Error("webhooks: no signing secret");
  return secrets
    .map((secret) => `sha256=${webhookSignature(secret, timestamp, rawBody)}`)
    .join(",");
}
