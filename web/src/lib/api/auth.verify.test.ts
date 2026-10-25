import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `authenticate()` against the real supabase-js `getClaims()` and the real
 * `./jwks` cache, with real ES256 signatures. Only `fetch` is faked: it serves
 * the JWKS and counts every outbound request, which is the point — a token the
 * caller made up must never buy one beyond the JWKS refetch allowance. It also
 * stands in for PostgREST's `oauth_token_revoked()` (D-59), answering from the
 * bearer token it is sent, the way the SQL reads the request JWT.
 */
const { authenticate } = await import("./auth");
const { JWKS_REFETCH_INTERVAL_MS, resetJwksCache } = await import("./jwks");

const URL_ = "https://ref.supabase.co";
const JWKS_URL = `${URL_}/auth/v1/.well-known/jwks.json`;
const KID = "qdit-test-key";
const USER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CLIENT = "9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";
const RPC_URL = `${URL_}/rest/v1/rpc/oauth_token_revoked`;
const ES256 = { name: "ECDSA", namedCurve: "P-256" } as const;

let privateKey: CryptoKey;
let publicJwk: JsonWebKey & { kid: string; alg: string };

const b64url = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");

async function sign(
  header: Record<string, unknown>,
  payload: Record<string, unknown> | string,
): Promise<string> {
  const head = b64url(JSON.stringify(header));
  const body = b64url(typeof payload === "string" ? payload : JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(`${head}.${body}`) as Uint8Array<ArrayBuffer>,
  );
  return `${head}.${body}.${b64url(new Uint8Array(signature))}`;
}

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: `${URL_}/auth/v1`,
    sub: USER,
    role: "authenticated",
    client_id: CLIENT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

const request = (token: string) =>
  new Request("https://qdit.test/api/v1/me", { headers: { authorization: `Bearer ${token}` } });

async function status(token: string): Promise<number> {
  try {
    await authenticate(request(token));
    return 200;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

/** When the fake database says this user revoked this client; null: never. */
let revokedAt: number | null = null;

/** oauth_token_revoked() over the token PostgREST was sent. */
function revokedFor(init: RequestInit | undefined): boolean {
  const bearer = new Headers(init?.headers).get("authorization") ?? "";
  const payload = JSON.parse(Buffer.from(bearer.split(".")[1] ?? "", "base64url").toString());
  if (revokedAt === null) return false;
  return typeof payload.iat !== "number" || payload.iat <= revokedAt;
}

const jwksFetch = vi.fn();
const rpcFetch = vi.fn();
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === JWKS_URL) return jwksFetch(url);
  if (url === RPC_URL) return rpcFetch(url, init);
  return new Response("unexpected", { status: 500 });
});

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(ES256, true, ["sign", "verify"]);
  privateKey = pair.privateKey;
  publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
    kid: KID,
    alg: "ES256",
    key_ops: ["verify"],
  };
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  resetJwksCache();
  revokedAt = null;
  jwksFetch.mockImplementation(async () => Response.json({ keys: [publicJwk] }));
  rpcFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
    Response.json(revokedFor(init)),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("authenticate with the real verifier", () => {
  it("checks every accepted token against revocations, once per request", async () => {
    const token = await sign({ alg: "ES256", kid: KID }, claims({ iat: Math.floor(Date.now() / 1000) }));

    expect(await status(token)).toBe(200);
    expect(await status(token)).toBe(200);
    expect(rpcFetch).toHaveBeenCalledTimes(2);
    expect(new Headers(rpcFetch.mock.calls[0][1]?.headers).get("authorization")).toBe(`Bearer ${token}`);
  });

  it("refuses a token issued before a revoke and accepts one from the re-consent (D-59)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const before = await sign({ alg: "ES256", kid: KID }, claims({ iat: now - 60 }));
    expect(await status(before)).toBe(200);

    revokedAt = now - 30;
    expect(await status(before)).toBe(401);

    const after = await sign({ alg: "ES256", kid: KID }, claims({ iat: now }));
    expect(await status(after)).toBe(200);
  });

  it("503s, not 200s, when the revocation lookup fails", async () => {
    rpcFetch.mockImplementation(async () =>
      Response.json({ code: "57014", message: "canceling statement due to statement timeout" }, { status: 500 }),
    );
    const token = await sign({ alg: "ES256", kid: KID }, claims({ iat: Math.floor(Date.now() / 1000) }));
    expect(await status(token)).toBe(503);

    rpcFetch.mockRejectedValue(new TypeError("fetch failed"));
    expect(await status(token)).toBe(503);
  });

  it("accepts a correctly signed OAuth token, fetching the JWKS once", async () => {
    const token = await sign({ alg: "ES256", kid: KID, typ: "JWT" }, claims());

    const auth = await authenticate(request(token));
    await authenticate(request(token));

    expect(auth.userId).toBe(USER);
    expect(auth.clientId).toBe(CLIENT);
    expect(jwksFetch).toHaveBeenCalledTimes(1);
    expect(jwksFetch.mock.calls[0][0]).toBe(JWKS_URL);
  });

  it("401s on a payload that is base64url but not JSON (getClaims throws)", async () => {
    const token = await sign({ alg: "ES256", kid: KID }, "not json!");
    expect(await status(token)).toBe(401);
  });

  it("401s on a bad signature", async () => {
    const good = await sign({ alg: "ES256", kid: KID }, claims());
    const forged = good.replace(/\.[^.]+\./, `.${b64url(JSON.stringify(claims({ sub: CLIENT })))}.`);
    expect(await status(forged)).toBe(401);
  });

  it("401s on HS256 and on a missing kid with no request at all", async () => {
    expect(await status(await sign({ alg: "HS256", kid: KID }, claims()))).toBe(401);
    expect(await status(await sign({ alg: "ES256" }, claims()))).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refetches the JWKS for unknown kids at most once per interval", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const good = await sign({ alg: "ES256", kid: KID }, claims());
    expect(await status(good)).toBe(200);
    expect(jwksFetch).toHaveBeenCalledTimes(1);

    // Within the interval: twenty random kids, no request.
    for (let i = 0; i < 20; i++) {
      expect(await status(await sign({ alg: "ES256", kid: `random-${i}` }, claims()))).toBe(401);
    }
    expect(jwksFetch).toHaveBeenCalledTimes(1);

    // After it: one refetch, then quiet again.
    vi.setSystemTime(Date.now() + JWKS_REFETCH_INTERVAL_MS + 1);
    for (let i = 0; i < 20; i++) {
      expect(await status(await sign({ alg: "ES256", kid: `later-${i}` }, claims()))).toBe(401);
    }
    expect(jwksFetch).toHaveBeenCalledTimes(2);

    // The known key still verifies throughout.
    expect(await status(good)).toBe(200);
    expect(jwksFetch).toHaveBeenCalledTimes(2);
  });

  it("shares one JWKS fetch between concurrent cold requests", async () => {
    const token = await sign({ alg: "ES256", kid: KID }, claims());

    const results = await Promise.all(Array.from({ length: 10 }, () => status(token)));

    expect(results).toEqual(Array(10).fill(200));
    expect(jwksFetch).toHaveBeenCalledTimes(1);
  });

  it("503s when the JWKS is unreachable and nothing is cached", async () => {
    jwksFetch.mockRejectedValue(new TypeError("fetch failed"));
    const token = await sign({ alg: "ES256", kid: KID }, claims());

    expect(await status(token)).toBe(503);
    // Within the failure backoff: still 503, no second request.
    expect(await status(token)).toBe(503);
    expect(jwksFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps verifying with cached keys when a refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const token = await sign({ alg: "ES256", kid: KID }, claims({ exp: Math.floor(Date.now() / 1000) + 7200 }));
    expect(await status(token)).toBe(200);

    jwksFetch.mockRejectedValue(new TypeError("fetch failed"));
    vi.setSystemTime(Date.now() + 11 * 60_000);

    expect(await status(token)).toBe(200);
    expect(jwksFetch).toHaveBeenCalledTimes(2);
  });
});
