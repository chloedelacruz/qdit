import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `createClient` is the only seam: each test decides what the two RPCs answer. */
const rpc = vi.fn();
const createClient = vi.fn<(...args: unknown[]) => { rpc: typeof rpc }>(() => ({ rpc }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

const { LEASE_SECONDS, supabaseOutbox } = await import("./outbox");

const URL_ = "https://ref.supabase.co";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("supabaseOutbox", () => {
  it("uses the secret key with no session", () => {
    supabaseOutbox("sb_secret_x");
    expect(createClient).toHaveBeenCalledWith(URL_, "sb_secret_x", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it("claims through claim_integration_events with the lease", async () => {
    const events = [{ id: "e1" }];
    rpc.mockResolvedValueOnce({ data: events, error: null });

    await expect(supabaseOutbox("k").claim(7)).resolves.toBe(events);
    expect(rpc).toHaveBeenCalledWith("claim_integration_events", {
      p_limit: 7,
      p_lease_seconds: LEASE_SECONDS,
    });
  });

  it("leases for longer than one delivery round can take", () => {
    // A round is a 10 s timeout, run in parallel; the lease must outlast it.
    expect(LEASE_SECONDS).toBeGreaterThan(10);
  });

  it("a claim with no rows is an empty list", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(supabaseOutbox("k").claim(1)).resolves.toEqual([]);
  });

  it("a failed claim throws rather than delivering nothing silently", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(supabaseOutbox("k").claim(1)).rejects.toThrow(
      "webhooks: claim failed: permission denied",
    );
  });

  it("records a failed delivery with its claim token and next attempt", async () => {
    rpc.mockResolvedValueOnce({ data: "retry", error: null });
    const next = new Date("2026-11-04T01:02:03.000Z");

    const outcome = await supabaseOutbox("k").record({
      id: "e1",
      claimToken: "tok",
      delivered: false,
      error: "HTTP 500",
      nextAttemptAt: next,
    });

    expect(outcome).toBe("retry");
    expect(rpc).toHaveBeenCalledWith("record_integration_delivery", {
      p_id: "e1",
      p_claim_token: "tok",
      p_delivered: false,
      p_error: "HTTP 500",
      p_next_attempt_at: "2026-11-04T01:02:03.000Z",
    });
  });

  it("a delivered event sends no next attempt", async () => {
    rpc.mockResolvedValueOnce({ data: "delivered", error: null });
    await supabaseOutbox("k").record({
      id: "e1",
      claimToken: "tok",
      delivered: true,
      error: null,
      nextAttemptAt: null,
    });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_delivered: true, p_next_attempt_at: null });
  });

  it("a failed record throws", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(
      supabaseOutbox("k").record({
        id: "e1",
        claimToken: "tok",
        delivered: true,
        error: null,
        nextAttemptAt: null,
      }),
    ).rejects.toThrow("webhooks: record failed: boom");
  });
});
