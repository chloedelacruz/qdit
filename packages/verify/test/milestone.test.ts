import assert from "node:assert/strict";
import { test } from "node:test";
import { Networks, StrKey } from "@stellar/stellar-sdk";
import { toHex } from "@qdit/merkle";
import { VerifyError, verifyMilestone } from "../src/index.ts";
import { CLONE_ID, CONTRACT_ID, FakeChain, addr } from "./fake-rpc.ts";

const PROJECT = "817745fb-e68a-497b-bd7a-b7d3fc1e4556";
const HASH = new Uint8Array(32).fill(0xab);
const OWNER = addr(1);
const SUBMITTER = addr(2);
const APPROVER1 = addr(3);
const APPROVER2 = addr(4);

function chain(): FakeChain {
  const c = new FakeChain();
  c.projects.set(PROJECT, { owner: OWNER, threshold: 2 });
  c.milestones.set(`${PROJECT}/approved`, {
    status: "Approved",
    version: 1,
    proofHash: HASH,
    submitter: SUBMITTER,
    timestamp: 1763128500,
    approvers: [APPROVER1, APPROVER2],
  });
  c.milestones.set(`${PROJECT}/pending`, {
    status: "Submitted",
    version: 3,
    proofHash: HASH,
    submitter: SUBMITTER,
    timestamp: 1763128600,
    approvers: [APPROVER1],
  });
  c.milestones.set(`${PROJECT}/rejected`, {
    status: "Rejected",
    version: 1,
    proofHash: HASH,
    submitter: SUBMITTER,
    timestamp: 1763128700,
    approvers: [],
  });
  return c;
}

const input = (milestoneId: string, expected?: { proofHash?: string | Uint8Array; version?: number }) => ({
  contractId: CONTRACT_ID,
  projectId: PROJECT,
  milestoneId,
  ...(expected ? { expected } : {}),
});

test("an approved milestone verifies, with its record and the project's threshold", async () => {
  const c = chain();
  const r = await verifyMilestone(input("approved", { proofHash: toHex(HASH), version: 1 }), { server: c.rpc() });
  assert.deepEqual(r, {
    ok: true,
    network: "testnet",
    contractId: CONTRACT_ID,
    projectId: PROJECT,
    milestoneId: "approved",
    status: "Approved",
    version: 1,
    proofHash: toHex(HASH),
    submitter: SUBMITTER,
    submittedAt: 1763128500,
    approvers: [APPROVER1, APPROVER2],
    threshold: 2,
    owner: OWNER,
    reasons: [],
  });
});

test("the expected hash may be uppercase, 0x-prefixed or raw bytes", async () => {
  const c = chain();
  for (const proofHash of ["0x" + toHex(HASH).toUpperCase(), HASH]) {
    const r = await verifyMilestone(input("approved", { proofHash }), { server: c.rpc() });
    assert.equal(r.ok, true);
  }
});

test("a milestone submitted but below the threshold does not verify", async () => {
  const r = await verifyMilestone(input("pending"), { server: chain().rpc() });
  assert.equal(r.ok, false);
  assert.equal(r.status, "Submitted");
  assert.deepEqual(r.approvers, [APPROVER1]);
  assert.equal(r.threshold, 2);
  assert.deepEqual(r.reasons, ["status is Submitted, not Approved (1 of 2 approvals)"]);
});

test("a rejected milestone does not verify", async () => {
  const r = await verifyMilestone(input("rejected"), { server: chain().rpc() });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ["status is Rejected, not Approved"]);
});

test("a proof hash other than the expected one does not verify", async () => {
  const other = toHex(new Uint8Array(32).fill(0xcd));
  const r = await verifyMilestone(input("approved", { proofHash: other }), { server: chain().rpc() });
  assert.equal(r.ok, false);
  assert.equal(r.status, "Approved");
  assert.deepEqual(r.reasons, [`proof hash on chain is ${toHex(HASH)}, expected ${other}`]);
});

test("a version other than the expected one does not verify", async () => {
  const r = await verifyMilestone(input("approved", { version: 2 }), { server: chain().rpc() });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ["version on chain is 1, expected 2"]);
});

test("an unknown milestone does not verify and says so", async () => {
  const r = await verifyMilestone(input("nope"), { server: chain().rpc() });
  assert.equal(r.ok, false);
  assert.equal(r.status, null);
  assert.equal(r.threshold, 2);
  assert.deepEqual(r.reasons, ['milestone "nope": MilestoneNotFound']);
});

test("an unknown project does not verify and says so", async () => {
  const r = await verifyMilestone({ ...input("approved"), projectId: "ghost" }, { server: chain().rpc() });
  assert.equal(r.ok, false);
  assert.equal(r.threshold, null);
  assert.deepEqual(r.reasons, ['project "ghost": ProjectNotFound']);
});

test("an RPC on another network is refused before any contract read", async () => {
  const c = chain();
  c.passphrase = Networks.PUBLIC;
  await assert.rejects(verifyMilestone(input("approved"), { server: c.rpc() }), (e: unknown) => {
    assert.ok(e instanceof VerifyError);
    assert.equal(e.code, "WRONG_NETWORK");
    assert.match(e.message, /testnet only/);
    return true;
  });
  assert.deepEqual(c.calls, []);
});

test("a contract that isn't a known v2 build is refused", async () => {
  const c = chain();
  c.contracts.set(CONTRACT_ID, "00".repeat(32));
  await assert.rejects(verifyMilestone(input("approved"), { server: c.rpc() }), {
    name: "VerifyError",
    code: "WRONG_CONTRACT",
  });
  assert.deepEqual(c.calls, []);
});

test("a copy of the v2 WASM at another contract id is refused before any read", async () => {
  // Same code, so the WASM check alone would pass it. Anyone can deploy one.
  const c = chain();
  await assert.rejects(verifyMilestone({ ...input("approved"), contractId: CLONE_ID }, { server: c.rpc() }), {
    code: "WRONG_CONTRACT",
    message: /not a known qdit milestone_proof_v2 deployment/,
  });
  assert.deepEqual(c.calls, []);
});

test("trustedContracts lets a caller name another deployment of the v2 WASM", async () => {
  const c = chain();
  const r = await verifyMilestone(
    { ...input("approved"), contractId: CLONE_ID },
    { server: c.rpc(), trustedContracts: [CLONE_ID] },
  );
  assert.equal(r.ok, true);
  assert.equal(r.contractId, CLONE_ID);
});

test("a trusted contract id with nothing deployed is refused as WRONG_CONTRACT", async () => {
  // The SDK rejects a missing ledger entry with a plain { code: 404 } object.
  const missing = StrKey.encodeContract(Buffer.alloc(32, 9));
  await assert.rejects(
    verifyMilestone(
      { ...input("approved"), contractId: missing },
      { server: chain().rpc(), trustedContracts: [missing] },
    ),
    { code: "WRONG_CONTRACT", message: `no contract ${missing} on testnet` },
  );
});

test("malformed input is refused without touching the RPC", async () => {
  const c = chain();
  const server = c.rpc();
  await assert.rejects(verifyMilestone({ ...input("approved"), contractId: "C123" }, { server }), {
    code: "BAD_INPUT",
  });
  await assert.rejects(verifyMilestone(input("approved", { proofHash: "abcd" }), { server }), {
    code: "BAD_INPUT",
  });
  await assert.rejects(verifyMilestone(input("approved", { version: -1 }), { server }), { code: "BAD_INPUT" });
  await assert.rejects(verifyMilestone({ ...input("approved"), milestoneId: "" }, { server }), {
    code: "BAD_INPUT",
  });
  assert.deepEqual(c.calls, []);
});

test("an RPC failure is an RPC error, not a failed check", async () => {
  const c = chain();
  const server = { ...c.rpc(), simulateTransaction: async () => Promise.reject(new Error("ECONNRESET")) };
  await assert.rejects(verifyMilestone(input("approved"), { server }), { code: "RPC" });
});
