import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `updateMilestone` leaves the title alone on a milestone linked to a doqtri
 * heading (D-12), and edits it as before on any other. The database refuses a
 * qdit session's change to a linked title anyway
 * (supabase/tests/integration_links.test.sql); this is the part that keeps the
 * rest of the form's save working.
 */
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: async () => null,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { updateMilestone } = await import("./actions");

const MILESTONE = "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61";
const PROJECT = "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const FIELDS = {
  milestoneId: MILESTONE,
  projectId: PROJECT,
  title: "Renamed in qdit",
  description: "New notes",
  status: "proposed",
  dueDate: "2026-11-15",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateMilestone", () => {
  it("skips the title of a linked milestone and saves the rest", async () => {
    const db = fakeDatabase({
      from: {
        milestone_external_links: [{ data: null, error: null, count: 1 }],
        milestones: [{ data: null, error: null }],
      },
    });
    createClient.mockResolvedValue(db.client);

    await expect(updateMilestone({}, form(FIELDS))).resolves.toEqual({ ok: true });

    expect(db.requests[0].calls).toContainEqual(["eq", "milestone_id", MILESTONE]);
    expect(db.requests[1].calls).toContainEqual([
      "update",
      { description: "New notes", due_date: "2026-11-15" },
    ]);
  });

  it("saves the title of an unlinked milestone", async () => {
    const db = fakeDatabase({
      from: {
        milestone_external_links: [{ data: null, error: null, count: 0 }],
        milestones: [{ data: null, error: null }],
      },
    });
    createClient.mockResolvedValue(db.client);

    await expect(updateMilestone({}, form(FIELDS))).resolves.toEqual({ ok: true });

    expect(db.requests[1].calls).toContainEqual([
      "update",
      { title: "Renamed in qdit", description: "New notes", due_date: "2026-11-15" },
    ]);
  });
});
