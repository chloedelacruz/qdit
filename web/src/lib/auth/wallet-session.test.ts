import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two clients, both fake: the service-role one (`createClient` from
 * supabase-js) and the caller's session one (`@/lib/supabase/server`). Each
 * PostgREST call is recorded as { client, table, op, filters, payload } and
 * answered by `respond`, which each test sets. Nothing reaches a network.
 */
type Call = {
  client: "admin" | "session";
  table: string;
  op: "select" | "update";
  filters: [string, string, unknown][];
  payload?: unknown;
  selected?: string;
};
type Answer = { data: unknown; error: unknown };

let respond: (call: Call) => Answer;
const calls: Call[] = [];

function builder(client: Call["client"], table: string) {
  const call: Call = { client, table, op: "select", filters: [] };
  const finish = () => {
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  const b = {
    select(columns: string) {
      if (call.op === "update") call.selected = columns;
      return b;
    },
    update(payload: unknown) {
      call.op = "update";
      call.payload = payload;
      return b;
    },
    eq(column: string, value: unknown) {
      call.filters.push(["eq", column, value]);
      return b;
    },
    is(column: string, value: unknown) {
      call.filters.push(["is", column, value]);
      return b;
    },
    maybeSingle: finish,
    then(resolve: (a: Answer) => unknown, reject?: (e: unknown) => unknown) {
      return finish().then(resolve, reject);
    },
  };
  return b;
}

const adminAuth = {
  getUserById: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  generateLink: vi.fn(),
  updateUserById: vi.fn(),
};
const adminClient = {
  from: (table: string) => builder("admin", table),
  auth: { admin: adminAuth },
};
const createSupabaseClient = vi.fn<(...args: unknown[]) => typeof adminClient>(() => adminClient);
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createSupabaseClient(...args),
}));

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => builder("session", table),
    auth: { verifyOtp },
  }),
}));

const { completeWalletAccount, createWalletAccount, linkWalletToProfile, signInWithWallet } = await import(
  "./wallet-session"
);

const ADDRESS = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ok = (data: unknown = null): Answer => ({ data, error: null });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ref.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  calls.length = 0;
  respond = () => ok();
  adminAuth.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "th" } }, error: null });
  adminAuth.deleteUser.mockResolvedValue({ error: null });
  verifyOtp.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("the service-role client", () => {
  it("is made per call with no session, from SUPABASE_SECRET_KEY", async () => {
    await signInWithWallet(ADDRESS);
    expect(createSupabaseClient).toHaveBeenCalledWith("https://ref.supabase.co", "sb_secret_test", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it("falls back to SUPABASE_SERVICE_ROLE_KEY", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy";
    await signInWithWallet(ADDRESS);
    expect(createSupabaseClient.mock.calls[0][1]).toBe("legacy");
  });

  it("throws when neither key is set", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    await expect(signInWithWallet(ADDRESS)).rejects.toThrow("SUPABASE_SECRET_KEY is not set");
  });
});

describe("signInWithWallet", () => {
  it("finds nobody: registration-required, and nothing is created or signed in", async () => {
    await expect(signInWithWallet(ADDRESS)).resolves.toEqual({ status: "registration-required" });

    expect(calls).toEqual([
      { client: "admin", table: "profiles", op: "select", filters: [["eq", "wallet_address", ADDRESS]] },
    ]);
    expect(adminAuth.createUser).not.toHaveBeenCalled();
    expect(adminAuth.generateLink).not.toHaveBeenCalled();
  });

  it("finds the account holding the address and mints its session as cookies", async () => {
    respond = () => ok({ id: "user-1" });
    adminAuth.getUserById.mockResolvedValueOnce({ data: { user: { email: "ada@example.com" } }, error: null });

    await expect(signInWithWallet(ADDRESS)).resolves.toEqual({ status: "signed-in" });
    expect(adminAuth.getUserById).toHaveBeenCalledWith("user-1");
    expect(adminAuth.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "ada@example.com" });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "th", type: "magiclink" });
  });

  it("an account with a placeholder email is signed in and sent to complete itself", async () => {
    respond = () => ok({ id: "user-1" });
    adminAuth.getUserById.mockResolvedValueOnce({
      data: { user: { email: "gbrpy@wallet.qdit.local" } },
      error: null,
    });

    await expect(signInWithWallet(ADDRESS)).resolves.toEqual({ status: "complete-account" });
    expect(verifyOtp).toHaveBeenCalled();
  });

  it("a failed lookup throws rather than sending the owner to registration", async () => {
    respond = () => ({ data: null, error: { message: "timeout" } });
    await expect(signInWithWallet(ADDRESS)).rejects.toThrow("Could not look up that wallet: timeout");
  });

  it("a profile whose auth user is gone throws rather than orphaning its data", async () => {
    respond = () => ok({ id: "user-1" });
    adminAuth.getUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: "User not found" } });

    await expect(signInWithWallet(ADDRESS)).rejects.toThrow("could not be loaded: User not found");
    expect(adminAuth.generateLink).not.toHaveBeenCalled();
  });

  it("a session that cannot be issued or started throws", async () => {
    respond = () => ok({ id: "user-1" });
    adminAuth.getUserById.mockResolvedValue({ data: { user: { email: "ada@example.com" } }, error: null });

    adminAuth.generateLink.mockResolvedValueOnce({ data: null, error: { message: "rate limited" } });
    await expect(signInWithWallet(ADDRESS)).rejects.toThrow("Could not issue a session: rate limited");

    verifyOtp.mockResolvedValueOnce({ error: { message: "token expired" } });
    await expect(signInWithWallet(ADDRESS)).rejects.toThrow("Could not start the session: token expired");
  });
});

describe("createWalletAccount", () => {
  const FORM = { address: ADDRESS, username: "ada", email: "ada@example.com", password: "correct horse" };

  function created() {
    adminAuth.createUser.mockResolvedValueOnce({ data: { user: { id: "new-1", email: "ada@example.com" } }, error: null });
  }

  it("creates the account with the address in app_metadata (never user_metadata), binds it and signs in", async () => {
    created();

    await expect(createWalletAccount(FORM)).resolves.toEqual({ status: "created" });

    expect(adminAuth.createUser).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "correct horse",
      email_confirm: true,
      app_metadata: { wallet_address: ADDRESS },
      user_metadata: { username: "ada", full_name: "ada" },
    });
    const bind = calls.find((c) => c.op === "update");
    expect(bind).toMatchObject({
      client: "admin",
      table: "profiles",
      payload: { wallet_address: ADDRESS },
      filters: [["eq", "id", "new-1"]],
    });
    expect(verifyOtp).toHaveBeenCalled();
  });

  it("a taken username is refused before anything is created", async () => {
    respond = (call) => (call.filters[0]?.[1] === "username" ? ok({ id: "someone" }) : ok());

    await expect(createWalletAccount(FORM)).resolves.toEqual({ status: "username-taken" });
    expect(adminAuth.createUser).not.toHaveBeenCalled();
  });

  it("a taken email is email-taken", async () => {
    adminAuth.createUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error("A user with this email address has already been registered"),
    });
    await expect(createWalletAccount(FORM)).resolves.toEqual({ status: "email-taken" });
  });

  it("an opaque `{}` failure that turns out to be a username race is username-taken", async () => {
    let usernameChecks = 0;
    respond = (call) => {
      if (call.filters[0]?.[1] !== "username") return ok();
      usernameChecks += 1;
      return usernameChecks === 1 ? ok(null) : ok({ id: "winner" });
    };
    adminAuth.createUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("{}") });

    await expect(createWalletAccount(FORM)).resolves.toEqual({ status: "username-taken" });
  });

  it("an unexplained failure is failed, with the message for the log", async () => {
    adminAuth.createUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("{}") });
    await expect(createWalletAccount(FORM)).resolves.toEqual({ status: "failed", message: "{}" });
  });

  it("an address registered in the gap deletes the half-made account: wallet-taken", async () => {
    created();
    respond = (call) => (call.op === "update" ? { data: null, error: { code: "23505", message: "dup" } } : ok());

    await expect(createWalletAccount(FORM)).resolves.toEqual({ status: "wallet-taken" });
    expect(adminAuth.deleteUser).toHaveBeenCalledWith("new-1");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("any other bind failure also deletes the account rather than leave one nobody can open", async () => {
    created();
    respond = (call) => (call.op === "update" ? { data: null, error: { code: "XX000", message: "boom" } } : ok());

    await expect(createWalletAccount(FORM)).resolves.toEqual({ status: "failed", message: "boom" });
    expect(adminAuth.deleteUser).toHaveBeenCalledWith("new-1");
  });
});

describe("completeWalletAccount", () => {
  const FORM = { userId: "user-1", username: "ada", email: "ada@example.com", password: "pw-pw-pw-pw" };

  it("writes the profile first on the caller's own client, then sets credentials with the admin client", async () => {
    adminAuth.updateUserById.mockResolvedValueOnce({ error: null });

    await expect(completeWalletAccount(FORM)).resolves.toEqual({ status: "created" });

    expect(calls).toEqual([
      {
        client: "session",
        table: "profiles",
        op: "update",
        payload: { username: "ada", display_name: "ada" },
        filters: [["eq", "id", "user-1"]],
      },
    ]);
    expect(adminAuth.updateUserById).toHaveBeenCalledWith("user-1", {
      email: "ada@example.com",
      password: "pw-pw-pw-pw",
      email_confirm: true,
      user_metadata: { username: "ada", full_name: "ada" },
    });
  });

  it("a taken username stops before the credentials change", async () => {
    respond = () => ({ data: null, error: { code: "23505", message: "dup" } });

    await expect(completeWalletAccount(FORM)).resolves.toEqual({ status: "username-taken" });
    expect(adminAuth.updateUserById).not.toHaveBeenCalled();
  });

  it("another profile failure is failed", async () => {
    respond = () => ({ data: null, error: { code: "42501", message: "denied" } });
    await expect(completeWalletAccount(FORM)).resolves.toEqual({ status: "failed", message: "denied" });
  });

  it("a taken email on the credentials update is email-taken", async () => {
    adminAuth.updateUserById.mockResolvedValueOnce({ error: new Error("email_exists") });
    await expect(completeWalletAccount(FORM)).resolves.toEqual({ status: "email-taken" });
  });
});

describe("linkWalletToProfile", () => {
  it("binds once: only where the address is still null, on the caller's own client", async () => {
    respond = () => ok([{ id: "user-1" }]);

    await expect(linkWalletToProfile("user-1", ADDRESS)).resolves.toEqual({ status: "linked" });
    expect(calls[0]).toMatchObject({
      client: "session",
      table: "profiles",
      op: "update",
      payload: { wallet_address: ADDRESS },
      filters: [
        ["eq", "id", "user-1"],
        ["is", "wallet_address", null],
      ],
      selected: "id",
    });
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it("no row updated: the account already has an address", async () => {
    respond = () => ok([]);
    await expect(linkWalletToProfile("user-1", ADDRESS)).resolves.toEqual({ status: "already-set" });
  });

  it("the unique index firing: another account holds the address", async () => {
    respond = () => ({ data: null, error: { code: "23505", message: "dup" } });
    await expect(linkWalletToProfile("user-1", ADDRESS)).resolves.toEqual({ status: "taken" });
  });

  it("any other error is failed", async () => {
    respond = () => ({ data: null, error: { code: "P0001", message: "frozen" } });
    await expect(linkWalletToProfile("user-1", ADDRESS)).resolves.toEqual({ status: "failed", message: "frozen" });
  });
});
