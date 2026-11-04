import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChainMethod } from "@/lib/chain/client";

/**
 * The anchor flow's server half (prepare → wallet signs → submit/reconcile).
 *
 * Stood in for: the RPC-facing half of `./client` (build, submit, reconcile;
 * tested in `client.test.ts` / `client.submit.test.ts`), the database (a fake
 * PostgREST builder) and the bindings' `get_milestone_status` read. Real: the
 * digest, the owner rules, and — for the call-shape tests — the generated
 * bindings' contract spec and the contract's Rust source, so a change to a
 * contract function's arguments fails here instead of on a live signing
 * prompt.
 */

const buildUnsigned = vi.fn();
const submitSigned = vi.fn();
const reconcileHash = vi.fn();
vi.mock("@/lib/chain/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chain/client")>()),
  buildUnsigned: (...args: unknown[]) => buildUnsigned(...args),
  submitSigned: (...args: unknown[]) => submitSigned(...args),
  reconcileHash: (...args: unknown[]) => reconcileHash(...args),
}));

const getMilestoneStatus = vi.fn();
const clientOptions: unknown[] = [];
vi.mock("@/lib/chain/bindings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/chain/bindings")>();
  class Client {
    constructor(options: unknown) {
      clientOptions.push(options);
    }
    get_milestone_status = (args: unknown) => getMilestoneStatus(args);
  }
  return { ...real, RealClient: real.Client, Client };
});

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

/* A PostgREST stand-in: every call is recorded and answered by `respond`. */
type Call = { table: string; op: "select" | "update" | "insert"; filters: [string, unknown][]; payload?: unknown };
type Answer = { data: unknown; error: unknown };
let respond: (call: Call) => Answer;
const calls: Call[] = [];
function from(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  const finish = () => {
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  const b = {
    select: () => b,
    update(payload: unknown) {
      call.op = "update";
      call.payload = payload;
      return b;
    },
    insert(payload: unknown) {
      call.op = "insert";
      call.payload = payload;
      return finish();
    },
    eq(column: string, value: unknown) {
      call.filters.push([column, value]);
      return b;
    },
    maybeSingle: finish,
    then: (resolve: (a: Answer) => unknown, reject?: (e: unknown) => unknown) => finish().then(resolve, reject),
  };
  return b;
}

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
  getUser: () => getUser(),
}));

const actions = await import("./actions");
const bindings = (await import("@/lib/chain/bindings")) as unknown as {
  RealClient: new (options: object) => {
    spec: {
      getFunc(name: string): { inputs(): { name(): { toString(): string } }[] };
      funcArgsToScVals(name: string, args: object): unknown[];
    };
  };
};
const { milestoneProofHash } = await import("@/lib/milestone-hash");
const { NETWORK_PASSPHRASE } = await import("@/lib/chain/client");

const CONTRACT = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";
const OWNER = { id: "owner-user" };
const OWNER_WALLET = Keypair.random().publicKey();
const MEMBER_WALLET = Keypair.random().publicKey();
const PROJECT = "11111111-1111-4111-8111-111111111111";
const MILESTONE = "22222222-2222-4222-8222-222222222222";

const MILESTONE_ROW = {
  id: MILESTONE,
  project_id: PROJECT,
  title: "Ship v1",
  description: "Everything",
  due_date: "2026-12-01",
};
const PROOF_ROW = {
  id: "p-1",
  contract_id: CONTRACT,
  tx_hash: "a".repeat(64),
  network: "testnet",
  wallet_address: MEMBER_WALLET,
  proof_url: null,
};

/** A database holding one registered project with one milestone and one proof. */
function world(project: Record<string, unknown> = {}) {
  const projects = {
    owner_id: OWNER.id,
    chain_contract_id: CONTRACT,
    chain_owner_address: OWNER_WALLET,
    ...project,
  };
  respond = (call) => {
    if (call.table === "milestones" && call.op === "select") {
      return { data: { ...MILESTONE_ROW, projects }, error: null };
    }
    if (call.table === "stellar_proofs") return { data: [PROOF_ROW], error: null };
    if (call.table === "projects" && call.op === "select") {
      return { data: { id: PROJECT, ...projects, chain_contract_id: project.chain_contract_id ?? null }, error: null };
    }
    return { data: null, error: null };
  };
}

const EXPECTED_HASH = () =>
  milestoneProofHash({
    id: MILESTONE,
    projectId: PROJECT,
    title: "Ship v1",
    description: "Everything",
    dueDate: "2026-12-01",
    proofs: [
      {
        id: "p-1",
        contractId: CONTRACT,
        txHash: "a".repeat(64),
        network: "testnet",
        walletAddress: MEMBER_WALLET,
        proofUrl: null,
      },
    ],
  });

beforeEach(() => {
  process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID = CONTRACT;
  process.env.NEXT_PUBLIC_STELLAR_NETWORK = "testnet";
  calls.length = 0;
  clientOptions.length = 0;
  getUser.mockResolvedValue(OWNER);
  buildUnsigned.mockResolvedValue({ xdr: "UNSIGNED", feeStroops: "12345" });
  getMilestoneStatus.mockResolvedValue({ result: { isOk: () => true, unwrap: () => ({ version: 3 }) } });
  world();
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID;
});

/* -------------------------------------------------------------------------- */
/* Call shape against the contract                                            */
/* -------------------------------------------------------------------------- */

/** Parameter names of a contract function, from the Rust source, `env` dropped. */
function rustParams(method: ChainMethod): string[] {
  const source = readFileSync(
    fileURLToPath(new URL("../../../../contracts/milestone_proof/src/lib.rs", import.meta.url)),
    "utf8",
  );
  const match = new RegExp(`pub fn ${method}\\s*\\(([^)]*)\\)`, "s").exec(source);
  if (!match) throw new Error(`contract has no function ${method}`);
  return match[1]
    .split(",")
    .map((part) => part.trim().split(":")[0]?.trim())
    .filter((name): name is string => Boolean(name) && name !== "env");
}

const spec = () =>
  new bindings.RealClient({
    contractId: CONTRACT,
    networkPassphrase: NETWORK_PASSPHRASE.testnet,
    rpcUrl: "https://soroban-testnet.stellar.org",
  }).spec;

/** What each prepare action handed to `buildUnsigned`, by method. */
async function preparedCalls(): Promise<Record<ChainMethod, Record<string, unknown>>> {
  const out = {} as Record<ChainMethod, Record<string, unknown>>;

  world({ chain_contract_id: null });
  await actions.prepareProjectRegistration(PROJECT, OWNER_WALLET);
  world();
  await actions.prepareMilestoneAnchor(MILESTONE, "submit", MEMBER_WALLET);
  await actions.prepareMilestoneAnchor(MILESTONE, "approve", OWNER_WALLET);
  await actions.prepareMilestoneAnchor(MILESTONE, "reject", OWNER_WALLET);

  for (const [request] of buildUnsigned.mock.calls as [{ method: ChainMethod; args: Record<string, unknown> }][]) {
    out[request.method] = request.args;
  }
  return out;
}

describe("the prepared invocations match milestone_proof", () => {
  const METHODS: ChainMethod[] = ["create_project_ref", "submit_milestone_proof", "approve_milestone", "reject_milestone"];

  it("prepares each of the four write methods exactly once", async () => {
    const prepared = await preparedCalls();
    expect(Object.keys(prepared).sort()).toEqual([...METHODS].sort());
  });

  it.each(METHODS)("%s: argument names and order equal the contract source and the bindings' spec", async (method) => {
    const args = (await preparedCalls())[method];
    const fromSpec = spec()
      .getFunc(method)
      .inputs()
      .map((input) => input.name().toString());

    expect(fromSpec).toEqual(rustParams(method));
    expect(Object.keys(args)).toEqual(fromSpec);
  });

  it.each(METHODS)("%s: every argument encodes to the contract's ScVal types", async (method) => {
    const args = (await preparedCalls())[method];
    const scVals = spec().funcArgsToScVals(method, args);
    expect(scVals).toHaveLength(Object.keys(args).length);
  });

  it("submit carries the milestone digest as 32 bytes, signed for by the submitter", async () => {
    const args = (await preparedCalls()).submit_milestone_proof;
    expect(args).toMatchObject({ project_id: PROJECT, milestone_id: MILESTONE, submitter: MEMBER_WALLET });
    expect(Buffer.isBuffer(args.proof_hash)).toBe(true);
    expect((args.proof_hash as Buffer).toString("hex")).toBe(EXPECTED_HASH());
    expect((args.proof_hash as Buffer).length).toBe(32);
  });

  it("registration names the signer as owner; approve and reject name it as approver", async () => {
    const prepared = await preparedCalls();
    expect(prepared.create_project_ref).toEqual({ project_id: PROJECT, owner: OWNER_WALLET });
    expect(prepared.approve_milestone).toEqual({ project_id: PROJECT, milestone_id: MILESTONE, approver: OWNER_WALLET });
    expect(prepared.reject_milestone).toEqual({ project_id: PROJECT, milestone_id: MILESTONE, approver: OWNER_WALLET });
  });
});

/* -------------------------------------------------------------------------- */
/* prepareProjectRegistration / submitProjectRegistration                      */
/* -------------------------------------------------------------------------- */

describe("prepareProjectRegistration", () => {
  beforeEach(() => world({ chain_contract_id: null }));

  it("returns the XDR, contract, network and simulated fee for the wallet prompt", async () => {
    await expect(actions.prepareProjectRegistration(PROJECT, OWNER_WALLET)).resolves.toEqual({
      ok: true,
      data: { xdr: "UNSIGNED", contractId: CONTRACT, network: "testnet", proofHash: null, feeStroops: "12345" },
    });
    expect(buildUnsigned.mock.calls[0][0]).toMatchObject({
      config: { contractId: CONTRACT, network: "testnet" },
      signer: OWNER_WALLET,
      method: "create_project_ref",
    });
  });

  it("refuses when anchoring is not configured", async () => {
    delete process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID;
    const result = await actions.prepareProjectRegistration(PROJECT, OWNER_WALLET);
    expect(result).toEqual({ ok: false, error: "On-chain anchoring is not configured for this deployment." });
  });

  it("refuses a signer that is not an account address", async () => {
    const result = await actions.prepareProjectRegistration(PROJECT, CONTRACT);
    expect(result).toMatchObject({ ok: false, error: "That is not a Stellar account address." });
  });

  it("refuses an expired session", async () => {
    getUser.mockResolvedValueOnce(null);
    expect((await actions.prepareProjectRegistration(PROJECT, OWNER_WALLET)).ok).toBe(false);
    expect(buildUnsigned).not.toHaveBeenCalled();
  });

  it("only the owner may register: the registering address is the only approver afterwards", async () => {
    getUser.mockResolvedValueOnce({ id: "someone-else" });
    const result = await actions.prepareProjectRegistration(PROJECT, OWNER_WALLET);
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toContain("Only the project owner");
    expect(buildUnsigned).not.toHaveBeenCalled();
  });

  it("refuses a project already registered, or gone", async () => {
    world({ chain_contract_id: CONTRACT });
    expect(await actions.prepareProjectRegistration(PROJECT, OWNER_WALLET)).toEqual({
      ok: false,
      error: "This project is already registered on chain.",
    });

    respond = () => ({ data: null, error: null });
    expect(await actions.prepareProjectRegistration(PROJECT, OWNER_WALLET)).toEqual({
      ok: false,
      error: "That project no longer exists.",
    });
  });

  it("translates contract errors from simulation", async () => {
    buildUnsigned.mockRejectedValueOnce(new Error("HostError: Error(Contract, #1) ProjectExists"));
    expect(await actions.prepareProjectRegistration(PROJECT, OWNER_WALLET)).toEqual({
      ok: false,
      error: "This project is already registered on chain.",
    });
  });
});

describe("submitProjectRegistration", () => {
  it("records the registration from the confirmed transaction's signer", async () => {
    submitSigned.mockResolvedValueOnce({ status: "confirmed", txHash: "tx-reg", signer: OWNER_WALLET, ledger: 7 });

    await expect(actions.submitProjectRegistration(PROJECT, "SIGNED")).resolves.toEqual({ ok: true });
    expect(submitSigned).toHaveBeenCalledWith("SIGNED", { contractId: CONTRACT, network: "testnet" }, "create_project_ref");

    const update = calls.find((c) => c.op === "update");
    expect(update?.table).toBe("projects");
    expect(update?.filters).toEqual([["id", PROJECT]]);
    expect(update?.payload).toMatchObject({
      chain_contract_id: CONTRACT,
      chain_network: "testnet",
      chain_owner_address: OWNER_WALLET,
      chain_registered_tx: "tx-reg",
    });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("pending: hands back the hash and writes nothing", async () => {
    submitSigned.mockResolvedValueOnce({ status: "pending", txHash: "tx-wait" });
    await expect(actions.submitProjectRegistration(PROJECT, "SIGNED")).resolves.toEqual({ pending: true, txHash: "tx-wait" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("a refused envelope or a failed write is reported", async () => {
    submitSigned.mockRejectedValueOnce(new Error("The signed transaction calls a different contract."));
    expect(await actions.submitProjectRegistration(PROJECT, "SIGNED")).toEqual({
      error: "The signed transaction calls a different contract.",
    });

    submitSigned.mockResolvedValueOnce({ status: "confirmed", txHash: "t", signer: OWNER_WALLET, ledger: 1 });
    respond = () => ({ data: null, error: { message: "check constraint" } });
    expect(await actions.submitProjectRegistration(PROJECT, "SIGNED")).toEqual({ error: "check constraint" });
  });

  it("refuses an expired session before submitting", async () => {
    getUser.mockResolvedValueOnce(null);
    expect(await actions.submitProjectRegistration(PROJECT, "SIGNED")).toEqual({
      error: "Your session expired. Sign in again.",
    });
    expect(submitSigned).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* prepareMilestoneAnchor                                                     */
/* -------------------------------------------------------------------------- */

describe("prepareMilestoneAnchor", () => {
  it("submit: any member may sign, and the digest is returned for the anchor row", async () => {
    getUser.mockResolvedValueOnce({ id: "member-user" });
    const result = await actions.prepareMilestoneAnchor(MILESTONE, "submit", MEMBER_WALLET);

    expect(result).toEqual({
      ok: true,
      data: { xdr: "UNSIGNED", contractId: CONTRACT, network: "testnet", proofHash: EXPECTED_HASH(), feeStroops: "12345" },
    });
  });

  it("approve and reject carry no proof hash", async () => {
    for (const action of ["approve", "reject"] as const) {
      const result = await actions.prepareMilestoneAnchor(MILESTONE, action, OWNER_WALLET);
      expect(result.ok && result.data.proofHash).toBeNull();
    }
  });

  it("approve and reject are owner-only in the app", async () => {
    getUser.mockResolvedValue({ id: "member-user" });
    for (const action of ["approve", "reject"] as const) {
      expect(await actions.prepareMilestoneAnchor(MILESTONE, action, OWNER_WALLET)).toEqual({
        ok: false,
        error: "Only the project owner can approve or reject a milestone.",
      });
    }
    expect(buildUnsigned).not.toHaveBeenCalled();
  });

  it("approve and reject must be signed by the registering address, named in the refusal", async () => {
    const result = await actions.prepareMilestoneAnchor(MILESTONE, "approve", MEMBER_WALLET);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(OWNER_WALLET);
    expect(buildUnsigned).not.toHaveBeenCalled();
  });

  it("refuses an unregistered project", async () => {
    world({ chain_contract_id: null });
    const result = await actions.prepareMilestoneAnchor(MILESTONE, "submit", MEMBER_WALLET);
    expect(!result.ok && result.error).toContain("Register this project on chain first");
  });

  it("refuses a project registered on another contract: it would split its history", async () => {
    world({ chain_contract_id: "CDIFFERENTCONTRACTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    const result = await actions.prepareMilestoneAnchor(MILESTONE, "submit", MEMBER_WALLET);
    expect(!result.ok && result.error).toContain("different contract");
  });

  it("reads the project embed whether PostgREST answers an object or an array", async () => {
    respond = (call) => {
      if (call.table === "milestones") {
        return {
          data: {
            ...MILESTONE_ROW,
            projects: [{ owner_id: OWNER.id, chain_contract_id: CONTRACT, chain_owner_address: OWNER_WALLET }],
          },
          error: null,
        };
      }
      if (call.table === "stellar_proofs") return { data: [PROOF_ROW], error: null };
      return { data: null, error: null };
    };
    expect((await actions.prepareMilestoneAnchor(MILESTONE, "approve", OWNER_WALLET)).ok).toBe(true);
  });

  it("refuses a milestone that no longer exists", async () => {
    respond = () => ({ data: null, error: null });
    expect(await actions.prepareMilestoneAnchor(MILESTONE, "submit", MEMBER_WALLET)).toEqual({
      ok: false,
      error: "That milestone no longer exists.",
    });
  });

  it.each([
    ["ProjectNotFound", "not registered on chain yet"],
    ["MilestoneNotFound", "submit one before approving it"],
    ["NotAuthorized", "not the one this project was registered with"],
    ["InvalidStatus", "an approved milestone is final"],
    ["IdTooLong", "too long for the contract"],
  ])("translates the contract's %s", async (code, sentence) => {
    buildUnsigned.mockRejectedValueOnce(new Error(`simulation failed: Error(Contract) ${code}`));
    const result = await actions.prepareMilestoneAnchor(MILESTONE, "approve", OWNER_WALLET);
    expect(!result.ok && result.error).toContain(sentence);
  });
});

/* -------------------------------------------------------------------------- */
/* submitMilestoneAnchor / reconcileMilestoneAnchor                           */
/* -------------------------------------------------------------------------- */

describe("submitMilestoneAnchor", () => {
  it("records the anchor with the version read back from the contract and the verified signer", async () => {
    submitSigned.mockResolvedValueOnce({ status: "confirmed", txHash: "tx-1", signer: MEMBER_WALLET, ledger: 55 });

    await expect(actions.submitMilestoneAnchor(MILESTONE, "submit", "SIGNED", "f".repeat(64))).resolves.toEqual({ ok: true });

    expect(submitSigned).toHaveBeenCalledWith("SIGNED", { contractId: CONTRACT, network: "testnet" }, "submit_milestone_proof");
    expect(getMilestoneStatus).toHaveBeenCalledWith({ project_id: PROJECT, milestone_id: MILESTONE });
    expect(clientOptions[0]).toMatchObject({ contractId: CONTRACT, networkPassphrase: NETWORK_PASSPHRASE.testnet, allowHttp: false });

    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe("milestone_anchors");
    expect(insert?.payload).toEqual({
      milestone_id: MILESTONE,
      project_id: PROJECT,
      action: "submit",
      proof_hash: "f".repeat(64),
      version: 3,
      contract_id: CONTRACT,
      network: "testnet",
      tx_hash: "tx-1",
      signer_address: MEMBER_WALLET,
      ledger: 55,
      created_by: OWNER.id,
    });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("uses each action's own contract method", async () => {
    submitSigned.mockResolvedValue({ status: "confirmed", txHash: "t", signer: OWNER_WALLET, ledger: 1 });
    await actions.submitMilestoneAnchor(MILESTONE, "approve", "S", null);
    await actions.submitMilestoneAnchor(MILESTONE, "reject", "S", null);
    expect(submitSigned.mock.calls.map((c) => c[2])).toEqual(["approve_milestone", "reject_milestone"]);
  });

  it("approve and reject never store a proof hash, whatever the caller sends", async () => {
    submitSigned.mockResolvedValueOnce({ status: "confirmed", txHash: "t", signer: OWNER_WALLET, ledger: 1 });
    await actions.submitMilestoneAnchor(MILESTONE, "approve", "S", "f".repeat(64));
    expect((calls.find((c) => c.op === "insert")?.payload as { proof_hash: unknown }).proof_hash).toBeNull();
  });

  it("never writes milestones.status: anchoring is additive", async () => {
    submitSigned.mockResolvedValueOnce({ status: "confirmed", txHash: "t", signer: OWNER_WALLET, ledger: 1 });
    await actions.submitMilestoneAnchor(MILESTONE, "approve", "S", null);
    expect(calls.filter((c) => c.table === "milestones" && c.op !== "select")).toEqual([]);
  });

  it("pending: returns the hash and records nothing", async () => {
    submitSigned.mockResolvedValueOnce({ status: "pending", txHash: "tx-wait" });
    await expect(actions.submitMilestoneAnchor(MILESTONE, "submit", "S", "f".repeat(64))).resolves.toEqual({
      pending: true,
      txHash: "tx-wait",
    });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("a record that cannot be read back is an error, not a guessed version", async () => {
    submitSigned.mockResolvedValueOnce({ status: "confirmed", txHash: "t", signer: OWNER_WALLET, ledger: 1 });
    getMilestoneStatus.mockResolvedValueOnce({ result: { isOk: () => false } });

    expect(await actions.submitMilestoneAnchor(MILESTONE, "submit", "S", "f".repeat(64))).toEqual({
      error: "The transaction succeeded but the record could not be read back.",
    });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("a duplicate tx_hash means it is already recorded: success", async () => {
    submitSigned.mockResolvedValueOnce({ status: "confirmed", txHash: "t", signer: OWNER_WALLET, ledger: 1 });
    respond = (call) =>
      call.op === "insert"
        ? { data: null, error: { code: "23505", message: "duplicate" } }
        : { data: { id: MILESTONE, project_id: PROJECT }, error: null };

    expect(await actions.submitMilestoneAnchor(MILESTONE, "submit", "S", "f".repeat(64))).toEqual({ ok: true });
  });

  it("another insert failure is reported", async () => {
    submitSigned.mockResolvedValueOnce({ status: "confirmed", txHash: "t", signer: OWNER_WALLET, ledger: 1 });
    respond = (call) =>
      call.op === "insert"
        ? { data: null, error: { code: "42501", message: "denied" } }
        : { data: { id: MILESTONE, project_id: PROJECT }, error: null };

    expect(await actions.submitMilestoneAnchor(MILESTONE, "submit", "S", "f".repeat(64))).toEqual({ error: "denied" });
  });

  it("refuses when unconfigured, signed out, or the milestone is gone", async () => {
    delete process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID;
    expect((await actions.submitMilestoneAnchor(MILESTONE, "submit", "S", null)).error).toContain("not configured");
    process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID = CONTRACT;

    getUser.mockResolvedValueOnce(null);
    expect((await actions.submitMilestoneAnchor(MILESTONE, "submit", "S", null)).error).toContain("session expired");

    respond = () => ({ data: null, error: null });
    expect(await actions.submitMilestoneAnchor(MILESTONE, "submit", "S", null)).toEqual({
      error: "That milestone no longer exists.",
    });
    expect(submitSigned).not.toHaveBeenCalled();
  });
});

describe("reconcileMilestoneAnchor", () => {
  it("records a transaction that has since confirmed, exactly as the live path would", async () => {
    reconcileHash.mockResolvedValueOnce({ status: "confirmed", ledger: 70, signer: MEMBER_WALLET });

    await expect(actions.reconcileMilestoneAnchor(MILESTONE, "submit", "tx-late", "f".repeat(64))).resolves.toEqual({ ok: true });
    expect(reconcileHash).toHaveBeenCalledWith("tx-late", { contractId: CONTRACT, network: "testnet" });
    expect(submitSigned).not.toHaveBeenCalled();
    expect(calls.find((c) => c.op === "insert")?.payload).toMatchObject({
      tx_hash: "tx-late",
      signer_address: MEMBER_WALLET,
      ledger: 70,
      version: 3,
    });
  });

  it("still pending: keeps waiting, not an error", async () => {
    reconcileHash.mockResolvedValueOnce({ status: "pending" });
    expect(await actions.reconcileMilestoneAnchor(MILESTONE, "submit", "tx-late", null)).toEqual({
      pending: true,
      txHash: "tx-late",
    });
  });

  it("failed on chain: says so and records nothing", async () => {
    reconcileHash.mockResolvedValueOnce({ status: "failed" });
    expect(await actions.reconcileMilestoneAnchor(MILESTONE, "submit", "tx-late", null)).toEqual({
      error: "That transaction failed on chain. Nothing was recorded.",
    });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("an RPC error is reported", async () => {
    reconcileHash.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await actions.reconcileMilestoneAnchor(MILESTONE, "submit", "tx-late", null)).toEqual({ error: "fetch failed" });
  });
});
