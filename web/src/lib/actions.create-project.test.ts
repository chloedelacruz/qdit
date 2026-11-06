import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeDatabase } from "@/test/fake-supabase";

/**
 * `createProject` hands back the id of the row it made, so the dialog can
 * register that project on chain right away (QDIT-36).
 *
 * The id is chosen before the insert rather than read back from it. Reading it
 * back with `.select()` would go through the SELECT policy, which needs the
 * owner's membership row, and the AFTER INSERT trigger writes that row too late
 * for RETURNING to see. So the id sent to the database and the id returned have
 * to be the same value.
 */
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  getUser: async () => ({ id: "9d1c7e52-3a4b-4f60-8e21-6b0f5c3d2a17" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { createProject } = await import("./actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("createProject", () => {
  it("returns the id it inserted", async () => {
    const db = fakeDatabase({ from: { projects: [{ data: null, error: null }] } });
    createClient.mockResolvedValue(db.client);

    const result = await createProject({}, form({ name: "Grant build", slug: "grant-build" }));

    expect(result.ok).toBe(true);
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const insert = db.requests[0].calls.find(([method]) => method === "insert");
    expect(insert?.[1]).toMatchObject({
      id: result.id,
      owner_id: "9d1c7e52-3a4b-4f60-8e21-6b0f5c3d2a17",
      slug: "grant-build",
    });
  });

  it("puts a taken slug on the slug field", async () => {
    const db = fakeDatabase({
      from: {
        projects: [
          {
            data: null,
            // Postgres's own wording for the `slug text not null unique` column.
            error: {
              message: 'duplicate key value violates unique constraint "projects_slug_key"',
              code: "23505",
            },
          },
        ],
      },
    });
    createClient.mockResolvedValue(db.client);

    const result = await createProject({}, form({ name: "Grant build", slug: "grant-build" }));

    expect(result.ok).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.fieldErrors?.slug).toBeTruthy();
  });

  it("returns no id when the insert fails", async () => {
    const db = fakeDatabase({
      from: {
        projects: [{ data: null, error: { message: "duplicate key value", code: "23505" } }],
      },
    });
    createClient.mockResolvedValue(db.client);

    const result = await createProject({}, form({ name: "Grant build", slug: "grant-build" }));

    expect(result.ok).toBeUndefined();
    expect(result.id).toBeUndefined();
    expect(result.error).toBeTruthy();
  });
});
