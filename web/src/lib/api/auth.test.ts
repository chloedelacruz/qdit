import { AuthApiError, AuthInvalidJwtError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `supabase-js` is mocked at `createClient` only, so the real error classes
 * (and `isAuthRetryableFetchError` & co.) stay real. Each test decides what
 * `auth.getClaims()` answers; nothing here touches a network.
 */
const getClaims = vi.fn();
const createClient = vi.fn((_url: string, _key: string, options?: { accessToken?: () => Promise<string> }) =>
  options?.accessToken ? { scoped: true, options } : { auth: { getClaims } },
);

vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: (...args: Parameters<typeof createClient>) => createClient(...args),
}));

const { authenticate, expectedIssuer, readBearerToken } = await import("./auth");
const { ApiError } = await import("./errors");

const URL_ = "https://ref.supabase.co";
const TOKEN = "aaa.bbb.ccc";
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

  it("401s when the signature or expiry does not verify", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new AuthInvalidJwtError("Invalid JWT signature"),
    });

    const error = await rejection(authenticate(request(`Bearer ${TOKEN}`)));

    expect(getClaims).toHaveBeenCalledWith(TOKEN);
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

  it("builds the verifier without any session persistence", async () => {
    getClaims.mockResolvedValue({ data: { claims: claims() }, error: null });

    await authenticate(request(`Bearer ${TOKEN}`));

    expect(createClient.mock.calls[0][2]).toEqual({
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });
});
