import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `revokeAuthorizedApp` marks the caller's doc link connections through that
 * app lost once Supabase Auth has revoked the grant, so the doc cards they
 * kept connected say "Connection to doqtri lost" (WP-2.6). Before the revoke
 * succeeds nothing is marked; a failed mark does not fail the disconnect.
 */
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: async () => ({ id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { revokeAuthorizedApp } = await import("./actions");

const CLIENT = "9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";

function client(revokeError: unknown, markError: unknown = null) {
  const db = fakeDatabase({
    rpc: { mark_doc_link_connections_revoked: [{ data: 1, error: markError }] },
  });
  const revokeGrant = vi.fn(async () => ({ data: {}, error: revokeError }));
  createClient.mockResolvedValue({ ...db.client, auth: { oauth: { revokeGrant } } });
  return { db, revokeGrant };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("revokeAuthorizedApp", () => {
  it("revokes the grant, then marks the caller's connections through that client lost", async () => {
    const { db, revokeGrant } = client(null);

    await expect(revokeAuthorizedApp(CLIENT.toUpperCase())).resolves.toEqual({ ok: true });

    expect(revokeGrant).toHaveBeenCalledWith({ clientId: CLIENT });
    expect(db.requests).toEqual([
      expect.objectContaining({
        kind: "rpc",
        name: "mark_doc_link_connections_revoked",
        args: { p_client_id: CLIENT },
      }),
    ]);
  });

  it("marks nothing when Auth refuses the revoke", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = client({ message: "nope" });

    await expect(revokeAuthorizedApp(CLIENT)).resolves.toEqual({
      error: "Could not disconnect that app. Try again.",
    });
    expect(db.requests).toEqual([]);
  });

  it("still reports the disconnect when marking fails, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    client(null, { message: "rpc down" });

    await expect(revokeAuthorizedApp(CLIENT)).resolves.toEqual({ ok: true });
    expect(logged).toHaveBeenCalledWith(
      "mark_doc_link_connections_revoked failed",
      { message: "rpc down" },
    );
  });

  it("refuses an id that is not a client id, before any request", async () => {
    const { db, revokeGrant } = client(null);

    await expect(revokeAuthorizedApp("../admin")).resolves.toEqual({
      error: "That is not a connected app.",
    });
    expect(revokeGrant).not.toHaveBeenCalled();
    expect(db.requests).toEqual([]);
  });
});
