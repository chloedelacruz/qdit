import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * lib/doqtri-origin-health.ts: comparing DOQTRI_ORIGIN with the database's
 * integration_settings.doqtri_origin (D-95). The SQL is covered by
 * supabase/tests/doqtri_origin_doc_links.test.sql; here supabase-js is a fake
 * that answers the one RPC.
 */
const rpc = vi.fn();
const createClient = vi.fn<(url: string, key: string, options: unknown) => { rpc: typeof rpc }>(() => ({ rpc }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { compareDoqtriOrigins, doqtriOriginWarning, readDoqtriOriginHealth } = await import("./doqtri-origin-health");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("compareDoqtriOrigins", () => {
  it("matches the same origin, the env's trailing slash and case aside, as the API applies it", () => {
    expect(compareDoqtriOrigins("https://www.doqtri.xyz", "https://WWW.doqtri.xyz/")).toEqual({
      status: "match",
      database: "https://www.doqtri.xyz",
      env: "https://www.doqtri.xyz",
    });
    // DOQTRI_ORIGIN unset is the default origin, which the API uses then.
    expect(compareDoqtriOrigins("https://www.doqtri.xyz", undefined).status).toBe("match");
  });

  it("differs on another host, the apex against www included", () => {
    expect(compareDoqtriOrigins("https://doqtri.xyz", "https://www.doqtri.xyz")).toEqual({
      status: "differs",
      database: "https://doqtri.xyz",
      env: "https://www.doqtri.xyz",
    });
    expect(compareDoqtriOrigins("https://preview.doqtri.example", undefined).status).toBe("differs");
  });

  it("is unset while the column is null", () => {
    expect(compareDoqtriOrigins(null, "https://www.doqtri.xyz")).toEqual({
      status: "unset",
      database: null,
      env: "https://www.doqtri.xyz",
    });
  });

  it("is unknown for a misconfigured DOQTRI_ORIGIN or an unexpected answer", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(compareDoqtriOrigins("https://www.doqtri.xyz", "http://www.doqtri.xyz")).toEqual({
      status: "unknown",
      database: "https://www.doqtri.xyz",
      env: null,
    });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(compareDoqtriOrigins(42, "https://www.doqtri.xyz").status).toBe("unknown");
  });
});

describe("doqtriOriginWarning", () => {
  it("is silent only on a match, and names both values otherwise", () => {
    const env = "https://www.doqtri.xyz";
    expect(doqtriOriginWarning({ status: "match", database: env, env })).toBeNull();
    expect(doqtriOriginWarning({ status: "differs", database: "https://doqtri.xyz", env })).toMatch(
      /DOQTRI_ORIGIN is https:\/\/www\.doqtri\.xyz but integration_settings\.doqtri_origin is https:\/\/doqtri\.xyz/,
    );
    expect(doqtriOriginWarning({ status: "unset", database: null, env })).toMatch(
      /doqtri_origin is not set, so link_project_doc\(\) does not check doc_url/,
    );
    expect(doqtriOriginWarning({ status: "unknown", database: null, env: null })).toMatch(/could not compare/);
  });
});

describe("readDoqtriOriginHealth", () => {
  it("calls doqtri_origin_setting with the secret key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    rpc.mockResolvedValueOnce({ data: "https://doqtri.xyz", error: null });

    await expect(readDoqtriOriginHealth("sb_secret_test", "https://www.doqtri.xyz")).resolves.toEqual({
      status: "differs",
      database: "https://doqtri.xyz",
      env: "https://www.doqtri.xyz",
    });
    expect(createClient.mock.calls[0][1]).toBe("sb_secret_test");
    expect(rpc).toHaveBeenCalledWith("doqtri_origin_setting");
  });

  it("answers unknown, and does not throw, when the check fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied for function" } });
    await expect(readDoqtriOriginHealth("k")).resolves.toMatchObject({ status: "unknown" });

    rpc.mockRejectedValueOnce(new Error("network down"));
    await expect(readDoqtriOriginHealth("k")).resolves.toMatchObject({ status: "unknown" });
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
