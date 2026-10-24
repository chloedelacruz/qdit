import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeOutbox, type FakeWebhook } from "@/test/fake-outbox";

import { MAX_ATTEMPTS, RETRY_DELAYS_MS } from "./backoff";
import { attemptDelivery, deliverDueEvents, type DeliveryDeps } from "./deliver";
import { encryptWebhookSecret } from "./secret-box";
import { webhookSignature } from "./signing";

const KEY = randomBytes(32);
const CLIENT = "9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";
const SECRET = "whsec_current";
const NEXT_SECRET = "whsec_next";
const URL = "https://www.doqtri.xyz/api/integrations/qdit/webhook";

const M1 = "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61";
const M2 = "c92f5018-7b3d-4ea4-9f60-1d8b0c4e3f72";
const E = (n: number) => `7d0f8a52-3c1e-4b6a-9f21-5e8c0d4b2a${n.toString().padStart(2, "0")}`;

function webhook(overrides: Partial<FakeWebhook> = {}): FakeWebhook {
  return {
    id: "e2000000-0000-4000-8000-000000000001",
    client_id: CLIENT,
    target_url: URL,
    secret_ciphertext: encryptWebhookSecret(SECRET, CLIENT, KEY),
    next_secret_ciphertext: null,
    active: true,
    ...overrides,
  };
}

/** A clock the test moves, and a receiver that answers what it is told. */
function setup(hooks: FakeWebhook[] = [webhook()]) {
  let time = Date.parse("2026-10-24T12:00:00.000Z");
  const now = () => new Date(time);
  const advance = (ms: number) => {
    time += ms;
  };

  const store = fakeOutbox(now, hooks);
  const sent: { id: string; milestone: string; headers: Headers; body: string }[] = [];
  const inFlight = new Set<string>();
  let concurrentSameMilestone = false;
  let answer: (body: { id: string }) => Promise<Response> = async () => new Response(null, { status: 200 });

  const fetchFake = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body);
    const parsed = JSON.parse(body) as { id: string; milestone_id: string };
    if (inFlight.has(parsed.milestone_id)) concurrentSameMilestone = true;
    inFlight.add(parsed.milestone_id);
    sent.push({ id: parsed.id, milestone: parsed.milestone_id, headers: new Headers(init?.headers), body });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return await answer(parsed);
    } finally {
      inFlight.delete(parsed.milestone_id);
    }
  });

  const deps = (): DeliveryDeps => ({
    outbox: store.outbox,
    fetch: fetchFake as unknown as typeof fetch,
    encryptionKey: KEY,
    now,
    random: () => 0.5,
  });

  return {
    ...store,
    now,
    advance,
    sent,
    fetchFake,
    deps,
    respond(fn: (body: { id: string }) => Promise<Response> | Response) {
      answer = async (b) => fn(b);
    },
    get concurrentSameMilestone() {
      return concurrentSameMilestone;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("one delivery", () => {
  it("posts the body signed per the contract, and records it delivered", async () => {
    const t = setup();
    t.add({ id: E(1), milestone_id: M1, status: "approved", occurred_at: "2026-10-24T11:59:58.412+00:00" });

    const summary = await deliverDueEvents(t.deps());

    expect(summary).toEqual({ claimed: 1, delivered: 1, retrying: 0, dead: 0, stale: 0 });
    const [call] = t.fetchFake.mock.calls;
    expect(call[0]).toBe(URL);
    expect(call[1]).toMatchObject({ method: "POST", redirect: "manual" });

    const [{ headers, body }] = t.sent;
    expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(headers.get("x-qdit-timestamp")).toBe("1792843200");
    expect(headers.get("x-qdit-signature")).toBe(`sha256=${webhookSignature(SECRET, "1792843200", body)}`);
    expect(JSON.parse(body)).toEqual({
      id: E(1),
      event: "milestone.status_changed",
      project_id: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34",
      milestone_id: M1,
      status: "approved",
      occurred_at: "2026-10-24T11:59:58.412Z",
    });
    expect(t.events[0].delivered_at).not.toBeNull();
  });

  it("signs with both secrets while one is being rotated in", async () => {
    const t = setup([webhook({ next_secret_ciphertext: encryptWebhookSecret(NEXT_SECRET, CLIENT, KEY) })]);
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });

    await deliverDueEvents(t.deps());

    const [{ headers, body }] = t.sent;
    const ts = headers.get("x-qdit-timestamp")!;
    expect(headers.get("x-qdit-signature")).toBe(
      `sha256=${webhookSignature(SECRET, ts, body)},sha256=${webhookSignature(NEXT_SECRET, ts, body)}`,
    );
  });

  it.each([
    ["a 500", () => new Response("down", { status: 500 }), "HTTP 500"],
    ["a 3xx (redirects are not followed)", () => new Response(null, { status: 302 }), "HTTP 302"],
    ["a 401", () => new Response(null, { status: 401 }), "HTTP 401"],
  ])("treats %s as a failed attempt", async (_label, response, error) => {
    const t = setup();
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });
    t.respond(response);

    const summary = await deliverDueEvents(t.deps());

    expect(summary).toMatchObject({ delivered: 0, retrying: 1 });
    expect(t.events[0].last_error).toBe(error);
  });

  it("treats a timeout and a network error as failed attempts", async () => {
    const event = {
      id: E(1),
      webhook_id: "w",
      milestone_id: M1,
      project_id: "p",
      event: "milestone.status_changed" as const,
      status: "submitted" as const,
      occurred_at: "2026-10-24T12:00:00Z",
      attempts: 1,
      claim_token: "t",
      client_id: CLIENT,
      target_url: URL,
      secret_ciphertext: encryptWebhookSecret(SECRET, CLIENT, KEY),
      next_secret_ciphertext: null,
    };
    const timeout = Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });

    await expect(
      attemptDelivery(event, { fetch: vi.fn().mockRejectedValue(timeout), encryptionKey: KEY }),
    ).resolves.toEqual({ delivered: false, error: "timeout: no response within the delivery timeout" });
    await expect(
      attemptDelivery(event, { fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")), encryptionKey: KEY }),
    ).resolves.toEqual({ delivered: false, error: "network error: fetch failed" });
  });

  it("passes a 10 second timeout signal to fetch", async () => {
    const t = setup();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });

    await deliverDueEvents(t.deps());

    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(t.fetchFake.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("never sends unsigned: a secret that does not decrypt fails the attempt without a request", async () => {
    const t = setup([webhook({ secret_ciphertext: encryptWebhookSecret(SECRET, "other-client", KEY) })]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });

    const summary = await deliverDueEvents(t.deps());

    expect(t.fetchFake).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ retrying: 1 });
    expect(t.events[0].last_error).toBe("signing secret could not be decrypted");
  });
});

describe("backoff", () => {
  it("schedules each retry by the contract's delays, from the moment it failed", async () => {
    const t = setup();
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });
    t.respond(() => new Response(null, { status: 503 }));

    const start = t.now().getTime();
    await deliverDueEvents(t.deps());

    expect(t.reports[0].nextAttemptAt?.getTime()).toBe(start + RETRY_DELAYS_MS[0]);
    expect(t.events[0].next_attempt_at).toBe(start + RETRY_DELAYS_MS[0]);
  });

  it("does not retry before the next attempt is due", async () => {
    const t = setup();
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });
    t.respond(() => new Response(null, { status: 503 }));
    await deliverDueEvents(t.deps());

    t.advance(RETRY_DELAYS_MS[0] - 1_000);
    expect((await deliverDueEvents(t.deps())).claimed).toBe(0);

    t.advance(1_000);
    expect((await deliverDueEvents(t.deps())).claimed).toBe(1);
    expect(t.events[0].attempts).toBe(2);
  });

  it("resends the same id and body bytes, with a fresh timestamp and signature", async () => {
    const t = setup();
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });
    t.respond(() => new Response(null, { status: 503 }));
    await deliverDueEvents(t.deps());
    t.advance(RETRY_DELAYS_MS[0]);
    await deliverDueEvents(t.deps());

    const [first, second] = t.sent;
    expect(second.id).toBe(first.id);
    expect(second.body).toBe(first.body);
    expect(second.headers.get("x-qdit-timestamp")).not.toBe(first.headers.get("x-qdit-timestamp"));
    expect(second.headers.get("x-qdit-signature")).not.toBe(first.headers.get("x-qdit-signature"));
  });
});

describe("per-milestone order (D-25)", () => {
  it("sends a milestone's events one at a time, in order, and other milestones alongside", async () => {
    const t = setup();
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });
    t.add({ id: E(2), milestone_id: M2, status: "submitted" });
    t.add({ id: E(3), milestone_id: M1, status: "approved" });
    t.add({ id: E(4), milestone_id: M1, status: "rejected" });

    const summary = await deliverDueEvents(t.deps());

    expect(summary).toEqual({ claimed: 4, delivered: 4, retrying: 0, dead: 0, stale: 0 });
    expect(t.sent.filter((s) => s.milestone === M1).map((s) => s.id)).toEqual([E(1), E(3), E(4)]);
    expect(t.concurrentSameMilestone).toBe(false);
    // M2 went out in the first round, next to M1's first event.
    expect(t.sent.slice(0, 2).map((s) => s.id).sort()).toEqual([E(1), E(2)].sort());
  });

  it("orders by occurred_at before insertion order", async () => {
    const t = setup();
    t.add({ id: E(1), milestone_id: M1, status: "approved", occurred_at: "2026-10-24T11:59:59.000Z" });
    t.add({ id: E(2), milestone_id: M1, status: "submitted", occurred_at: "2026-10-24T11:59:58.000Z" });

    await deliverDueEvents(t.deps());

    expect(t.sent.map((s) => s.id)).toEqual([E(2), E(1)]);
  });

  it("holds a later event while the earlier one is retrying, without spending its attempts", async () => {
    const t = setup();
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });
    t.add({ id: E(2), milestone_id: M1, status: "approved" });
    t.respond(({ id }) => new Response(null, { status: id === E(1) ? 503 : 200 }));

    await deliverDueEvents(t.deps());
    expect(t.sent.map((s) => s.id)).toEqual([E(1)]);
    expect(t.events[1].attempts).toBe(0);

    t.respond(() => new Response(null, { status: 200 }));
    t.advance(RETRY_DELAYS_MS[0]);
    await deliverDueEvents(t.deps());

    expect(t.sent.map((s) => s.id)).toEqual([E(1), E(1), E(2)]);
    expect(t.events[1].attempts).toBe(1);
  });

  it("does not hold other milestones behind a failing one", async () => {
    const t = setup();
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });
    t.add({ id: E(2), milestone_id: M2, status: "submitted" });
    t.respond(({ id }) => new Response(null, { status: id === E(1) ? 503 : 200 }));

    const summary = await deliverDueEvents(t.deps());

    expect(summary).toMatchObject({ delivered: 1, retrying: 1 });
  });
});

describe("dead-lettering", () => {
  it("marks an event dead after its 8th failed attempt and then releases the next one", async () => {
    const t = setup();
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });
    t.add({ id: E(2), milestone_id: M1, status: "approved" });
    t.respond(({ id }) => new Response(null, { status: id === E(1) ? 500 : 200 }));

    const outcomes: string[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const summary = await deliverDueEvents({ ...t.deps(), maxRounds: 1 });
      outcomes.push(summary.dead ? "dead" : summary.retrying ? "retry" : "none");
      if (attempt < MAX_ATTEMPTS) t.advance(RETRY_DELAYS_MS[attempt - 1] * 1.1);
    }

    expect(outcomes).toEqual(["retry", "retry", "retry", "retry", "retry", "retry", "retry", "dead"]);
    expect(t.events[0]).toMatchObject({ attempts: 8, delivered_at: null, last_error: "HTTP 500" });
    expect(t.events[0].dead_at).not.toBeNull();
    expect(t.reports.at(-1)?.nextAttemptAt).toBeNull();

    // The dead event is never tried again; the next one goes at once.
    const summary = await deliverDueEvents(t.deps());
    expect(summary).toEqual({ claimed: 1, delivered: 1, retrying: 0, dead: 0, stale: 0 });
    expect(t.sent.filter((s) => s.id === E(1))).toHaveLength(8);
    expect(t.sent.at(-1)?.id).toBe(E(2));
  });
});

describe("the run", () => {
  it("stops at the deadline", async () => {
    const t = setup();
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });

    const summary = await deliverDueEvents({ ...t.deps(), deadline: t.now().getTime() });

    expect(summary.claimed).toBe(0);
    expect(t.fetchFake).not.toHaveBeenCalled();
  });

  it("claims in batches of the given size", async () => {
    const t = setup();
    const claim = vi.spyOn(t.outbox, "claim");
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });
    t.add({ id: E(2), milestone_id: M2, status: "submitted" });

    await deliverDueEvents({ ...t.deps(), batchSize: 1 });

    expect(claim.mock.calls.map(([limit]) => limit)).toEqual([1, 1, 1]);
  });

  it("keeps going when one outcome cannot be recorded, leaving it to the lease", async () => {
    const t = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const record = t.outbox.record.bind(t.outbox);
    vi.spyOn(t.outbox, "record").mockImplementation(async (report) => {
      if (report.id === E(1)) throw new Error("connection reset");
      return record(report);
    });
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });
    t.add({ id: E(2), milestone_id: M2, status: "submitted" });

    const summary = await deliverDueEvents(t.deps());

    expect(summary).toEqual({ claimed: 2, delivered: 1, retrying: 0, dead: 0, stale: 1 });
    expect(t.events[0].claim_token).not.toBeNull();
  });

  it("does nothing for an inactive webhook", async () => {
    const t = setup([webhook({ active: false })]);
    t.add({ id: E(1), milestone_id: M1, status: "submitted" });

    expect((await deliverDueEvents(t.deps())).claimed).toBe(0);
  });
});
