import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  APP_ACCESS,
  APP_READ_SCOPE,
  EXPIRED_MESSAGE,
  consentPath,
  decideConsent,
  describeScopes,
  loadConsent,
  parseAuthorizationId,
  parseDecision,
  safeClientRedirect,
  type ConsentApi,
} from "./oauth-consent";
import { loginPath, safeNextPath } from "./next-path";

const DETAILS = {
  authorization_id: "auth_123",
  redirect_uri: "https://www.doqtri.xyz/api/integrations/qdit/callback",
  client: {
    id: "9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d",
    name: "doqtri",
    uri: "https://www.doqtri.xyz",
    logo_uri: "",
  },
  user: { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", email: "chloedelacruz@qdit.test" },
  scope: "openid email email profile",
};

const AUTH_ERROR = { name: "AuthApiError", message: "authorization not found", status: 404 };

/**
 * A stand-in for `supabase.auth.oauth`. Only the shape the module reads is
 * filled in; the casts are confined here so the tests read as plain calls.
 */
function fakeApi(overrides: Partial<Record<keyof ConsentApi, unknown>>): ConsentApi {
  const unused = () => {
    throw new Error("not expected in this test");
  };
  return {
    getAuthorizationDetails: overrides.getAuthorizationDetails ?? unused,
    approveAuthorization: overrides.approveAuthorization ?? unused,
    denyAuthorization: overrides.denyAuthorization ?? unused,
  } as ConsentApi;
}

beforeEach(() => {
  // The module logs Auth failures; keep the test output to the assertions.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseAuthorizationId", () => {
  it("accepts opaque URL-safe ids", () => {
    expect(parseAuthorizationId("auth_123-ABC")).toBe("auth_123-ABC");
    expect(parseAuthorizationId("  abc  ")).toBe("abc");
  });

  it("refuses anything that could change the request path", () => {
    for (const value of ["", "../admin/users", "a/b", "a.b", "a?b=1", "a%2Fb", "a b"]) {
      expect(parseAuthorizationId(value), value).toBeNull();
    }
    expect(parseAuthorizationId("a".repeat(257))).toBeNull();
    expect(parseAuthorizationId(undefined)).toBeNull();
    expect(parseAuthorizationId(["abc"])).toBeNull();
  });
});

describe("consentPath", () => {
  it("survives the trip through login as a safe next", () => {
    const path = consentPath("auth_123");
    expect(path).toBe("/oauth/consent?authorization_id=auth_123");
    expect(safeNextPath(path)).toBe(path);
    expect(loginPath(path)).toBe(
      "/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dauth_123",
    );
  });
});

describe("describeScopes", () => {
  it("labels known scopes, keeps unknown ones verbatim, drops duplicates", () => {
    expect(describeScopes("openid email email custom:thing")).toEqual([
      { scope: "openid", label: "Confirm who you are on qdit" },
      { scope: "email", label: "See your email address" },
      { scope: "custom:thing", label: "custom:thing" },
    ]);
  });

  it("is empty for no scope", () => {
    expect(describeScopes("")).toEqual([]);
    expect(describeScopes(null)).toEqual([]);
  });
});

describe("safeClientRedirect", () => {
  it("allows https anywhere and http only on loopback", () => {
    expect(safeClientRedirect("https://www.doqtri.xyz/cb?code=x&state=y")).toBe(
      "https://www.doqtri.xyz/cb?code=x&state=y",
    );
    expect(safeClientRedirect("http://localhost:3001/cb?code=x")).toBe(
      "http://localhost:3001/cb?code=x",
    );
    expect(safeClientRedirect("http://127.0.0.1:3001/cb")).toBe("http://127.0.0.1:3001/cb");
  });

  it("refuses everything else", () => {
    for (const value of [
      "http://evil.example/cb",
      "javascript:alert(1)",
      "data:text/html,hi",
      "/relative",
      "",
      "not a url",
    ]) {
      expect(safeClientRedirect(value), value).toBeNull();
    }
    expect(safeClientRedirect(undefined)).toBeNull();
  });
});

describe("parseDecision", () => {
  it("knows exactly two decisions", () => {
    expect(parseDecision("approve")).toBe("approve");
    expect(parseDecision("deny")).toBe("deny");
    expect(parseDecision("Approve")).toBeNull();
    expect(parseDecision(null)).toBeNull();
  });
});

describe("loadConsent", () => {
  it("returns what the consent screen shows", async () => {
    const getAuthorizationDetails = vi.fn().mockResolvedValue({ data: DETAILS, error: null });
    const view = await loadConsent(fakeApi({ getAuthorizationDetails }), "auth_123");

    expect(getAuthorizationDetails).toHaveBeenCalledWith("auth_123");
    expect(view).toEqual({
      kind: "consent",
      request: {
        authorizationId: "auth_123",
        client: { id: DETAILS.client.id, name: "doqtri", host: "www.doqtri.xyz" },
        redirectHost: "www.doqtri.xyz",
        scopes: [
          { scope: "openid", label: "Confirm who you are on qdit" },
          { scope: "email", label: "See your email address" },
          { scope: "profile", label: "See your name and avatar" },
        ],
        userEmail: "chloedelacruz@qdit.test",
      },
    });
  });

  it("names a client with no name rather than rendering a blank", async () => {
    const getAuthorizationDetails = vi.fn().mockResolvedValue({
      data: { ...DETAILS, client: { ...DETAILS.client, name: "  ", uri: "" } },
      error: null,
    });
    const view = await loadConsent(fakeApi({ getAuthorizationDetails }), "auth_123");

    expect(view.kind).toBe("consent");
    if (view.kind !== "consent") return;
    expect(view.request.client.name).toBe("An app");
    expect(view.request.client.host).toBeNull();
  });

  it("goes straight back when Auth says consent was already given", async () => {
    const getAuthorizationDetails = vi.fn().mockResolvedValue({
      data: { redirect_url: "https://www.doqtri.xyz/cb?code=abc&state=s" },
      error: null,
    });

    await expect(
      loadConsent(fakeApi({ getAuthorizationDetails }), "auth_123"),
    ).resolves.toEqual({ kind: "redirect", url: "https://www.doqtri.xyz/cb?code=abc&state=s" });
  });

  it("refuses an already-consented redirect that is not a web URL", async () => {
    const getAuthorizationDetails = vi.fn().mockResolvedValue({
      data: { redirect_url: "javascript:alert(1)" },
      error: null,
    });

    await expect(
      loadConsent(fakeApi({ getAuthorizationDetails }), "auth_123"),
    ).resolves.toEqual({ kind: "error", message: EXPIRED_MESSAGE });
  });

  it("turns any Auth error into the expired message", async () => {
    const getAuthorizationDetails = vi.fn().mockResolvedValue({ data: null, error: AUTH_ERROR });

    await expect(
      loadConsent(fakeApi({ getAuthorizationDetails }), "auth_123"),
    ).resolves.toEqual({ kind: "error", message: EXPIRED_MESSAGE });
  });
});

describe("decideConsent", () => {
  it("approves without letting the SDK navigate, and returns the redirect", async () => {
    const approveAuthorization = vi.fn().mockResolvedValue({
      data: { redirect_url: "https://www.doqtri.xyz/cb?code=abc&state=s" },
      error: null,
    });

    await expect(
      decideConsent(fakeApi({ approveAuthorization }), "auth_123", "approve"),
    ).resolves.toEqual({ kind: "redirect", url: "https://www.doqtri.xyz/cb?code=abc&state=s" });
    expect(approveAuthorization).toHaveBeenCalledWith("auth_123", { skipBrowserRedirect: true });
  });

  it("denies through the deny call, never the approve one", async () => {
    const approveAuthorization = vi.fn();
    const denyAuthorization = vi.fn().mockResolvedValue({
      data: { redirect_url: "https://www.doqtri.xyz/cb?error=access_denied&state=s" },
      error: null,
    });

    await expect(
      decideConsent(fakeApi({ approveAuthorization, denyAuthorization }), "auth_123", "deny"),
    ).resolves.toEqual({
      kind: "redirect",
      url: "https://www.doqtri.xyz/cb?error=access_denied&state=s",
    });
    expect(denyAuthorization).toHaveBeenCalledWith("auth_123", { skipBrowserRedirect: true });
    expect(approveAuthorization).not.toHaveBeenCalled();
  });

  it("reports an Auth failure instead of redirecting", async () => {
    const approveAuthorization = vi.fn().mockResolvedValue({ data: null, error: AUTH_ERROR });

    await expect(
      decideConsent(fakeApi({ approveAuthorization }), "auth_123", "approve"),
    ).resolves.toEqual({ kind: "error", message: EXPIRED_MESSAGE });
  });

  it("refuses a redirect that is not a web URL", async () => {
    const approveAuthorization = vi.fn().mockResolvedValue({
      data: { redirect_url: "http://evil.example/cb?code=abc" },
      error: null,
    });

    await expect(
      decideConsent(fakeApi({ approveAuthorization }), "auth_123", "approve"),
    ).resolves.toEqual({ kind: "error", message: EXPIRED_MESSAGE });
  });
});

describe("APP_ACCESS matches the guard migration", () => {
  const dir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  const sql = (name: string) => readFileSync(`${dir}${name}`, "utf8");
  const guards = sql("20261024110000_oauth_client_guards.sql");

  const tables = new Set(
    files.flatMap((name) =>
      [...sql(name).matchAll(/^create table public\.(\w+)/gm)].map((m) => m[1]),
    ),
  );

  // `create policy "…"` / `on public.<table>` / `as restrictive` / `for select`
  // / `to public` / `using (…);` — the shape every guard in the file is written in.
  const selectGuards = new Map(
    [
      ...guards.matchAll(
        /create policy "[^"]+"\s+on public\.(\w+)\s+as restrictive\s+for select\s+to public\s+using \(([\s\S]*?)\);/g,
      ),
    ].map((m) => [m[1], m[2]]),
  );

  const sorted = (values: Iterable<string>) => [...values].sort();

  it("names every table, each once", () => {
    const named = [...APP_READ_SCOPE.readable, ...APP_READ_SCOPE.ownRowOnly, ...APP_READ_SCOPE.hidden];
    expect(new Set(named).size).toBe(named.length);
    expect(sorted(named)).toEqual(sorted(tables));
  });

  it("hides exactly the tables the migration puts a SELECT guard on", () => {
    expect(sorted(selectGuards.keys())).toEqual(
      sorted([...APP_READ_SCOPE.ownRowOnly, ...APP_READ_SCOPE.hidden]),
    );
  });

  it("lets an app read its user's own row only where it says so", () => {
    for (const table of APP_READ_SCOPE.ownRowOnly) {
      // profiles keys the user by `id`, project_members by `user_id`.
      expect(selectGuards.get(table), table).toMatch(/or (user_)?id = \(select auth\.uid\(\)\)/);
    }
    for (const table of APP_READ_SCOPE.hidden) {
      expect(selectGuards.get(table)?.trim(), table).toBe(
        "((select auth.jwt()) ->> 'client_id') is null",
      );
    }
  });

  it("tells the user about every hidden table", () => {
    const words: Record<(typeof APP_READ_SCOPE.hidden)[number], string> = {
      api_requests: "log of its requests",
      deployments: "deployments",
      milestone_reviews: "review notes",
      notifications: "notifications",
      stellar_proofs: "proofs of work",
      tasks: "tasks",
    };
    const cannot = APP_ACCESS.cannot.join(" ");
    for (const table of APP_READ_SCOPE.hidden) {
      expect(cannot, table).toContain(words[table]);
    }
    expect(cannot).toContain("teammates' profiles");
    expect(cannot).toContain("who else is in your projects");
  });

  it("promises no write the migration does not allow yet", () => {
    // WP-2.4 brings renaming linked milestones and linking documents.
    const can = APP_ACCESS.can.join(" ").toLowerCase();
    expect(can).not.toMatch(/rename|link/);
  });
});
