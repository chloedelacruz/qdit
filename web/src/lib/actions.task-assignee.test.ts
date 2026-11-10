import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

/**
 * QDIT-52: `tasks_guard_assignee` refuses an assignee who is not a member of
 * the task's project (supabase/tests/task_assignee_membership.test.sql). The
 * actions pass its message through instead of the generic 23514 one, so the
 * dialog says which field is wrong.
 */
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: async () => null,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { createTask, updateTask } = await import("./actions");

const PROJECT = "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34";
const TASK = "7d2e9a41-3c5b-4f8e-a1d6-9b0c2e4f6a83";
const STRANGER = "c4a8e2f1-6b3d-4e9a-8c7f-1d5b3a9e0f26";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const FIELDS = { projectId: PROJECT, title: "Write the brief", assigneeId: STRANGER };

const GUARD = {
  data: null,
  error: { code: "23514", message: "The assignee is not a member of this project." },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("task assignee outside the project", () => {
  it("createTask surfaces the guard's message", async () => {
    createClient.mockResolvedValue(fakeDatabase({ from: { tasks: [GUARD] } }).client);

    await expect(createTask({}, form(FIELDS))).resolves.toEqual({
      error: "The assignee is not a member of this project.",
    });
  });

  it("updateTask surfaces the guard's message", async () => {
    createClient.mockResolvedValue(fakeDatabase({ from: { tasks: [GUARD] } }).client);

    await expect(updateTask({}, form({ ...FIELDS, taskId: TASK }))).resolves.toEqual({
      error: "The assignee is not a member of this project.",
    });
  });

  it("keeps the generic message for other check violations", async () => {
    createClient.mockResolvedValue(
      fakeDatabase({
        from: { tasks: [{ data: null, error: { code: "23514", message: "tasks_title_check" } }] },
      }).client,
    );

    await expect(createTask({}, form(FIELDS))).resolves.toEqual({
      error: "That value is not allowed by the database constraints.",
    });
  });
});
