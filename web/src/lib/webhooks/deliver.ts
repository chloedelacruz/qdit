import "server-only";

import type { Database } from "@/lib/types/database";

import { nextAttemptAt } from "./backoff";
import { decryptWebhookSecret } from "./secret-box";
import { eventBody, signatureHeader, webhookTimestamp } from "./signing";

/**
 * Sends claimed outbox events (docs/integration/CONTRACT.md section 9).
 *
 * The database decides what may be sent: `claim_integration_events` returns
 * only the head of each (webhook, milestone) queue (D-25), counts the
 * attempt and leases the row. This module posts each claimed event once,
 * signed, and reports the outcome with the time of the next attempt from
 * `./backoff.ts`, or null when it was the last. It then claims again, so an
 * event released by its predecessor's delivery goes out in the same run.
 *
 * Every dependency is passed in, so the tests drive it with a fake outbox,
 * a fake fetch and a fixed clock.
 */

export type ClaimedEvent =
  Database["public"]["Functions"]["claim_integration_events"]["Returns"][number];

export type DeliveryReport = {
  id: string;
  claimToken: string;
  delivered: boolean;
  error: string | null;
  nextAttemptAt: Date | null;
};

export type DeliveryOutcome = Database["public"]["Functions"]["record_integration_delivery"]["Returns"];

export interface Outbox {
  claim(limit: number): Promise<ClaimedEvent[]>;
  record(report: DeliveryReport): Promise<DeliveryOutcome>;
}

export type DeliveryDeps = {
  outbox: Outbox;
  fetch: typeof fetch;
  encryptionKey: Buffer;
  now?: () => Date;
  random?: () => number;
  /** Per request; the contract's 10 seconds by default. */
  timeoutMs?: number;
  /** Events per claim. */
  batchSize?: number;
  /** No new claim starts after this (epoch ms). */
  deadline?: number;
  /** Upper bound on claim rounds per run. */
  maxRounds?: number;
};

export type DeliverySummary = {
  claimed: number;
  delivered: number;
  retrying: number;
  dead: number;
  /**
   * Outcomes the database did not take: the claim token no longer matched,
   * or the report itself failed. Either way the lease decides what happens.
   */
  stale: number;
};

export const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_ERROR = 500;

export type AttemptResult = { delivered: boolean; error: string | null };

function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "timeout: no response within the delivery timeout";
    }
    return `network error: ${error.message}`;
  }
  return "network error";
}

/**
 * One attempt: decrypt the secrets, build the body, sign with a fresh
 * timestamp, post. Delivered = any 2xx; anything else, a timeout or a
 * network error is a failed attempt. Redirects are not followed: a 3xx is a
 * failure, and the signed body never goes anywhere but the registered URL.
 */
export async function attemptDelivery(
  event: ClaimedEvent,
  deps: Pick<DeliveryDeps, "fetch" | "encryptionKey" | "now" | "timeoutMs">,
): Promise<AttemptResult> {
  let secrets: string[];
  try {
    secrets = [event.secret_ciphertext, event.next_secret_ciphertext]
      .filter((value): value is string => value !== null)
      .map((ciphertext) => decryptWebhookSecret(ciphertext, event.client_id, deps.encryptionKey));
  } catch {
    // A configuration fault, not the receiver's: logged here, and the event
    // fails its attempt rather than going out unsigned.
    console.error(
      `webhooks: cannot decrypt the signing secret of webhook ${event.webhook_id}; ` +
        "check INTEGRATION_WEBHOOK_ENCRYPTION_KEY",
    );
    return { delivered: false, error: "signing secret could not be decrypted" };
  }

  const body = eventBody(event);
  const timestamp = webhookTimestamp((deps.now ?? (() => new Date()))());

  try {
    const response = await deps.fetch(event.target_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "qdit-webhooks/1",
        "X-Qdit-Timestamp": timestamp,
        "X-Qdit-Signature": signatureHeader(secrets, timestamp, body),
      },
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(deps.timeoutMs ?? DELIVERY_TIMEOUT_MS),
    });
    // The body is not read: nothing in it changes the outcome.
    await response.body?.cancel().catch(() => {});

    if (response.status >= 200 && response.status < 300) {
      return { delivered: true, error: null };
    }
    return { delivered: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { delivered: false, error: describeFailure(error).slice(0, MAX_ERROR) };
  }
}

/** Claims, sends and records until nothing is due, the deadline, or maxRounds. */
export async function deliverDueEvents(deps: DeliveryDeps): Promise<DeliverySummary> {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const batchSize = deps.batchSize ?? 20;
  const maxRounds = deps.maxRounds ?? 10;

  const summary: DeliverySummary = { claimed: 0, delivered: 0, retrying: 0, dead: 0, stale: 0 };

  for (let round = 0; round < maxRounds; round++) {
    if (deps.deadline !== undefined && now().getTime() >= deps.deadline) break;

    const events = await deps.outbox.claim(batchSize);
    if (events.length === 0) break;
    summary.claimed += events.length;

    // In parallel: the claim gives at most one event per milestone, so this
    // never sends two events of one milestone at once.
    const outcomes = await Promise.all(
      events.map(async (event) => {
        const result = await attemptDelivery(event, { ...deps, now });
        try {
          return await deps.outbox.record({
            id: event.id,
            claimToken: event.claim_token,
            delivered: result.delivered,
            error: result.error,
            nextAttemptAt: result.delivered ? null : nextAttemptAt(event.attempts, now(), random),
          });
        } catch (error) {
          // The lease runs out and the event is claimed again, its attempt
          // spent; a delivered one is then sent twice under the same id,
          // which the receiver dedupes.
          console.error(`webhooks: could not record the outcome of event ${event.id}`, error);
          return "stale" as const;
        }
      }),
    );

    for (const outcome of outcomes) {
      if (outcome === "delivered") summary.delivered++;
      else if (outcome === "retry") summary.retrying++;
      else if (outcome === "dead") summary.dead++;
      else summary.stale++;
    }
  }

  return summary;
}
