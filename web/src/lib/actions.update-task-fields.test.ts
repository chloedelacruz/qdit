import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `updateTaskFields` backs the in-place pickers on the board card and the
 * task panel (QDIT-53). It writes only the keys it is given, so two pickers
 * saved close together cannot overwrite each other with stale values.
 */
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: async () => null,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { updateTaskFields } = await import("./actions");

const TASK = "7d2e9a41-3c5b-4f8e-a1d6-9b0c2e4f6a83";
const MEMBER = "c4a8e2f1-6b3d-4e9a-8c7f-1d5b3a9e0f26";
const MILESTONE = "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61";

function database(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const db = fakeDatabase({ from: { tasks: [result] } });
  createClient.mockResolvedValue(db.client);
  return db;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateTaskFields", () => {
  it.each([
    [{ assigneeId: MEMBER }, { assignee_id: MEMBER }],
    [{ assigneeId: null }, { assignee_id: null }],
    [{ priority: "urgent" as const }, { priority: "urgent" }],
    [{ milestoneId: MILESTONE }, { milestone_id: MILESTONE }],
    [{ milestoneId: null }, { milestone_id: null }],
    [{ dueDate: "2026-12-01" }, { due_date: "2026-12-01" }],
    [{ dueDate: null }, { due_date: null }],
  ])("writes only %o", async (fields, patch) => {
    const db = database();

    await expect(updateTaskFields(TASK, fields)).resolves.toEqual({ ok: true });

    expect(db.requests[0].calls).toContainEqual(["update", patch]);
    expect(db.requests[0].calls).toContainEqual(["eq", "id", TASK]);
  });

  it("writes nothing for an empty edit", async () => {
    const db = database();

    await expect(updateTaskFields(TASK, {})).resolves.toEqual({ ok: true });
    expect(db.requests).toHaveLength(0);
  });

  it("refuses a malformed task id without a request", async () => {
    const db = database();

    await expect(updateTaskFields("not-a-uuid", { priority: "low" })).resolves.toEqual({
      error: "Missing task.",
    });
    expect(db.requests).toHaveLength(0);
  });

  it.each([
    ["a bad date", { dueDate: "12/01/2026" }],
    ["a bad priority", { priority: "p0" }],
    ["a bad assignee id", { assigneeId: "someone" }],
    ["an unknown key", { title: "Renamed" }],
  ])("refuses %s without a request", async (_label, fields) => {
    const db = database();

    const result = await updateTaskFields(TASK, fields as never);

    expect(result.fieldErrors).toBeDefined();
    expect(db.requests).toHaveLength(0);
  });

  it("passes through the assignee guard's message (QDIT-52)", async () => {
    database({
      data: null,
      error: { code: "23514", message: "The assignee is not a member of this project." },
    });

    await expect(updateTaskFields(TASK, { assigneeId: MEMBER })).resolves.toEqual({
      error: "The assignee is not a member of this project.",
    });
  });
});
