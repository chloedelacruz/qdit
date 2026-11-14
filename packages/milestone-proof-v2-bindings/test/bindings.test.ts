// Checks the generated client against the deployment record and the contract's
// interface. Reads the build in dist/, because the generated source uses
// TypeScript that Node can't strip (a constructor parameter property).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Client, Errors, networks } from "../dist/index.js";

const deployments = readFileSync(
  new URL("../../../contracts/milestone_proof_v2/DEPLOYMENTS.md", import.meta.url),
  "utf8",
);

test("the embedded contract id is the one DEPLOYMENTS.md records as current", () => {
  const current = deployments.match(/\| Contract ID \| \[`(C[A-Z2-7]{55})`\]/);
  assert.ok(current, "no Contract ID row in DEPLOYMENTS.md");
  assert.equal(networks.testnet.contractId, current[1]);
  assert.equal(networks.testnet.networkPassphrase, "Test SDF Network ; September 2015");
});

test("the client exposes every contract function", () => {
  const client = new Client({
    contractId: networks.testnet.contractId,
    networkPassphrase: networks.testnet.networkPassphrase,
    rpcUrl: "https://soroban-testnet.stellar.org",
  });
  const names = client.spec.funcs().map((f) => f.name().toString()).sort();
  assert.deepEqual(names, [
    "add_member",
    "anchor_batch",
    "approve_milestone",
    "create_project",
    "get_batch",
    "get_members",
    "get_milestone_status",
    "get_project",
    "reject_milestone",
    "remove_member",
    "set_threshold",
    "submit_milestone_proof",
    "transfer_project_owner",
    "verify_inclusion",
  ]);
});

test("error codes match the contract's README", () => {
  const byName = Object.fromEntries(
    Object.entries(Errors).map(([code, e]) => [e.message, Number(code)]),
  );
  assert.deepEqual(byName, {
    ProjectExists: 1,
    ProjectNotFound: 2,
    MilestoneNotFound: 3,
    NotAuthorized: 4,
    InvalidStatus: 5,
    IdTooLong: 6,
    NotMember: 7,
    AlreadyApproved: 8,
    InvalidThreshold: 9,
    MemberLimit: 10,
    BatchExists: 11,
    ProofMismatch: 12,
    BatchNotFound: 13,
    InvalidBatch: 14,
  });
});
