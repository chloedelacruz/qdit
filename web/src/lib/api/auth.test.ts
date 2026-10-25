import { AuthApiError, AuthInvalidJwtError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `supabase-js` is mocked at `createClient` only, so the real error classes
 * (and `isAuthRetryableFetchError` & co.) stay real. Each test decides what
 * `auth.getClaims()` answers and what `./jwks` knows; nothing here touches a
 * network. `auth.verify.test.ts` runs the real `getClaims()` end to end.
 */
const getClaims = vi.fn();
const KEY = { kty: "EC", kid: "key-1", alg: "ES256", key_ops: ["verify"] };
const signingKey = vi.fn();
vi.mock("./jwks", () => ({
  signingKey: (...args: unknown[]) => signingKey(...args),
}));
// The scoped client's one call: oauth_token_revoked() (D-59).
const rpc = vi.fn();
const createClient = vi.fn((_url: string, _key: string, options?: { accessToken?: () => Promise<string> }) =>
  options?.accessToken ? { scoped: true, options, rpc } : { auth: { getClaims } },
);

vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: (...args: Parameters<typeof createClient>) => createClient(...args),
}));

const { authenticate, expectedIssuer, readBearerToken } = await import("./auth");
const { ApiError } = await import("./errors");

const URL_ = "https://ref.supabase.co";
const b64url = (value: unknown) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const tokenWith = (header: unknown) => `${b64url(header)}.bbb.ccc`;
const TOKEN = tokenWith({ alg: "ES256", kid: "key-1", typ: "JWT" });
const USER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const CLIENT = "9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";

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

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://qdit.test/api/v1/me", { headers });
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as InstanceType<typeof ApiError>;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  vi.spyOn(console, "error").mockImplementation(() => {});
  signingKey.mockResolvedValue(KEY);
  rpc.mockResolvedValue({ data: false, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("readBearerToken", () => {
  it("reads a bearer token, scheme case-insensitive", () => {
    expect(readBearerToken(new Headers({ authorization: `Bearer ${TOKEN}` }))).toBe(TOKEN);
    expect(readBearerToken(new Headers({ authorization: `bearer ${TOKEN}` }))).toBe(TOKEN);
  });

  it("refuses other schemes, extra tokens and non-JWT shapes", () => {
    expect(readBearerToken(new Headers())).toBeNull();
    expect(readBearerToken(new Headers({ authorization: `Basic ${TOKEN}` }))).toBeNull();
    expect(readBearerToken(new Headers({ authorization: `Bearer ${TOKEN} extra` }))).toBeNull();
    expect(readBearerToken(new Headers({ authorization: "Bearer not-a-jwt" }))).toBeNull();
    expect(readBearerToken(new Headers({ authorization: "Bearer " }))).toBeNull();
  });
});

describe("expectedIssuer", () => {
  it("is the project's Auth server, trailing slash or not", () => {
    expect(expectedIssuer()).toBe(`${URL_}/auth/v1`);
    process.env.NEXT_PUBLIC_SUPABASE_URL = `${URL_}/`;
    expect(expectedIssuer()).toBe(`${URL_}/auth/v1`);
  });
});

describe("authenticate", () => {
  it("401s with WWW-Authenticate when the header is missing, without verifying anything", async () => {
    const error = await rejection(authenticate(request()));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.toBody()).toEqual({
      error: { code: "unauthorized", message: expect.any(String), details: null },
    });
    expect(error.headers["WWW-Authenticate"]).toBe('Bearer error="invalid_token"');
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("401s on a malformed header without verifying anything", async () => {
    const error = await rejection(authenticate(request("Bearer nope")));
    expect(error.code).toBe("unauthorized");
    expect(getClaims).not.toHaveBeenCalled();
  });

  it.each([
    ["an HS256 header", tokenWith({ alg: "HS256", kid: "key-1" })],
    ["alg none", tokenWith({ alg: "none", kid: "key-1" })],
    ["an alg auth-js cannot verify", tokenWith({ alg: "RS512", kid: "key-1" })],
    ["no kid", tokenWith({ alg: "ES256" })],
    ["an empty kid", tokenWith({ alg: "ES256", kid: "" })],
    ["a header that is not JSON", `${b64url("not json!")}.bbb.ccc`],
    ["a header that is JSON but not an object", tokenWith("null")],
  ])("401s on %s with no key lookup and no verification", async (_label, token) => {
    const error = await rejection(authenticate(request(`Bearer ${token}`)));

    expect(error.code).toBe("unauthorized");
    expect(signingKey).not.toHaveBeenCalled();
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("401s on a kid the JWKS does not have, without calling getClaims", async () => {
    signingKey.mockResolvedValue(null);

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));

    expect(error.code).toBe("unauthorized");
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("401s when the header alg is not the key's alg", async () => {
    signingKey.mockResolvedValue({ ...KEY, alg: "RS256", kty: "RSA" });

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));

    expect(error.code).toBe("unauthorized");
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("passes the JWKS's 503 through when no key set can be fetched", async () => {
    signingKey.mockRejectedValue(new ApiError("unavailable", "down"));

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));
    expect(error.status).toBe(503);
  });

  it.each([
    ["a SyntaxError (payload not JSON)", new SyntaxError("Unexpected token")],
    ["a plain Error (unsupported alg)", new Error("Invalid alg claim")],
    ["a DOMException (key import)", new DOMException("bad key", "DataError")],
  ])("401s, not 500s, when getClaims throws %s", async (_label, thrown) => {
    getClaims.mockRejectedValue(thrown);

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("unauthorized");
  });

  it("401s when the signature or expiry does not verify", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new AuthInvalidJwtError("Invalid JWT signature"),
    });

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));

    expect(getClaims).toHaveBeenCalledWith(TOKEN, { jwks: { keys: [KEY] } });
    expect(signingKey).toHaveBeenCalledWith(`${URL_}/auth/v1/.well-known/jwks.json`, "key-1");
    expect(error.code).toBe("unauthorized");
  });

  it("401s when the Auth server rejects the token (4xx)", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new AuthApiError("invalid JWT", 403, "bad_jwt"),
    });

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));
    expect(error.code).toBe("unauthorized");
  });

  it.each([
    ["a first-party session token (no client_id)", { client_id: undefined }],
    ["an empty client_id", { client_id: "" }],
    ["a client_id that is not a UUID (D-77)", { client_id: "doqtri" }],
    ["a client_id that is a UUID with a suffix", { client_id: `${CLIENT}x` }],
    ["a client_id that is not a string", { client_id: 42 }],
    ["another issuer", { iss: "https://evil.supabase.co/auth/v1" }],
    ["the anon role", { role: "anon" }],
    ["the service_role role", { role: "service_role" }],
    ["a sub that is not a user id", { sub: "admin" }],
    ["a past exp", { exp: Math.floor(Date.now() / 1000) - 10 }],
    ["no exp", { exp: undefined }],
  ])("401s for %s even with a valid signature", async (_label, overrides) => {
    getClaims.mockResolvedValue({ data: { claims: claims(overrides) }, error: null });

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));
    expect(error.code).toBe("unauthorized");
  });

  it("503s, not 401s, when the JWKS or Auth server cannot be reached", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new AuthRetryableFetchError("fetch failed", 0),
    });

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));
    expect(error.code).toBe("unavailable");
    expect(error.status).toBe(503);
    expect(error.headers["Retry-After"]).toBeDefined();
  });

  it("503s when the Auth server answers 5xx", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new AuthApiError("upstream", 502, undefined),
    });

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));
    expect(error.code).toBe("unavailable");
  });

  it("returns the claims and a client that sends the caller's token", async () => {
    getClaims.mockResolvedValue({ data: { claims: claims() }, error: null });

    const auth = await authenticate(request(`Bearer ${TOKEN}`));

    expect(auth.userId).toBe(USER);
    expect(auth.clientId).toBe(CLIENT);
    expect(auth.claims.sub).toBe(USER);

    // Second createClient call is the scoped one: publishable key, caller's
    // token via `accessToken` — never the secret key.
    const [url, key, options] = createClient.mock.calls[1];
    expect(url).toBe(URL_);
    expect(key).toBe("sb_publishable_test");
    await expect(options?.accessToken?.()).resolves.toBe(TOKEN);
    expect(auth.supabase).toMatchObject({ scoped: true });
  });

  it("asks the database once whether the token was revoked, with the caller's token", async () => {
    getClaims.mockResolvedValue({ data: { claims: claims() }, error: null });

    await authenticate(request(`Bearer ${TOKEN}`));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("oauth_token_revoked");
  });

  it("401s with invalid_token for a token issued before a revoke (D-59)", async () => {
    getClaims.mockResolvedValue({ data: { claims: claims() }, error: null });
    rpc.mockResolvedValue({ data: true, error: null });

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));

    expect(error.status).toBe(401);
    expect(error.code).toBe("unauthorized");
    expect(error.headers["WWW-Authenticate"]).toBe('Bearer error="invalid_token"');
  });

  it("accepts a token the database says postdates any revoke", async () => {
    getClaims.mockResolvedValue({ data: { claims: claims() }, error: null });
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await rejection(authenticate(request(`Bearer ${TOKEN}`)));

    // The re-consent's token: a later iat, so the lookup answers false.
    rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(authenticate(request(`Bearer ${TOKEN}`))).resolves.toMatchObject({ userId: USER });
  });

  it.each([
    ["the lookup returns an error", { data: null, error: { code: "57014", message: "timeout" } }],
    ["the lookup returns no answer", { data: null, error: null }],
    ["the lookup returns something other than a boolean", { data: "false", error: null }],
  ])("503s, failing closed, when %s", async (_label, answer) => {
    getClaims.mockResolvedValue({ data: { claims: claims() }, error: null });
    rpc.mockResolvedValue(answer);

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));

    expect(error.code).toBe("unavailable");
    expect(error.status).toBe(503);
    expect(error.headers["Retry-After"]).toBeDefined();
  });

  it("503s when the lookup throws", async () => {
    getClaims.mockResolvedValue({ data: { claims: claims() }, error: null });
    rpc.mockRejectedValue(new TypeError("fetch failed"));

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));
    expect(error.status).toBe(503);
  });

  it("does not look up revocations for a token it already refused", async () => {
    getClaims.mockResolvedValue({ data: { claims: claims({ client_id: undefined }) }, error: null });

    await rejection(authenticate(request(`Bearer ${TOKEN}`)));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("builds the verifier without any session persistence", async () => {
    getClaims.mockResolvedValue({ data: { claims: claims() }, error: null });

    await authenticate(request(`Bearer ${TOKEN}`));

    expect(createClient.mock.calls[0][2]).toEqual({
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });
});
