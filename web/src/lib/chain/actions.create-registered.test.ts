import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Creating a project that is registered on chain from the start (QDIT-36).
 *
 * `createRegisteredProject` must keep the row and the registration together:
 * a signature for another id is refused before anything is written, a form
 * that bounces never reaches the chain, and a transaction that fails takes the
 * row with it.
 *
 * Mocked: the RPC half of `./client` (signedInvocation, submitSigned,
 * buildUnsigned), the insert (`createProjectWithId`, tested in
 * `actions.create-project.test.ts`) and the database calls made here.
 */

const signedInvocation = vi.fn();
const submitSigned = vi.fn();
const buildUnsigned = vi.fn();
vi.mock("@/lib/chain/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chain/client")>()),
  signedInvocation: (...args: unknown[]) => signedInvocation(...args),
  submitSigned: (...args: unknown[]) => submitSigned(...args),
  buildUnsigned: (...args: unknown[]) => buildUnsigned(...args),
}));

const createProjectWithId = vi.fn();
vi.mock("@/lib/actions", () => ({
  createProjectWithId: (...args: unknown[]) => createProjectWithId(...args),
}));

type Write = { table: string; op: "update" | "delete"; payload?: unknown; filters: [string, unknown][] };
const writes: Write[] = [];
let updateError: unknown = null;
let deleteError: unknown = null;
function from(table: string) {
  const write: Write = { table, op: "update", filters: [] };
  const b = {
    update(payload: unknown) {
      write.op = "update";
      write.payload = payload;
      return b;
    },
    delete() {
      write.op = "delete";
      return b;
    },
    eq(column: string, value: unknown) {
      write.filters.push([column, value]);
      writes.push(write);
      return Promise.resolve({
        data: null,
        error: write.op === "update" ? updateError : deleteError,
      });
    },
  };
  return b;
}

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
  getUser: () => getUser(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const actions = await import("./actions");

const CONTRACT = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";
const OWNER_WALLET = Keypair.random().publicKey();
const PROJECT = "11111111-1111-4111-8111-111111111111";
const TX = "ab".repeat(32);

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  const all = {
    name: "Grant build",
    slug: "grant-build",
    chainProjectId: PROJECT,
    signedXdr: "SIGNED",
    ...fields,
  };
  for (const [key, value] of Object.entries(all)) data.set(key, value);
  return data;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID = CONTRACT;
  process.env.NEXT_PUBLIC_STELLAR_NETWORK = "testnet";
  getUser.mockResolvedValue({ id: "owner-user" });
  signedInvocation.mockReturnValue({ source: OWNER_WALLET, args: [PROJECT, OWNER_WALLET] });
  createProjectWithId.mockResolvedValue({ ok: true, id: PROJECT });
  submitSigned.mockResolvedValue({
    status: "confirmed",
    txHash: TX,
    ledger: 7,
    signer: OWNER_WALLET,
    attempts: 1,
  });
});

afterEach(() => {
  vi.resetAllMocks();
  writes.length = 0;
  updateError = null;
  deleteError = null;
});

describe("prepareNewProjectRegistration", () => {
  it("picks a fresh id and builds create_project_ref for it, owned by the signer", async () => {
    buildUnsigned.mockResolvedValue({ xdr: "UNSIGNED", feeStroops: "100" });

    const prepared = await actions.prepareNewProjectRegistration(OWNER_WALLET);

    expect(prepared.ok).toBe(true);
    const projectId = prepared.ok ? prepared.data.projectId : undefined;
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(buildUnsigned.mock.calls[0][0]).toMatchObject({
      method: "create_project_ref",
      signer: OWNER_WALLET,
      args: { project_id: projectId, owner: OWNER_WALLET },
    });
  });

  it("refuses without a session", async () => {
    getUser.mockResolvedValue(null);
    const prepared = await actions.prepareNewProjectRegistration(OWNER_WALLET);
    expect(prepared).toEqual({ ok: false, error: "Your session expired. Sign in again." });
    expect(buildUnsigned).not.toHaveBeenCalled();
  });

  it("refuses a signer that is not an account address", async () => {
    const prepared = await actions.prepareNewProjectRegistration(CONTRACT);
    expect(prepared.ok).toBe(false);
    expect(buildUnsigned).not.toHaveBeenCalled();
  });
});

describe("createRegisteredProject", () => {
  it("creates the project, submits, and records the signer as the chain owner", async () => {
    await expect(actions.createRegisteredProject({}, form())).resolves.toEqual({
      ok: true,
      id: PROJECT,
    });

    expect(createProjectWithId.mock.calls[0][1]).toBe(PROJECT);
    expect(submitSigned.mock.calls[0][0]).toBe("SIGNED");
    expect(writes).toEqual([
      {
        table: "projects",
        op: "update",
        payload: expect.objectContaining({
          chain_contract_id: CONTRACT,
          chain_network: "testnet",
          chain_owner_address: OWNER_WALLET,
          chain_registered_tx: TX,
        }),
        filters: [["id", PROJECT]],
      },
    ]);
  });

  it("refuses a signature for a different project id, before writing anything", async () => {
    signedInvocation.mockReturnValue({
      source: OWNER_WALLET,
      args: ["99999999-9999-4999-8999-999999999999", OWNER_WALLET],
    });

    const result = await actions.createRegisteredProject({}, form());

    expect(result.ok).toBeUndefined();
    expect(result.error).toMatch(/different registration/);
    expect(createProjectWithId).not.toHaveBeenCalled();
    expect(submitSigned).not.toHaveBeenCalled();
  });

  it("refuses an owner other than the account that signed", async () => {
    signedInvocation.mockReturnValue({
      source: OWNER_WALLET,
      args: [PROJECT, Keypair.random().publicKey()],
    });

    const result = await actions.createRegisteredProject({}, form());

    expect(result.error).toMatch(/different registration/);
    expect(createProjectWithId).not.toHaveBeenCalled();
  });

  it("refuses an envelope that is not create_project_ref on this contract", async () => {
    signedInvocation.mockImplementation(() => {
      throw new Error("The signed transaction targets a different contract.");
    });

    const result = await actions.createRegisteredProject({}, form());

    expect(result.error).toBe("The signed transaction targets a different contract.");
    expect(createProjectWithId).not.toHaveBeenCalled();
  });

  it("refuses a form missing the id or the signature", async () => {
    const result = await actions.createRegisteredProject({}, form({ signedXdr: "" }));
    expect(result.error).toMatch(/incomplete/);
    expect(signedInvocation).not.toHaveBeenCalled();
  });

  it("never sends the transaction when the form bounces", async () => {
    createProjectWithId.mockResolvedValue({ fieldErrors: { slug: "That slug is taken." } });

    await expect(actions.createRegisteredProject({}, form())).resolves.toEqual({
      fieldErrors: { slug: "That slug is taken." },
    });
    expect(submitSigned).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("deletes the project again when the transaction fails", async () => {
    submitSigned.mockRejectedValue(new Error("The transaction failed on chain."));

    const result = await actions.createRegisteredProject({}, form());

    expect(result.ok).toBeUndefined();
    expect(result.error).toBe("The transaction failed on chain. Nothing was created.");
    expect(writes).toEqual([
      { table: "projects", op: "delete", filters: [["id", PROJECT]] },
    ]);
  });

  it("doesn't claim nothing was created when the row can't be removed", async () => {
    submitSigned.mockRejectedValue(new Error("The transaction failed on chain."));
    deleteError = { message: "connection lost" };

    const result = await actions.createRegisteredProject({}, form());

    expect(result.ok).toBe(true);
    expect(result.id).toBe(PROJECT);
    expect(result.error).toContain("The transaction failed on chain.");
    expect(result.error).not.toContain("Nothing was created");
  });

  it("keeps the project when the registration is still confirming", async () => {
    submitSigned.mockResolvedValue({
      status: "pending",
      txHash: TX,
      ledger: null,
      signer: OWNER_WALLET,
      attempts: 3,
    });

    await expect(actions.createRegisteredProject({}, form())).resolves.toEqual({
      ok: true,
      id: PROJECT,
      pending: true,
      txHash: TX,
    });
    expect(writes).toEqual([]);
  });

  it("reports a registration the row couldn't record as a warning, not a failure", async () => {
    updateError = { message: "check constraint" };

    const result = await actions.createRegisteredProject({}, form());

    expect(result).toEqual({
      ok: true,
      id: PROJECT,
      error: "Registered on chain, but qdit could not record it: check constraint",
    });
  });

  it("refuses when anchoring is not configured", async () => {
    delete process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID;
    const result = await actions.createRegisteredProject({}, form());
    expect(result.error).toMatch(/not configured/);
    expect(createProjectWithId).not.toHaveBeenCalled();
  });
});
