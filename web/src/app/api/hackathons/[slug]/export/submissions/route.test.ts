import { afterEach, describe, expect, it, vi } from "vitest";

import { EXPORT_IMAGE_SECONDS } from "@/lib/hackathon/submissions-export";
import { fakeDatabase } from "@/test/fake-supabase";

/**
 * GET /api/hackathons/[slug]/export/submissions (WP-4.7, QDIT-63, D-123):
 * 404 for anyone who is not this hackathon's admin, works before release, one
 * row per current version with its Slides link and 7-day signed image links,
 * and nothing score-derived asked for.
 */
const getUser = vi.fn();
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getUser: () => getUser(),
  createClient: () => createClient(),
}));

const { GET } = await import("./route");

const H = "11111111-1111-4111-8111-111111111111";
const HACKATHON = {
  id: H,
  slug: "manila-26",
  name: "Manila 26",
  opens_at: "2026-11-10T01:00:00Z",
  closes_at: "2026-11-10T02:25:00Z",
  released_at: null as string | null,
  finalist_count: 10,
};

const DECK = "https://docs.google.com/presentation/d/owls/edit?usp=sharing";
const MINDMAP = "https://www.doqtri.xyz/m/Ab3_-xYz0123456789AbCd";
const signed = (path: string) => `https://xyz.supabase.co/storage/v1/object/sign/hackathon-mindmaps/${path}?token=t`;

const call = (slug = "manila-26") =>
  GET(new Request(`https://qdit.test/api/hackathons/${slug}/export/submissions`), {
    params: Promise.resolve({ slug }),
  });

function setup({
  hackathon = HACKATHON as typeof HACKATHON | null,
  role = "admin" as string | null,
  submissions = [] as unknown[],
  versions = [] as unknown[],
  signError = null as unknown,
  unsignable = [] as string[],
} = {}) {
  getUser.mockResolvedValue({ id: "admin-1", email: null });
  const fake = fakeDatabase({
    from: {
      hackathons: [{ data: hackathon, error: null }],
      hackathon_staff: [{ data: role ? { role } : null, error: null }],
      hackathon_submissions: [{ data: submissions, error: null }],
      hackathon_submission_versions: [{ data: versions, error: null }],
    },
  });
  // The expiry is read off the mock's calls below.
  const createSignedUrls = vi.fn(async (paths: string[]) =>
    signError
      ? { data: null, error: signError }
      : {
          data: paths.map((path) =>
            unsignable.includes(path)
              ? { path, signedUrl: "", error: "Object not found" }
              : { path, signedUrl: signed(path), error: null },
          ),
          error: null,
        },
  );
  const client = { ...fake.client, storage: { from: vi.fn(() => ({ createSignedUrls })) } };
  createClient.mockResolvedValue(client);
  return { ...fake, createSignedUrls, storageFrom: client.storage.from };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/hackathons/[slug]/export/submissions", () => {
  it("404 when signed out", async () => {
    setup();
    getUser.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
  });

  it("404 for an unknown hackathon", async () => {
    setup({ hackathon: null });
    expect((await call("nope")).status).toBe(404);
  });

  it.each([["judge"], [null]])("404 for a %s, without reading entries", async (role) => {
    const fake = setup({ role });
    expect((await call()).status).toBe(404);
    expect(fake.requests.some((r) => r.name === "hackathon_submissions")).toBe(false);
  });

  it("answers a header-only file when nothing is submitted yet, before release", async () => {
    const fake = setup();
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Team name,Slides link,Global mindmap,Mindmap link,Note map 1,Note map 2\r\n");
    expect(fake.requests.some((r) => r.name === "hackathon_submission_versions")).toBe(false);
    expect(fake.createSignedUrls).not.toHaveBeenCalled();
  });

  it("lists each current version by team name, with its links and 7-day signed images", async () => {
    const a1 = `${H}/p-a/one.png`;
    const a2 = `${H}/p-a/two.webp`;
    const b1 = `${H}/p-b/one.png`;
    const c1 = `${H}/p-c/one.png`;
    const fake = setup({
      submissions: [
        { id: "s-b", current_version_id: "v-b" },
        { id: "s-a", current_version_id: "v-a2" },
        { id: "s-c", current_version_id: "v-c" },
        // Mid-submit: no version yet, so no row.
        { id: "s-x", current_version_id: null },
      ],
      versions: [
        { id: "v-b", team_name: "beta", slides_url: null, mindmap_url: null, image_paths: [b1] },
        { id: "v-a2", team_name: "Alpha", slides_url: DECK, mindmap_url: MINDMAP, image_paths: [a1, a2] },
        {
          id: "v-c",
          team_name: '=HYPERLINK("x")',
          slides_url: "https://1drv.ms/p/s!Abc",
          // Stored while the database had no doqtri_origin: not doqtri's, so not exported.
          mindmap_url: "https://evil.example/m/Ab3_-xYz0123456789AbCd",
          image_paths: [c1],
        },
      ],
      unsignable: [a2],
    });

    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="manila-26-submissions.csv"');
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect((await response.text()).split("\r\n")).toEqual([
      "Team name,Slides link,Global mindmap,Mindmap link,Note map 1,Note map 2",
      // A formula-looking team name is defused and quoted; it sorts first on "'=".
      // A Mindmap link off DOQTRI_ORIGIN leaves its cell empty.
      `"'=HYPERLINK(""x"")",https://1drv.ms/p/s!Abc,${signed(c1)},,,`,
      // The Mindmap link sits after the global map; a note map Storage could
      // not sign leaves its cell empty.
      `Alpha,${DECK},${signed(a1)},${MINDMAP},,`,
      // A version from before QDIT-63 (and QDIT-66) has no links.
      `beta,,${signed(b1)},,,`,
      "",
    ]);

    // Only current versions, and only the columns the file needs.
    const versionRead = fake.requests.find((r) => r.name === "hackathon_submission_versions");
    expect(versionRead?.calls).toContainEqual(["select", "id, team_name, slides_url, mindmap_url, image_paths"]);
    // The link comes from the version, so a pruned snapshot changes nothing (QDIT-66).
    expect(fake.requests.some((r) => r.name === "hackathon_doqtri_snapshots")).toBe(false);
    expect(versionRead?.calls).toContainEqual(["in", "id", ["v-b", "v-a2", "v-c"]]);
    expect(fake.requests.find((r) => r.name === "hackathon_submissions")?.calls).toContainEqual(["eq", "hackathon_id", H]);

    expect(fake.storageFrom).toHaveBeenCalledWith("hackathon-mindmaps");
    expect(fake.createSignedUrls).toHaveBeenCalledWith([b1, a1, a2, c1], EXPORT_IMAGE_SECONDS);
    expect(EXPORT_IMAGE_SECONDS).toBe(604_800);

    // Nothing score-derived is asked for, before or after release.
    expect(fake.requests.filter((r) => r.kind === "rpc")).toEqual([]);
  });

  it("fails rather than send a file without its image links when signing fails", async () => {
    setup({
      submissions: [{ id: "s-a", current_version_id: "v-a" }],
      versions: [{ id: "v-a", team_name: "Alpha", slides_url: DECK, mindmap_url: null, image_paths: [`${H}/p-a/one.png`] }],
      signError: { message: "boom" },
    });
    await expect(call()).rejects.toThrow(/sign mindmap images/);
  });
});
