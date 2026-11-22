import assert from "node:assert/strict";
import { test } from "node:test";
import { compareWithContract, foldEvents, replay, type EventRpcLike } from "../src/index.ts";
import { decodeEvent } from "../src/replay.ts";
import { xdr } from "@stellar/stellar-sdk";
import { CONTRACT_ID, FakeChain, addr } from "./fake-rpc.ts";

const OWNER = addr(1);
const SUB = addr(2);
const A1 = addr(3);
const A2 = addr(4);
const A3 = addr(5);
const NEW_OWNER = addr(6);
const h = (n: number) => new Uint8Array(32).fill(n);
const hex = (n: number) => Buffer.from(h(n)).toString("hex");

/** A 2-of-3 project with a removal, a rejection and a resubmission, plus a batch. */
function story(): FakeChain {
  const c = new FakeChain();
  c.create("p1", OWNER, 1);
  c.addMember("p1", SUB, "Submitter");
  c.addMember("p1", A1, "Approver");
  c.addMember("p1", A2, "Approver");
  c.addMember("p1", A3, "Approver");
  c.setThreshold("p1", 2);
  c.submit("p1", "m1", SUB, h(1));
  c.approve("p1", "m1", A1);
  c.approve("p1", "m1", A2); // reaches 2 of 3
  c.submit("p1", "m2", SUB, h(2));
  c.approve("p1", "m2", A1);
  c.reject("p1", "m2", A3);
  c.submit("p1", "m2", SUB, h(22)); // version 2, approvals cleared
  c.approve("p1", "m2", A2);
  c.removeMember("p1", A3);
  c.addMember("p1", A1, "Submitter"); // a role change
  c.transfer("p1", NEW_OWNER);
  c.anchorBatch("p1", "b1", SUB, h(9), 120);
  return c;
}

test("fold: roster changes, threshold, approval, rejection and resubmission reset", () => {
  const c = story();
  const projects = foldEvents(c.events.map(decodeEvent));
  assert.deepEqual(projects, {
    p1: {
      complete: true,
      owner: NEW_OWNER,
      threshold: 2,
      createdLedger: 1001,
      members: Object.fromEntries(
        [
          [SUB, "Submitter"],
          [A1, "Submitter"],
          [A2, "Approver"],
        ].sort(([a], [b]) => (a! < b! ? -1 : 1)),
      ),
      milestones: {
        m1: {
          status: "Approved",
          version: 1,
          proofHash: hex(1),
          submitter: SUB,
          timestamp: c.milestones.get("p1/m1")!.timestamp,
          approvers: [A1, A2],
        },
        m2: {
          status: "Submitted",
          version: 2,
          proofHash: hex(22),
          submitter: SUB,
          timestamp: c.milestones.get("p1/m2")!.timestamp,
          approvers: [A2],
        },
      },
      batches: {
        b1: {
          root: hex(9),
          leafCount: 120,
          submitter: SUB,
          ledger: c.batches.get("p1/b1")!.ledger,
          timestamp: c.batches.get("p1/b1")!.timestamp,
          txHash: c.events.at(-1)!.txHash,
        },
      },
    },
  });
});

test("fold: an approval whose submission was never seen marks the project partial", () => {
  const c = story();
  const tail = c.events.slice(8).map(decodeEvent); // from m1's second approval on
  const p = foldEvents(tail).p1!;
  assert.equal(p.complete, false);
  assert.equal(p.owner, NEW_OWNER);
  assert.deepEqual(p.milestones.m1, {
    status: "Approved",
    version: 1,
    proofHash: hex(1),
    submitter: null,
    timestamp: null,
    approvers: [A2],
  });
});

test("fold: an unknown qdit event refuses rather than guess", () => {
  const e = { id: "1", ledger: 1, txHash: "", topic: ["qdit", "burn", "p1"], value: {} };
  assert.throws(() => foldEvents([e]), /unknown qdit event "burn"/);
  assert.deepEqual(foldEvents([{ ...e, topic: ["other", "x", "p1"] }]), {});
});

test("replay pages through every event and matches the getters with zero diffs", async () => {
  const c = story();
  for (let i = 0; i < 7; i++) {
    c.create(`q${i}`, OWNER, 1);
    c.addMember(`q${i}`, SUB, "Submitter");
    c.submit(`q${i}`, "m", SUB, h(i + 30));
  }
  const server = c.rpc() as EventRpcLike;
  // Starts 100 ledgers before the first event, scans 3 ledgers a call, 2 events a page.
  c.oldestLedger = 900;
  const snap = await replay({ contractId: CONTRACT_ID, startLedger: 900, server, pageLimit: 2 });
  assert.equal(snap.complete, true);
  assert.deepEqual(snap.gaps, []);
  assert.equal(snap.eventCount, c.events.length);
  assert.equal(Object.keys(snap.projects).length, 8);
  assert.equal(snap.toLedger, c.ledger);

  const cmp = await compareWithContract(snap, { server });
  assert.deepEqual(cmp.diffs, []);
  assert.equal(cmp.ok, true);
  assert.deepEqual(cmp.checked, { projects: 8, members: 10, milestones: 9, batches: 1 });
});

test("replay says what the retention window cut off, and compare skips partial projects", async () => {
  const c = story();
  c.create("late", OWNER, 1);
  c.addMember("late", SUB, "Submitter");
  c.oldestLedger = 1009; // m1's last approval onward
  const server = c.rpc() as EventRpcLike;
  const snap = await replay({ contractId: CONTRACT_ID, startLedger: 1, server });
  assert.equal(snap.complete, false);
  assert.equal(snap.fromLedger, 1009);
  assert.match(snap.gaps[0]!, /events from ledger 1 to 1008 are outside the RPC's retention window/);
  assert.match(snap.gaps[1]!, /1 project\(s\) were created before ledger 1009 and are partial: p1/);
  assert.equal(snap.projects.late!.complete, true);

  const cmp = await compareWithContract(snap, { server });
  assert.deepEqual(cmp.skipped, ["p1"]);
  assert.equal(cmp.checked.projects, 1);
  assert.equal(cmp.ok, true);
  assert.equal(cmp.snapshotComplete, false);
});

test("compare reports a snapshot that disagrees with the contract", async () => {
  const c = story();
  const server = c.rpc() as EventRpcLike;
  const snap = await replay({ contractId: CONTRACT_ID, startLedger: 1, server });
  snap.projects.p1!.milestones.m2!.approvers = [A1, A2];
  snap.projects.p1!.threshold = 3;
  const cmp = await compareWithContract(snap, { server });
  assert.equal(cmp.ok, false);
  assert.deepEqual(cmp.diffs, [
    `p1/milestone/m2: approvers snapshot ${JSON.stringify([A1, A2])}, contract ${JSON.stringify([A2])}`,
    "p1: threshold snapshot 3, contract 2",
  ]);
});

test("replay: a full page that ends inside the last ledger doesn't drop the rest of it (review L-2)", async () => {
  const c = new FakeChain();
  c.create("p", OWNER, 1);
  // Six events in one ledger, the last one of the range.
  const ledger = c.ledger + 1;
  for (const who of [SUB, A1, A2, A3, NEW_OWNER]) {
    c.addMember("p", who, "Approver");
    c.ledger = ledger - 1; // emit() bumps it back to `ledger`
  }
  c.ledger = ledger;
  const server = c.rpc() as EventRpcLike;
  const snap = await replay({ contractId: CONTRACT_ID, startLedger: 1001, endLedger: ledger, server, pageLimit: 2 });
  assert.equal(snap.eventCount, 6);
  assert.equal(Object.keys(snap.projects.p!.members).length, 5);
});

test("fold: ids like __proto__ are ordinary keys (review L-3)", () => {
  const c = new FakeChain();
  c.create("p", OWNER, 1);
  c.addMember("p", SUB, "Submitter");
  c.submit("p", "__proto__", SUB, h(1));
  c.anchorBatch("p", "constructor", SUB, h(2), 1);
  const p = foldEvents(c.events.map(decodeEvent)).p!;
  assert.deepEqual(Object.keys(p.milestones), ["__proto__"]);
  assert.equal(p.milestones["__proto__"]!.version, 1);
  assert.deepEqual(Object.keys(p.batches), ["constructor"]);
  assert.equal(({} as Record<string, unknown>).version, undefined);
});

test("replay: an id that isn't UTF-8 is reported, not replayed under a lossy name (review L-4)", async () => {
  const c = story();
  const bad = Buffer.from([0x6d, 0xff, 0x31]); // "m\xff1"
  c.submit("p1", "placeholder", SUB, h(5));
  const ev = c.events.at(-1)!;
  const data = ev.value.map()!;
  for (const e of data) if (e.key().sym().toString() === "milestone_id") e.val(xdr.ScVal.scvString(bad));
  const server = c.rpc() as EventRpcLike;
  c.milestones.delete("p1/placeholder");
  const snap = await replay({ contractId: CONTRACT_ID, startLedger: 1, server });
  assert.equal(snap.complete, false);
  assert.match(snap.gaps.join("\n"), /1 event\(s\) carry an id that is not valid UTF-8/);
  assert.equal(snap.projects.p1!.complete, false);
  assert.equal(Object.keys(snap.projects.p1!.milestones).length, 2);
});

test("cursorLedger reads the ledger out of a TOID cursor", async () => {
  const { cursorLedger } = await import("../src/replay.ts");
  assert.equal(cursorLedger("0024745350996688895-4294967295"), 5761475);
  assert.equal(cursorLedger("0024942992506777600-0000000000"), 5807493);
  assert.throws(() => cursorLedger("nope"), /unexpected getEvents cursor/);
});

test("replay refuses an unknown contract and a bad range", async () => {
  const c = story();
  const server = c.rpc() as EventRpcLike;
  await assert.rejects(replay({ contractId: addr(9), server }), /not a contract id/);
  await assert.rejects(replay({ contractId: CONTRACT_ID, startLedger: 50, endLedger: 10, server }), /before startLedger/);
  c.passphrase = "Public Global Stellar Network ; September 2015";
  await assert.rejects(replay({ contractId: CONTRACT_ID, server }), /testnet only/);
});
