import "server-only";

import { createHmac } from "node:crypto";

import type { MilestoneStatus } from "@/lib/types/database";

/**
 * The webhook body and its signature, exactly as docs/integration/CONTRACT.md
 * section 9 spells them. `signing.test.ts` checks the contract's worked
 * example byte for byte; change nothing here without changing the contract
 * in both repos first.
 */

/** The one event type in v1. */
export const WEBHOOK_EVENT = "milestone.status_changed";

export type WebhookEventRow = {
  id: string;
  event: string;
  project_id: string;
  milestone_id: string;
  status: MilestoneStatus;
  /** As the database returns it; any RFC 3339 offset. */
  occurred_at: string;
};

/**
 * `occurred_at` in UTC with milliseconds and a `Z`, as in the contract's
 * example. The outbox stores whole milliseconds, so this is lossless, and
 * the same row always gives the same string: a retry resends the same bytes.
 */
export function formatOccurredAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`webhooks: occurred_at is not a timestamp: ${value}`);
  }
  return date.toISOString();
}

/**
 * The raw body. Key order is the contract's; it carries ids and a status
 * only, never titles or other content.
 */
export function eventBody(row: WebhookEventRow): string {
  return JSON.stringify({
    id: row.id,
    event: row.event,
    project_id: row.project_id,
    milestone_id: row.milestone_id,
    status: row.status,
    occurred_at: formatOccurredAt(row.occurred_at),
  });
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
