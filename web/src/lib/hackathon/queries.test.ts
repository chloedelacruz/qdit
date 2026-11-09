import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

/**
 * The participant page never asks for what organisers decide about an entry
 * (QDIT-47, D-116). The database hides those columns too; this holds the
 * page's own queries to never naming them, and its copy to never mentioning
 * them.
 */
const createClient = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: () => getUser(),
}));

const { getHackathonPage, PAGE_COLUMNS, SIGNED_URL_SECONDS } = await import("./queries");

/** Columns and words a team must never be shown or sent. */
const FORBIDDEN_COLUMN =
  /\*|eligib|override|overridden|score|rank|flag|grade|grading|ai_|criteria|summary|total|usage|payload|qdit_snapshot|chain_check|released_by|pitch|finalist|judge/i;

/** Tables and functions that carry grades or the organisers' view. */
const FORBIDDEN_SOURCES = [
  "hackathon_ai_runs",
  "hackathon_grading_jobs",
  "hackathon_finalists",
  "hackathon_judge_scores",
  "hackathon_staff",
  "hackathon_leaderboard",
  "hackathon_grading_status",
];

const ME = "11111111-1111-4111-8111-111111111111";
const LIN = "22222222-2222-4222-8222-222222222222";
const SAM = "33333333-3333-4333-8333-333333333333";
const HACKATHON = "3f0c2a8e-1b4d-4c6e-9a7f-2d5b8e1c0a93";
const PROJECT = "7a9e4c21-5d3b-4f8a-b6c0-1e2d3f4a5b6c";
const VIEWER_PROJECT = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const SUBMISSION = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const V1 = "aaaaaaaa-0000-4000-8000-000000000001";
const V2 = "aaaaaaaa-0000-4000-8000-000000000002";
const SNAP_OLD = "bbbbbbbb-0000-4000-8000-000000000001";
const SNAP_NEW = "bbbbbbbb-0000-4000-8000-000000000002";
const MAP = `${HACKATHON}/${PROJECT}/cccccccc-0000-4000-8000-000000000001.png`;

function scriptedDatabase(failing?: string) {
  const script: { from: Record<string, { data: unknown; error: unknown }[]> } = {
    from: {
      hackathons: [
        {
          data: {
            id: HACKATHON,
            slug: "bootcamp-nov",
            name: "Bootcamp hackathon",
            description: "Build for 80 minutes.",
            opens_at: "2026-11-20T06:00:00.000Z",
            closes_at: "2026-11-20T06:05:00.000Z",
            team_min: 3,
            team_max: 4,
            released_at: null,
          },
          error: null,
        },
      ],
      project_members: [
        // The caller's own roles.
        {
          data: [
            { project_id: PROJECT, user_id: ME, role: "owner" },
            { project_id: VIEWER_PROJECT, user_id: ME, role: "viewer" },
          ],
          error: null,
        },
        // The roster of the project the caller can submit.
        {
          data: [
            { project_id: PROJECT, user_id: ME, role: "owner" },
            { project_id: PROJECT, user_id: LIN, role: "member" },
            { project_id: PROJECT, user_id: SAM, role: "member" },
          ],
          error: null,
        },
      ],
      projects: [
        {
          data: [
            { id: PROJECT, slug: "night-owls", name: "Night Owls app" },
            { id: VIEWER_PROJECT, slug: "other", name: "Another project" },
          ],
          error: null,
        },
      ],
      hackathon_submissions: [
        {
          data: [{ id: SUBMISSION, project_id: PROJECT, team_name: "Night Owls", current_version_id: V2 }],
          error: null,
        },
      ],
      hackathon_doqtri_snapshots: [
        {
          data: [
            { id: SNAP_NEW, project_id: PROJECT, note_count: 12, received_at: "2026-11-20T06:04:00.000Z" },
            { id: SNAP_OLD, project_id: PROJECT, note_count: 9, received_at: "2026-11-20T06:01:00.000Z" },
          ],
          error: null,
        },
      ],
      hackathon_late_passes: [{ data: [], error: null }],
      hackathon_submission_versions: [
        {
          data: [
            {
              id: V1,
              submission_id: SUBMISSION,
              version_no: 1,
              submitted_at: "2026-11-20T06:02:00.000Z",
              image_paths: [MAP],
              doqtri_snapshot_id: SNAP_OLD,
            },
            {
              id: V2,
              submission_id: SUBMISSION,
              version_no: 2,
              submitted_at: "2026-11-20T06:03:00.000Z",
              image_paths: [MAP],
              doqtri_snapshot_id: SNAP_OLD,
            },
          ],
          error: null,
        },
      ],
      hackathon_team_members: [
        {
          data: [
            { submission_id: SUBMISSION, user_id: ME },
            { submission_id: SUBMISSION, user_id: LIN },
            { submission_id: SUBMISSION, user_id: SAM },
          ],
          error: null,
        },
      ],
      profiles: [
        {
          data: [
            { id: ME, display_name: "Ada Reyes", username: "ada" },
            { id: LIN, display_name: "Lin", username: "lin" },
            { id: SAM, display_name: null, username: "sam" },
          ],
          error: null,
        },
      ],
    },
  };

  if (failing) {
    // That table's first answer becomes a PostgREST error.
    script.from[failing][0] = { data: null, error: { code: "57014", message: "statement timeout" } };
  }
  const db = fakeDatabase(script);
  const signed: unknown[][] = [];
  const client = {
    ...db.client,
    rpc: (name: string) => {
      throw new Error(`the participant page called rpc(${name})`);
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[], seconds: number) => {
          signed.push([bucket, paths, seconds]);
          return {
            data: paths.map((path) => ({ path, signedUrl: `https://storage.test/${path}?token=t`, error: null })),
            error: null,
          };
        },
      }),
    },
  };
  createClient.mockResolvedValue(client);
  return { db, signed };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("participant hackathon queries", () => {
  it("name no column, table or function that carries a grade or a decision", async () => {
    getUser.mockResolvedValue({ id: ME, email: "ada@example.test" });
    const { db } = scriptedDatabase();

    await getHackathonPage("bootcamp-nov");

    expect(db.remaining()).toEqual([]);
    for (const request of db.requests) {
      expect(FORBIDDEN_SOURCES).not.toContain(request.name);
      expect(request.kind).toBe("from");

      const selects = request.calls.filter(([method]) => method === "select");
      expect(selects, `${request.name} names its columns`).toHaveLength(1);
      const columns = String(selects[0][1]);
      expect(columns, request.name).not.toMatch(FORBIDDEN_COLUMN);
      expect(columns).toBe(PAGE_COLUMNS[request.name as keyof typeof PAGE_COLUMNS]);
    }
  });

  it("keeps the column list itself clean", () => {
    for (const [table, columns] of Object.entries(PAGE_COLUMNS)) {
      expect(columns, table).not.toMatch(FORBIDDEN_COLUMN);
      expect(FORBIDDEN_SOURCES).not.toContain(table);
    }
  });

  it("reads only the caller's own projects' entries, even for staff", async () => {
    getUser.mockResolvedValue({ id: ME, email: null });
    const { db } = scriptedDatabase();

    await getHackathonPage("bootcamp-nov");

    const submissions = db.requests.find((r) => r.name === "hackathon_submissions");
    expect(submissions?.calls).toContainEqual(["in", "project_id", [PROJECT, VIEWER_PROJECT]]);
    expect(submissions?.calls).toContainEqual(["eq", "hackathon_id", HACKATHON]);
  });

  it("builds the entry: team, members, versions, latest snapshot and signed thumbnails", async () => {
    getUser.mockResolvedValue({ id: ME, email: null });
    const { signed } = scriptedDatabase();

    const page = await getHackathonPage("bootcamp-nov");

    expect(page?.hackathon).toMatchObject({ id: HACKATHON, teamMin: 3, teamMax: 4 });
    const owned = page?.projects.find((p) => p.id === PROJECT);
    expect(owned).toMatchObject({
      canSubmit: true,
      latePassUntil: null,
      latestSnapshot: { id: SNAP_NEW, noteCount: 12, receivedAt: "2026-11-20T06:04:00.000Z" },
      entry: {
        teamName: "Night Owls",
        versionCount: 2,
        lastSubmittedAt: "2026-11-20T06:03:00.000Z",
        snapshotId: SNAP_OLD,
        images: [{ path: MAP, url: `https://storage.test/${MAP}?token=t` }],
      },
    });
    expect(owned?.entry?.members.map((m) => m.name)).toEqual(["Ada Reyes", "Lin", "sam"]);
    expect(owned?.members.map((m) => m.username)).toEqual(["ada", "lin", "sam"]);

    // A project the caller only views: no roster, cannot submit.
    expect(page?.projects.find((p) => p.id === VIEWER_PROJECT)).toMatchObject({
      canSubmit: false,
      members: [],
      entry: null,
    });

    expect(signed).toEqual([["hackathon-mindmaps", [MAP], SIGNED_URL_SECONDS]]);
    expect(SIGNED_URL_SECONDS).toBeLessThanOrEqual(900);
  });

  it.each([
    "hackathons",
    "project_members",
    "projects",
    "hackathon_submissions",
    "hackathon_doqtri_snapshots",
    "hackathon_late_passes",
    "hackathon_submission_versions",
    "hackathon_team_members",
    "profiles",
  ])("throws, naming only the table, when reading %s fails", async (table) => {
    getUser.mockResolvedValue({ id: ME, email: null });
    scriptedDatabase(table);

    await expect(getHackathonPage("bootcamp-nov")).rejects.toThrow(`hackathon page: could not read ${table}`);
  });

  it("returns null for an unknown slug", async () => {
    getUser.mockResolvedValue({ id: ME, email: null });
    const db = fakeDatabase({
      from: {
        hackathons: [{ data: null, error: null }],
        project_members: [{ data: [], error: null }],
      },
    });
    createClient.mockResolvedValue(db.client);

    expect(await getHackathonPage("nope")).toBeNull();
  });
});

describe("participant copy", () => {
  const FILES = [
    "../../app/(app)/hackathons/[slug]/page.tsx",
    "../../app/(app)/hackathons/[slug]/not-found.tsx",
    "../../components/hackathon/submit-form.tsx",
    "../../components/hackathon/image-upload.tsx",
    "../../components/hackathon/countdown.tsx",
    "./queries.ts",
    "./window.ts",
    "./submit-errors.ts",
  ];

  /** Words that would tell a team how entries are judged. */
  const FORBIDDEN_WORDS = /eligib|\bscor(e|es|ed|ing)\b|\brank|\bgrad(e|es|ed|ing)\b|\bAI\b|artificial|claude|anthropic|\bflag|leaderboard|finalist|judg|override/i;

  it.each(FILES)("%s never mentions judging", (file) => {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    expect(source).not.toMatch(FORBIDDEN_WORDS);
  });

  it("the user guide's hackathon section never mentions judging", () => {
    const guide = readFileSync(
      fileURLToPath(new URL("../../app/user-guide/page.tsx", import.meta.url)),
      "utf8",
    );
    const start = guide.indexOf('id: "hackathon"');
    expect(start).toBeGreaterThan(0);
    const section = guide.slice(start, guide.indexOf("\n  },\n", start));
    expect(section).toContain("Add submission to hackathon");
    expect(section).not.toMatch(FORBIDDEN_WORDS);
  });
});
