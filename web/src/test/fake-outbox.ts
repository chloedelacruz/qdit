import type { ClaimedEvent, DeliveryOutcome, DeliveryReport, Outbox } from "@/lib/webhooks/deliver";

/**
 * An in-memory stand-in for the two delivery functions of
 * supabase/migrations/20261024130000_integration_webhooks.sql, with the same
 * rules: only the head of each (webhook, milestone) queue is claimable
 * (D-25), a claim counts the attempt and leases the row, a report lands only
 * with the claim's token, and the 8th failure is dead. The SQL itself is
 * covered by supabase/tests/integration_webhooks.test.sql; this lets the
 * delivery loop be tested against the same behaviour without a database.
 */

export type FakeEvent = {
  id: string;
  webhook_id: string;
  milestone_id: string;
  project_id: string;
  status: ClaimedEvent["status"];
  occurred_at: string;
  seq: number;
  attempts: number;
  next_attempt_at: number;
  claim_token: string | null;
  delivered_at: number | null;
  dead_at: number | null;
  last_error: string | null;
};

export type FakeWebhook = {
  id: string;
  client_id: string;
  target_url: string;
  secret_ciphertext: string;
  next_secret_ciphertext: string | null;
  active: boolean;
};

const LEASE_MS = 120_000;
const MAX_ATTEMPTS = 8;

export function fakeOutbox(now: () => Date, webhooks: FakeWebhook[]) {
  const events: FakeEvent[] = [];
  const reports: DeliveryReport[] = [];
  let seq = 0;
  let tokens = 0;

  const pending = (e: FakeEvent) => e.delivered_at === null && e.dead_at === null;

  function add(
    event: Pick<FakeEvent, "id" | "milestone_id" | "status"> &
      Partial<Pick<FakeEvent, "webhook_id" | "project_id" | "occurred_at">>,
  ): FakeEvent {
    const row: FakeEvent = {
      webhook_id: webhooks[0].id,
      project_id: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34",
      occurred_at: now().toISOString(),
      ...event,
      seq: ++seq,
      attempts: 0,
      next_attempt_at: now().getTime(),
      claim_token: null,
      delivered_at: null,
      dead_at: null,
      last_error: null,
    };
    events.push(row);
    return row;
  }

  const outbox: Outbox = {
    async claim(limit: number): Promise<ClaimedEvent[]> {
      const t = now().getTime();
      for (const e of events) {
        if (pending(e) && e.attempts >= MAX_ATTEMPTS && e.next_attempt_at <= t) {
          e.dead_at = t;
          e.claim_token = null;
        }
      }

      const heads = new Map<string, FakeEvent>();
      for (const e of events.filter(pending)) {
        const key = `${e.webhook_id}/${e.milestone_id}`;
        const head = heads.get(key);
        const earlier =
          !head ||
          Date.parse(e.occurred_at) < Date.parse(head.occurred_at) ||
          (Date.parse(e.occurred_at) === Date.parse(head.occurred_at) && e.seq < head.seq);
        if (earlier) heads.set(key, e);
      }

      const due = [...heads.values()]
        .filter((e) => e.next_attempt_at <= t && e.attempts < MAX_ATTEMPTS)
        .filter((e) => webhooks.find((w) => w.id === e.webhook_id)?.active)
        .sort((a, b) => a.next_attempt_at - b.next_attempt_at || a.seq - b.seq)
        .slice(0, limit);

      const token = `token-${++tokens}`;
      return due
        .map((e) => {
          e.attempts += 1;
          e.next_attempt_at = t + LEASE_MS;
          e.claim_token = token;
          return e;
        })
        .sort((a, b) => a.seq - b.seq)
        .map((e) => {
          const w = webhooks.find((hook) => hook.id === e.webhook_id)!;
          return {
            id: e.id,
            webhook_id: e.webhook_id,
            milestone_id: e.milestone_id,
            project_id: e.project_id,
            event: "milestone.status_changed" as const,
            status: e.status,
            occurred_at: e.occurred_at,
            attempts: e.attempts,
            claim_token: token,
            client_id: w.client_id,
            target_url: w.target_url,
            secret_ciphertext: w.secret_ciphertext,
            next_secret_ciphertext: w.next_secret_ciphertext,
          };
        });
    },

    async record(report: DeliveryReport): Promise<DeliveryOutcome> {
      reports.push(report);
      const e = events.find(
        (row) => row.id === report.id && row.claim_token === report.claimToken && pending(row),
      );
      if (!e) return "stale";

      const t = now().getTime();
      e.claim_token = null;
      if (report.delivered) {
        e.delivered_at = t;
        return "delivered";
      }
      e.last_error = report.error;
      if (e.attempts >= MAX_ATTEMPTS || report.nextAttemptAt === null) {
        e.dead_at = t;
        return "dead";
      }
      e.next_attempt_at = report.nextAttemptAt.getTime();
      return "retry";
    },
  };

  return { outbox, events, reports, add };
}
