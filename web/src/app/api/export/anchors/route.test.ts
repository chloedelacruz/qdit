import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The query (RLS-scoped, as the caller) and the CSV builder are stood in for;
 * `lib/export.test.ts` covers the CSV itself. Under test: the gate, the
 * parameter, the 404 for a project the caller cannot see, and the download
 * headers.
 */
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getUser: () => getUser() }));

const getAnchorExport = vi.fn();
vi.mock("@/lib/queries", () => ({ getAnchorExport: (slug: string) => getAnchorExport(slug) }));

const buildAnchorCsv = vi.fn<(data: unknown) => string>(() => "milestone,status\r\nShip,approved\r\n");
vi.mock("@/lib/export", () => ({ buildAnchorCsv: (data: unknown) => buildAnchorCsv(data) }));

const { GET } = await import("./route");

const get = (query: string) => new Request(`https://qdit.test/api/export/anchors${query}`);
const DATA = { project: { name: "Demo", slug: "demo" }, rows: [] };

beforeEach(() => {
  getUser.mockResolvedValue({ id: "user-1", email: null });
  getAnchorExport.mockResolvedValue(DATA);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T08:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("GET /api/export/anchors", () => {
  it("401 when signed out, with no query", async () => {
    getUser.mockResolvedValueOnce(null);
    const response = await GET(get("?project=demo"));
    expect(response.status).toBe(401);
    expect(getAnchorExport).not.toHaveBeenCalled();
  });

  it("400 without a project (blank counts as missing)", async () => {
    expect((await GET(get(""))).status).toBe(400);
    expect((await GET(get("?project=%20%20"))).status).toBe(400);
  });

  it("404 when RLS hides the project: no empty file that admits it exists", async () => {
    getAnchorExport.mockResolvedValueOnce(null);
    const response = await GET(get("?project=secret"));
    expect(response.status).toBe(404);
    expect(buildAnchorCsv).not.toHaveBeenCalled();
  });

  it("returns the CSV as an uncached attachment named for the project and day", async () => {
    const response = await GET(get("?project=%20demo%20"));

    expect(getAnchorExport).toHaveBeenCalledWith("demo");
    expect(buildAnchorCsv).toHaveBeenCalledWith(DATA);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="qdit-anchors-demo-2026-11-04.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("milestone,status\r\nShip,approved\r\n");
  });

  it("keeps a hostile slug out of the filename header", async () => {
    const response = await GET(get(`?project=${encodeURIComponent('a"b\r\nx;y/../z')}`));
    const disposition = response.headers.get("content-disposition")!;

    expect(disposition).toMatch(/^attachment; filename="qdit-anchors-[a-z0-9-]+-2026-11-04\.csv"$/i);
  });
});
