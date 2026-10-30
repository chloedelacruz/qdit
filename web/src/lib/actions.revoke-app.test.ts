import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `revokeAuthorizedApp` first records the revoke, so /api/v1 refuses the
 * app's tokens at once (D-59); then revokes the grant in Supabase Auth; then
 * marks the caller's doc link connections through that app lost, so the doc
 * cards they kept connected say "Connection to doqtri lost" (WP-2.6). A failed
 * record stops everything; a failed revoke marks nothing; a failed mark does
 * not fail the disconnect.
 */
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: async () => ({ id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { revokeAuthorizedApp } = await import("./actions");

const CLIENT = "9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";

function client(
  revokeError: unknown,
  { markError = null, recordError = null }: { markError?: unknown; recordError?: unknown } = {},
) {
  const db = fakeDatabase({
    rpc: {
      record_oauth_client_revocation: [{ data: "2026-10-25T09:00:00Z", error: recordError }],
      mark_doc_link_connections_revoked: [{ data: 1, error: markError }],
    },
  });
  // Every call in the order it was made, Auth's included.
  const order: string[] = [];
  const revokeGrant = vi.fn(async () => {
    order.push("revokeGrant");
    return { data: {}, error: revokeError };
  });
  const rpc = (fn: string, args?: unknown) => {
    order.push(fn);
    return db.client.rpc(fn, args);
  };
  createClient.mockResolvedValue({ ...db.client, rpc, auth: { oauth: { revokeGrant } } });
  return { db, revokeGrant, order };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("revokeAuthorizedApp", () => {
  it("records the revoke, revokes the grant, then marks the caller's connections lost", async () => {
    const { db, revokeGrant, order } = client(null);

    await expect(revokeAuthorizedApp(CLIENT.toUpperCase())).resolves.toEqual({ ok: true });

    expect(revokeGrant).toHaveBeenCalledWith({ clientId: CLIENT });
    expect(order).toEqual([
      "record_oauth_client_revocation",
      "revokeGrant",
      "mark_doc_link_connections_revoked",
    ]);
    expect(db.requests).toEqual([
      expect.objectContaining({
        kind: "rpc",
        name: "record_oauth_client_revocation",
        args: { p_client_id: CLIENT },
      }),
      expect.objectContaining({
        kind: "rpc",
        name: "mark_doc_link_connections_revoked",
        args: { p_client_id: CLIENT },
      }),
    ]);
  });

  it("revokes nothing when the revoke cannot be recorded", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, revokeGrant } = client(null, { recordError: { message: "db down" } });

    await expect(revokeAuthorizedApp(CLIENT)).resolves.toEqual({
      error: "Could not disconnect that app. Try again.",
    });
    expect(revokeGrant).not.toHaveBeenCalled();
    expect(db.requests.map((r) => r.name)).toEqual(["record_oauth_client_revocation"]);
    expect(logged).toHaveBeenCalledWith("record_oauth_client_revocation failed", { message: "db down" });
  });

  it("marks nothing when Auth refuses the revoke", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = client({ message: "nope" });

    await expect(revokeAuthorizedApp(CLIENT)).resolves.toEqual({
      error: "Could not disconnect that app. Try again.",
    });
    expect(db.requests.map((r) => r.name)).toEqual(["record_oauth_client_revocation"]);
  });

  it("still reports the disconnect when marking fails, and logs it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    client(null, { markError: { message: "rpc down" } });

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
