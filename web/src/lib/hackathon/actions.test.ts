import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

import { mindmapPath } from "./schemas";
import { namesOnOtherTeam, submitErrorState } from "./submit-errors";

/**
 * `submitHackathonEntry` (QDIT-47): validation with the hackathon's team
 * size, the RPC call, the error copy for every code the RPC raises, and the
 * follow-up started in `after()` with the new version id.
 */
const createClient = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: () => getUser(),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

/** Collects the callbacks instead of running them after a response. */
const afterCallbacks: (() => unknown)[] = [];
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    afterCallbacks.push(callback);
  },
}));

const runGradingFor = vi.fn();
vi.mock("@/lib/hackathon/grading-worker", () => ({
  runGradingFor: (...args: unknown[]) => runGradingFor(...args),
}));

const { submitHackathonEntry } = await import("./actions");

const HACKATHON = "3f0c2a8e-1b4d-4c6e-9a7f-2d5b8e1c0a93";
const PROJECT = "7a9e4c21-5d3b-4f8a-b6c0-1e2d3f4a5b6c";
const VERSION = "9d1c7e52-3a4b-4f60-8e21-6b0f5c3d2a17";
const PEOPLE = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const GLOBAL_MAP = mindmapPath(HACKATHON, PROJECT, "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", "png");

const HACKATHON_ROW = { id: HACKATHON, slug: "bootcamp-nov", team_min: 3, team_max: 4 };

function form(overrides: Record<string, string | string[]> = {}) {
  const fields: Record<string, string | string[]> = {
    hackathonId: HACKATHON,
    projectId: PROJECT,
    teamName: "Night Owls",
    memberIds: PEOPLE,
    image_global: GLOBAL_MAP,
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  }
  return data;
}

function database(rpc: { data: unknown; error: unknown }) {
  const db = fakeDatabase({
    from: { hackathons: [{ data: HACKATHON_ROW, error: null }] },
    rpc: { submit_hackathon_entry: [rpc] },
  });
  createClient.mockResolvedValue(db.client);
  return db;
}

afterEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
});

describe("submitHackathonEntry", () => {
  it("submits, starts the follow-up for the new version, and returns ok only", async () => {
    getUser.mockResolvedValue({ id: PEOPLE[0] });
    const db = database({ data: VERSION, error: null });

    const result = await submitHackathonEntry({}, form());

    expect(result).toEqual({ ok: true });
    const call = db.requests.find((r) => r.kind === "rpc");
    expect(call?.args).toEqual({
      p_hackathon_id: HACKATHON,
      p_project_id: PROJECT,
      p_team_name: "Night Owls",
      p_member_ids: PEOPLE,
      p_image_paths: [GLOBAL_MAP],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/hackathons/bootcamp-nov");

    // Scheduled, not run inline: the response does not wait for it.
    expect(afterCallbacks).toHaveLength(1);
    expect(runGradingFor).not.toHaveBeenCalled();
    await afterCallbacks[0]();
    expect(runGradingFor).toHaveBeenCalledWith(VERSION);
  });

  it("swallows a follow-up failure and logs only the version id", async () => {
    getUser.mockResolvedValue({ id: PEOPLE[0] });
    database({ data: VERSION, error: null });
    runGradingFor.mockRejectedValueOnce(new Error("Night Owls: secret notes"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await submitHackathonEntry({}, form());
    await expect(Promise.resolve(afterCallbacks[0]())).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain(VERSION);
    expect(line).not.toContain("Night Owls");
    expect(line).not.toContain("secret");
    log.mockRestore();
  });

  it("validates with the hackathon's team size before calling the RPC", async () => {
    getUser.mockResolvedValue({ id: PEOPLE[0] });
    const db = database({ data: VERSION, error: null });

    const result = await submitHackathonEntry({}, form({ memberIds: PEOPLE.slice(0, 2), image_global: "" }));

    expect(result.fieldErrors).toEqual({
      memberIds: "Choose 3 to 4 team members.",
      images: "Attach the global mindmap image.",
    });
    expect(db.requests.some((r) => r.kind === "rpc")).toBe(false);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("refuses a signed-out caller without touching the database", async () => {
    getUser.mockResolvedValue(null);
    const result = await submitHackathonEntry({}, form());
    expect(result.error).toBe("Sign in to submit.");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("starts nothing when the RPC refuses", async () => {
    getUser.mockResolvedValue({ id: PEOPLE[0] });
    database({ data: null, error: { code: "QD409", message: "hackathon_closed", details: "", hint: null } });

    const result = await submitHackathonEntry({}, form());

    expect(result).toEqual({ error: "Submissions for this hackathon are closed." });
    expect(afterCallbacks).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("submitErrorState: every code submit_hackathon_entry raises", () => {
  it("42501: not the project's owner or admin", () => {
    expect(submitErrorState({ code: "42501", message: "Requires admin." })).toEqual({
      error: "Only the project's owner or an admin can submit it to the hackathon.",
    });
  });

  it("P0002: no such hackathon or project", () => {
    expect(submitErrorState({ code: "P0002", message: "No such hackathon." }).error).toMatch(
      /^That hackathon or project was not found\./,
    );
  });

  it("QD409 hackathon_not_open", () => {
    expect(
      submitErrorState({ code: "QD409", message: "hackathon_not_open", details: "This hackathon has not opened yet." }),
    ).toEqual({ error: "This hackathon is not open yet. Submit once it opens." });
  });

  it("QD409 hackathon_closed", () => {
    expect(submitErrorState({ code: "QD409", message: "hackathon_closed" })).toEqual({
      error: "Submissions for this hackathon are closed.",
    });
  });

  it("QD409 member_on_other_team names the people", () => {
    expect(
      submitErrorState({
        code: "QD409",
        message: "member_on_other_team",
        details: "Already on another team in this hackathon: ada.",
      }),
    ).toEqual({
      fieldErrors: {
        memberIds: "ada is already on another team in this hackathon. A person can be on one team only.",
      },
    });

    expect(
      submitErrorState({
        code: "QD409",
        message: "member_on_other_team",
        details: "Already on another team in this hackathon: ada, lin, sam.",
      }).fieldErrors?.memberIds,
    ).toBe("ada, lin and sam are already on another team in this hackathon. A person can be on one team only.");
  });

  it("QD409 member_on_other_team from the race, with no names", () => {
    expect(
      submitErrorState({
        code: "QD409",
        message: "member_on_other_team",
        details: "A team member was just added to another team in this hackathon.",
      }).fieldErrors?.memberIds,
    ).toBe("A team member just joined another team in this hackathon. Check the team and submit again.");
  });

  it("QD413 snapshot_too_large", () => {
    expect(submitErrorState({ code: "QD413", message: "snapshot_too_large" }).error).toMatch(
      /^This project is too large to submit \(over 2 MB\)\./,
    );
  });

  it("22023 with HINT team_name", () => {
    expect(
      submitErrorState({ code: "22023", message: "Team name must be 1 to 80 characters.", hint: "team_name" }),
    ).toEqual({ fieldErrors: { teamName: "Team name must be 1 to 80 characters." } });
  });

  it("22023 with HINT member_ids", () => {
    expect(
      submitErrorState({
        code: "22023",
        message: "Every team member must be a member of the project.",
        hint: "member_ids",
      }),
    ).toEqual({ fieldErrors: { memberIds: "Every team member must be a member of the project." } });
  });

  it("22023 with HINT image_paths, without the storage path", () => {
    const result = submitErrorState({
      code: "22023",
      message: `Image ${GLOBAL_MAP} was not uploaded for this project.`,
      hint: "image_paths",
    });
    expect(result).toEqual({
      fieldErrors: {
        images: "An image did not finish uploading for this project. Remove it and attach it again.",
      },
    });
    expect(JSON.stringify(result)).not.toContain(PROJECT);

    expect(
      submitErrorState({ code: "22023", message: "Attach 1 to 3 different mindmap images.", hint: "image_paths" }),
    ).toEqual({ fieldErrors: { images: "Attach 1 to 3 different mindmap images." } });
  });

  it("anything else asks for a retry", () => {
    expect(submitErrorState({ code: "57014", message: "canceling statement due to statement timeout" })).toEqual({
      error: "The submission did not go through. Try again in a moment.",
    });
  });
});

describe("namesOnOtherTeam", () => {
  it("reads the usernames out of the RPC's detail", () => {
    expect(namesOnOtherTeam("Already on another team in this hackathon: ada, lin.")).toEqual(["ada", "lin"]);
    expect(namesOnOtherTeam("Something else.")).toEqual([]);
    expect(namesOnOtherTeam(null)).toEqual([]);
  });
});
