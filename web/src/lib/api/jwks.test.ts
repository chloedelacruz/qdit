import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JWKS_FAILURE_BACKOFF_MS,
  JWKS_REFETCH_INTERVAL_MS,
  JWKS_TTL_MS,
  resetJwksCache,
  signingKey,
} from "./jwks";
import { ApiError } from "./errors";

const JWKS_URL = "https://ref.supabase.co/auth/v1/.well-known/jwks.json";
const EC = { kty: "EC", kid: "key-1", crv: "P-256", x: "x", y: "y", use: "sig" };
const RSA = { kty: "RSA", kid: "key-2", n: "n", e: "AQAB" };

const fetchMock = vi.fn();
let now = 1_000_000;

function answer(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  resetJwksCache();
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchMock);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ref.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("signingKey", () => {
  it("fetches the JWKS with the publishable key and finds the key by kid", async () => {
    fetchMock.mockReturnValueOnce(answer({ keys: [EC, RSA] }));

    await expect(signingKey(JWKS_URL, "key-2")).resolves.toEqual(RSA);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(JWKS_URL);
    expect(init.headers).toEqual({ apikey: "sb_publishable_test" });
    expect(init.cache).toBe("no-store");
  });

  it("serves a known key from the cache within the TTL", async () => {
    fetchMock.mockReturnValueOnce(answer({ keys: [EC] }));
    await signingKey(JWKS_URL, "key-1");

    now += JWKS_TTL_MS - 1;
    await expect(signingKey(JWKS_URL, "key-1")).resolves.toEqual(EC);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an unknown kid refetches at most once per refetch interval (the negative cache)", async () => {
    fetchMock.mockReturnValue(answer({ keys: [EC] }));
    await signingKey(JWKS_URL, "key-1");

    // A stream of random kids costs no network call inside the interval.
    for (const kid of ["a", "b", "c"]) {
      await expect(signingKey(JWKS_URL, kid)).resolves.toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += JWKS_REFETCH_INTERVAL_MS;
    await expect(signingKey(JWKS_URL, "d")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a rotated-in key is found after the refetch interval", async () => {
    fetchMock.mockReturnValueOnce(answer({ keys: [EC] }));
    await signingKey(JWKS_URL, "key-1");

    fetchMock.mockReturnValueOnce(answer({ keys: [EC, RSA] }));
    now += JWKS_REFETCH_INTERVAL_MS;
    await expect(signingKey(JWKS_URL, "key-2")).resolves.toEqual(RSA);
  });

  it("concurrent misses share one fetch", async () => {
    let release!: () => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ keys: [EC] })));
      }),
    );

    const both = Promise.all([signingKey(JWKS_URL, "key-1"), signingKey(JWKS_URL, "key-1")]);
    release();
    await expect(both).resolves.toEqual([EC, EC]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("with nothing cached, a failed fetch is 503 unavailable, never a 401", async () => {
    fetchMock.mockReturnValueOnce(answer({}, 500));

    const error = await signingKey(JWKS_URL, "key-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
    expect((error as ApiError).headers["Retry-After"]).toBe("5");
  });

  it("a network error with nothing cached is also unavailable, and backs off before retrying", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(signingKey(JWKS_URL, "key-1")).rejects.toMatchObject({ code: "unavailable" });

    // Within the backoff: no second fetch, still unavailable.
    now += JWKS_FAILURE_BACKOFF_MS - 1;
    await expect(signingKey(JWKS_URL, "key-1")).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 1;
    fetchMock.mockReturnValueOnce(answer({ keys: [EC] }));
    await expect(signingKey(JWKS_URL, "key-1")).resolves.toEqual(EC);
  });

  it("a failed refresh keeps serving the cached keys", async () => {
    fetchMock.mockReturnValueOnce(answer({ keys: [EC] }));
    await signingKey(JWKS_URL, "key-1");

    now += JWKS_TTL_MS; // stale
    fetchMock.mockReturnValueOnce(answer({}, 502));
    await expect(signingKey(JWKS_URL, "key-1")).resolves.toEqual(EC);
  });

  it("keeps only asymmetric signing keys with a kid", async () => {
    fetchMock.mockReturnValueOnce(
      answer({
        keys: [
          { kty: "oct", kid: "hs", k: "secret" },
          { kty: "EC", kid: "enc", use: "enc" },
          { kty: "EC", kid: "" },
          { kty: "RSA" },
          "junk",
          null,
          EC,
        ],
      }),
    );

    await expect(signingKey(JWKS_URL, "key-1")).resolves.toEqual(EC);
    for (const kid of ["hs", "enc"]) {
      await expect(signingKey(JWKS_URL, kid)).resolves.toBeNull();
    }
  });

  it("an HS256-only project (no keys published) finds no key rather than erroring", async () => {
    fetchMock.mockReturnValueOnce(answer({ keys: [] }));
    await expect(signingKey(JWKS_URL, "key-1")).resolves.toBeNull();
  });
});
