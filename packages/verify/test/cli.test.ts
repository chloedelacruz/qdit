// The CLI as a user runs it: a child process, JSON on stdout, an exit code.
// RPC answers come from FakeChain over HTTP, so no network is needed.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { MerkleTree, proofFiles } from "@qdit/merkle";
import { CONTRACT_ID, FakeChain, addr } from "./fake-rpc.ts";
import { serve } from "./fake-rpc-server.ts";

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;
const SUB = addr(2);
const A1 = addr(3);
const A2 = addr(4);
const h = (n: number) => new Uint8Array(32).fill(n);
const hex = (n: number) => Buffer.from(h(n)).toString("hex");

const chain = new FakeChain();
chain.create("p1", addr(1), 1);
chain.addMember("p1", SUB, "Submitter");
chain.addMember("p1", A1, "Approver");
chain.addMember("p1", A2, "Approver");
chain.setThreshold("p1", 2);
chain.submit("p1", "done", SUB, h(1));
chain.approve("p1", "done", A1);
chain.approve("p1", "done", A2);
chain.submit("p1", "half", SUB, h(2));
chain.approve("p1", "half", A1);
const tree = MerkleTree.build("p1", [0, 1, 2].map((i) => ({ milestoneId: `b${i}`, version: 1, proofHash: h(10 + i) })));
chain.anchorBatch("p1", "batch-1", SUB, tree.root, 3);
const files = proofFiles(tree, {
  network: "testnet",
  contractId: CONTRACT_ID,
  batchId: "batch-1",
  anchor: { tx_hash: "ab".repeat(32), ledger: chain.batches.get("p1/batch-1")!.ledger, timestamp: chain.batches.get("p1/batch-1")!.timestamp },
});
chain.oldestLedger = 1;

let rpcUrl = "";
let close: () => Promise<void>;
let dir = "";
before(async () => {
  ({ url: rpcUrl, close } = await serve(chain));
  dir = mkdtempSync(join(tmpdir(), "qdit-verify-cli-"));
});
after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

function cli(...args: string[]): Promise<{ code: number; json: any; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { timeout: 30_000 }, (err, stdout, stderr) => {
      const code = err ? ((err as { code?: number }).code ?? -1) : 0;
      let json: unknown = undefined;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = { unparsed: stdout };
      }
      resolve({ code, json, stderr });
    });
  });
}

const rpcArgs = () => ["--rpc-url", rpcUrl];

test("milestone: a 2-of-2 approved milestone passes with exit 0", async () => {
  const r = await cli("milestone", "--project", "p1", "--milestone", "done", "--hash", hex(1), ...rpcArgs());
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.status, "Approved");
  assert.deepEqual(r.json.approvers, [A1, A2]);
});

test("milestone: below threshold or at the wrong hash fails with exit 1", async () => {
  const half = await cli("milestone", "--project", "p1", "--milestone", "half", ...rpcArgs());
  assert.equal(half.code, 1);
  assert.equal(half.json.ok, false);
  assert.match(half.json.reasons[0], /status is Submitted, not Approved \(1 of 2 approvals\)/);
  const wrong = await cli("milestone", "--project", "p1", "--milestone", "done", "--hash", hex(9), ...rpcArgs());
  assert.equal(wrong.code, 1);
  assert.match(wrong.json.reasons[0], /proof hash on chain/);
});

test("proof: a valid file verifies on chain by default; offline it is only consistent (exit 1)", async () => {
  const path = join(dir, "proof.json");
  writeFileSync(path, JSON.stringify(files[1]));
  const on = await cli("proof", path, ...rpcArgs());
  assert.equal(on.code, 0, on.stderr);
  assert.equal(on.json.rootConfirmed, true);
  assert.equal(on.json.batch.contractSays, true);
  assert.equal(on.json.projectOwner, addr(1));
  // A forged file that agrees with itself passes this too, so it never exits 0.
  const off = await cli("proof", path, "--offline");
  assert.equal(off.code, 1, off.stderr);
  assert.equal(off.json.ok, true);
  assert.equal(off.json.rootConfirmed, false);
  assert.equal((await cli("proof", path, "--offline", "--on-chain")).code, 2);

  const cert = readFileSync(
    new URL("../../../docs/evidence/qdit-batch-2026-11-19/certificates/00119-week3-sample-119.html", import.meta.url),
    "utf8",
  );
  const certPath = join(dir, "cert.html");
  writeFileSync(certPath, cert);
  const fromCert = await cli("proof", certPath, "--offline");
  assert.equal(fromCert.code, 1, fromCert.stderr);
  assert.equal(fromCert.json.ok, true);
  assert.equal(fromCert.json.milestoneId, "week3-sample-119");
});

test("proof: a tampered file fails with exit 1, a file naming another contract with exit 2", async () => {
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ ...files[1], proof_hash: "00".repeat(32) }));
  const off = await cli("proof", bad, "--offline");
  assert.equal(off.code, 1);
  assert.equal(off.json.leafMatches, false);
  const on = await cli("proof", bad, ...rpcArgs());
  assert.equal(on.code, 1);
  assert.equal(on.json.batch.contractSays, false);

  const other = join(dir, "other.json");
  writeFileSync(other, JSON.stringify({ ...files[1], contract_id: "CCLOK4SW" }));
  const wrong = await cli("proof", other, ...rpcArgs());
  assert.equal(wrong.code, 2);
  assert.equal(wrong.json.error.code, "WRONG_CONTRACT");
});

test("replay: --compare matches the getters with exit 0 and --out writes the snapshot", async () => {
  const out = join(dir, "snap.json");
  const r = await cli("replay", "--from-ledger", "1", "--compare", "--out", out, ...rpcArgs());
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.complete, true);
  assert.deepEqual(r.json.comparison.checked, { projects: 1, members: 3, milestones: 2, batches: 1 });
  const snap = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(snap.format, "qdit-replay/v1");
  assert.deepEqual(snap.projects.p1.milestones.done.approvers, [A1, A2]);
});

test("replay: a window that cut off events is reported incomplete, and diffs fail with exit 1", async () => {
  chain.oldestLedger = 1005;
  try {
    const r = await cli("replay", "--from-ledger", "1", ...rpcArgs());
    assert.equal(r.code, 0);
    assert.equal(r.json.complete, false);
    assert.match(r.json.gaps[0], /outside the RPC's retention window/);
    assert.match(r.stderr, /snapshot is incomplete/);
    // --compare passes only on a complete snapshot, unless gaps are accepted.
    const strict = await cli("replay", "--from-ledger", "1", "--compare", ...rpcArgs());
    assert.equal(strict.code, 1);
    assert.equal(strict.json.ok, false);
    assert.equal(strict.json.comparison.ok, true);
    const lenient = await cli("replay", "--from-ledger", "1", "--compare", "--allow-incomplete", ...rpcArgs());
    assert.equal(lenient.code, 0);
    assert.equal(lenient.json.ok, true);
  } finally {
    chain.oldestLedger = 1;
  }
  // The contract changes after the replay's end ledger: compare sees the difference.
  const before = chain.ledger;
  chain.approve("p1", "half", A2);
  try {
    const r = await cli("replay", "--from-ledger", "1", "--to-ledger", String(before), "--compare", ...rpcArgs());
    assert.equal(r.code, 1);
    assert.equal(r.json.ok, false);
    assert.match(r.json.comparison.diffs.join("\n"), /p1\/milestone\/half: approvers/);
  } finally {
    // Leave the chain as other tests expect it.
    const m = chain.milestones.get("p1/half")!;
    m.approvers.pop();
    m.status = "Submitted";
    chain.events.pop();
    chain.ledger--;
  }
});

test("usage errors exit 2 with JSON, network errors exit 3", async () => {
  const none = await cli();
  assert.equal(none.code, 2);
  assert.equal(none.json.error.code, "USAGE");
  assert.equal((await cli("milestone", "--project", "p1")).code, 2);
  assert.equal((await cli("frobnicate")).code, 2);
  assert.equal((await cli("replay", "--from-ledger", "abc")).code, 2);
  const net = await cli("milestone", "--project", "p1", "--milestone", "done", "--network", "public");
  assert.equal(net.code, 2);
  assert.match(net.json.error.message, /testnet only/);
  const down = await cli("milestone", "--project", "p1", "--milestone", "done", "--rpc-url", "http://127.0.0.1:9");
  assert.equal(down.code, 3);
  assert.equal(down.json.error.code, "RPC");
});
