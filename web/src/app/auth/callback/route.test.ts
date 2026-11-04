import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

const { GET } = await import("./route");

const ORIGIN = "https://qdit.test";

function get(query: string): NextRequest {
  return new Request(`${ORIGIN}/auth/callback${query}`) as unknown as NextRequest;
}

function location(response: Response): string | null {
  return response.headers.get("location");
}

beforeEach(() => {
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /auth/callback", () => {
  it("exchanges the code and redirects to the requested path on this origin", async () => {
    const response = await GET(get("?code=abc&next=/projects/demo"));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(location(response)).toBe(`${ORIGIN}/projects/demo`);
  });

  it("goes to the dashboard when no next is given", async () => {
    expect(location(await GET(get("?code=abc")))).toBe(`${ORIGIN}/dashboard`);
  });

  it("a missing code goes back to login without touching Auth", async () => {
    const response = await GET(get("?next=/projects"));
    expect(location(response)).toBe(`${ORIGIN}/login?error=missing_code`);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("a failed exchange goes back to login with the reason encoded", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "Code expired & used" } });

    const response = await GET(get("?code=old"));
    expect(location(response)).toBe(`${ORIGIN}/login?error=${encodeURIComponent("Code expired & used")}`);
  });

  it.each([
    ["an absolute off-origin URL", "https://evil.example/steal"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick browsers read as //", "/\\evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
  ])("refuses %s as the redirect target", async (_label, next) => {
    const response = await GET(get(`?code=abc&next=${encodeURIComponent(next)}`));
    const target = new URL(location(response)!);

    expect(target.origin).toBe(ORIGIN);
    expect(target.pathname).toBe("/dashboard");
  });
});
