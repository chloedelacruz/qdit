import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
const from = vi.fn<(table: string) => { insert: typeof insert }>(() => ({ insert }));
const createClient = vi.fn<(...args: unknown[]) => { from: typeof from }>(() => ({ from }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}));

const { recordApiRequest } = await import("./audit");

const URL_ = "https://ref.supabase.co";
const RECORD = {
  requestId: "req-1",
  clientId: "client-1",
  userId: "user-1",
  method: "patch",
  path: "/api/v1/milestones/m-1",
  status: 200,
};

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  insert.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete process.env.SUPABASE_SECRET_KEY;
});

describe("recordApiRequest", () => {
  it("writes one api_requests row with the secret key and no session", async () => {
    await recordApiRequest(RECORD);

    expect(createClient).toHaveBeenCalledWith(URL_, "sb_secret_test", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(from).toHaveBeenCalledWith("api_requests");
    expect(insert).toHaveBeenCalledWith({
      request_id: "req-1",
      client_id: "client-1",
      user_id: "user-1",
      method: "PATCH",
      path: "/api/v1/milestones/m-1",
      status: 200,
    });
  });

  it("falls back to SUPABASE_SERVICE_ROLE_KEY", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy_service_role";

    await recordApiRequest(RECORD);
    expect(createClient.mock.calls[0][1]).toBe("legacy_service_role");
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("truncates the path to the column's 2048-character limit", async () => {
    await recordApiRequest({ ...RECORD, path: `/api/v1/${"x".repeat(5000)}` });
    expect(insert.mock.calls[0][0].path).toHaveLength(2048);
  });

  it("drops the row and logs, without throwing, when no secret is set", async () => {
    delete process.env.SUPABASE_SECRET_KEY;

    await expect(recordApiRequest(RECORD)).resolves.toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("req-1"));
  });

  it("a failed insert is logged and swallowed: an audit outage is not an API outage", async () => {
    insert.mockResolvedValueOnce({ error: { message: "db down" } });

    await expect(recordApiRequest(RECORD)).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("req-1"),
      expect.objectContaining({ message: "db down" }),
    );
  });
});
