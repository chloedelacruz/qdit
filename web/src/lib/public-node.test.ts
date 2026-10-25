import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/public-node.ts: the public page's server reading a linked heading's
 * node id with public_milestone_node_id(), service_role only (D-77). The SQL
 * is covered by supabase/tests/public_milestone_doc_source.test.sql; here
 * supabase-js is a fake that answers the one RPC.
 */
const rpc = vi.fn();
const createClient = vi.fn<(url: string, key: string, options: unknown) => { rpc: typeof rpc }>(() => ({ rpc }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { readPublicNodeId } = await import("./public-node");

const MILESTONE = "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("readPublicNodeId", () => {
  it("asks public_milestone_node_id with the secret key, and never a session", async () => {
    rpc.mockResolvedValue({ data: "h4", error: null });

    await expect(readPublicNodeId("soroban-payroll", MILESTONE)).resolves.toEqual({ ok: true, nodeId: "h4" });
    expect(rpc).toHaveBeenCalledWith("public_milestone_node_id", { p_slug: "soroban-payroll", p_milestone_id: MILESTONE });
    expect(createClient).toHaveBeenCalledWith("https://ref.supabase.co", "sb_secret_test", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it("is ok with no node id when the milestone is not linked or not published", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(readPublicNodeId("soroban-payroll", MILESTONE)).resolves.toEqual({ ok: true, nodeId: null });
  });

  it("fails, logged, without the secret key, and asks nothing", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    await expect(readPublicNodeId("soroban-payroll", MILESTONE)).resolves.toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("fails, never throws, when the call errors or rejects", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    await expect(readPublicNodeId("soroban-payroll", MILESTONE)).resolves.toEqual({ ok: false });

    rpc.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(readPublicNodeId("soroban-payroll", MILESTONE)).resolves.toEqual({ ok: false });
  });
});
