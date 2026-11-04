import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** As the anchors route beside it: `lib/export.test.ts` covers the HTML itself. */
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getUser: () => getUser() }));

const getMilestoneExport = vi.fn();
vi.mock("@/lib/queries", () => ({
  getMilestoneExport: (slug: string, id: string) => getMilestoneExport(slug, id),
}));

const buildCertificateHtml = vi.fn<(cert: unknown) => string>(() => "<!doctype html><title>cert</title>");
vi.mock("@/lib/export", () => ({ buildCertificateHtml: (cert: unknown) => buildCertificateHtml(cert) }));

const { GET } = await import("./route");

const MILESTONE = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const get = (query: string) => new Request(`https://qdit.test/api/export/certificate${query}`);
const CERT = { project: { slug: "demo" }, milestone: { id: MILESTONE } };

beforeEach(() => {
  getUser.mockResolvedValue({ id: "user-1", email: null });
  getMilestoneExport.mockResolvedValue(CERT);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/export/certificate", () => {
  it("401 when signed out, with no query", async () => {
    getUser.mockResolvedValueOnce(null);
    expect((await GET(get(`?project=demo&milestone=${MILESTONE}`))).status).toBe(401);
    expect(getMilestoneExport).not.toHaveBeenCalled();
  });

  it("400 unless both project and milestone are given", async () => {
    for (const query of ["", "?project=demo", `?milestone=${MILESTONE}`, `?project=%20&milestone=${MILESTONE}`]) {
      expect((await GET(get(query))).status).toBe(400);
    }
    expect(getMilestoneExport).not.toHaveBeenCalled();
  });

  it("404 when RLS hides the milestone", async () => {
    getMilestoneExport.mockResolvedValueOnce(null);
    expect((await GET(get(`?project=demo&milestone=${MILESTONE}`))).status).toBe(404);
    expect(buildCertificateHtml).not.toHaveBeenCalled();
  });

  it("returns one HTML document as an uncached attachment", async () => {
    const response = await GET(get(`?project=demo&milestone=${MILESTONE}`));

    expect(getMilestoneExport).toHaveBeenCalledWith("demo", MILESTONE);
    expect(buildCertificateHtml).toHaveBeenCalledWith(CERT);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="qdit-certificate-demo-1a2b3c4d.html"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("<!doctype html><title>cert</title>");
  });

  it("keeps a hostile slug out of the filename header", async () => {
    const response = await GET(get(`?project=${encodeURIComponent('x"\r\n')}&milestone=${MILESTONE}`));
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="qdit-certificate-[a-z0-9-]+-1a2b3c4d\.html"$/i,
    );
  });
});
