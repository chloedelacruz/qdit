import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D-27, route by route: on a known `/api/v1` path, every method the contract
 * does not list answers `404 not_found` in the error envelope, not Next's
 * empty 405, its automatic HEAD (which would run GET) or its automatic
 * OPTIONS (an empty 204 with an `Allow` list).
 *
 * The route files are found on disk, so a new endpoint fails this test until
 * its methods are written into `SUPPORTED` below, which mirrors the endpoint
 * table in the contract (docs/integration/CONTRACT.md, section 8).
 */
const authenticate = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticate: (r: Request) => authenticate(r) }));
vi.mock("@/lib/api/audit", () => ({ recordApiRequest: async () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));

const { ROUTE_METHODS, endpointNotFound } = await import("@/lib/api/handler");

/** Route directory under `app/api/v1` -> the methods the contract lists. */
const SUPPORTED: Record<string, string[]> = {
  "[[...path]]": [],
  me: ["GET"],
  projects: ["GET"],
};

const V1 = dirname(fileURLToPath(import.meta.url));

function routeDirs(dir = V1): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeDirs(path);
    return entry.name === "route.ts" ? [relative(V1, dir).split(sep).join("/")] : [];
  });
}

const ROUTES = routeDirs().sort();

afterEach(() => {
  vi.clearAllMocks();
});

describe("/api/v1 methods (D-27)", () => {
  it("knows every route file", () => {
    expect(ROUTES).toEqual(Object.keys(SUPPORTED).sort());
  });

  describe.each(ROUTES)("app/api/v1/%s", (route) => {
    it("exports every method a Route Handler can, so Next answers none itself", async () => {
      const routeModule = await import(join(V1, route, "route.ts"));

      for (const method of ROUTE_METHODS) {
        expect(routeModule[method], method).toBeTypeOf("function");
      }
    });

    it("answers each unlisted method with the not_found envelope", async () => {
      authenticate.mockResolvedValue({ supabase: {}, claims: {}, userId: "u", clientId: `c-${route}` });
      const routeModule = await import(join(V1, route, "route.ts"));
      const unlisted = ROUTE_METHODS.filter((m) => !SUPPORTED[route].includes(m));

      for (const method of unlisted) {
        expect(routeModule[method], method).toBe(endpointNotFound);

        const path = route === "[[...path]]" ? "/api/v1" : `/api/v1/${route}`;
        const response: Response = await routeModule[method](
          new Request(`https://qdit.test${path}`, {
            method,
            headers: { authorization: "Bearer a.b.c" },
          }),
          { params: Promise.resolve({}) },
        );

        expect(response.status, method).toBe(404);
        expect(response.headers.get("content-type"), method).toBe("application/json; charset=utf-8");
        expect(response.headers.get("x-request-id"), method).toBeTruthy();
        expect(response.headers.get("allow"), method).toBeNull();
        expect(await response.json(), method).toEqual({
          error: { code: "not_found", message: expect.any(String), details: null },
        });
      }
    });

    it("keeps the listed methods on their own handlers", async () => {
      const routeModule = await import(join(V1, route, "route.ts"));

      for (const method of SUPPORTED[route]) {
        expect(routeModule[method], method).not.toBe(endpointNotFound);
      }
    });
  });
});
