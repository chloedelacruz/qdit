#!/usr/bin/env node
// qdit-batch: build a Merkle batch of milestone proofs, anchor its root in one
// transaction, and write a portable inclusion-proof file per milestone.
// The scheme is docs/merkle/SPEC.md.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { Keypair } from "@stellar/stellar-sdk";
import { checkProofFile, equal, fromHex, parseProofFile, toHex } from "@qdit/merkle";

import { buildTree, checkId, parseInput, writeBatch } from "./batch.ts";
import { Client, TESTNET, sc, toBatchRecord, type Network } from "./soroban.ts";

const USAGE = `qdit-batch: Merkle batch anchoring for milestone_proof_v2

Usage:
  qdit-batch build  --input <file> --batch-id <id> [--out <dir>] [--contract <C...>]
  qdit-batch anchor --input <file> --batch-id <id> --contract <C...> [--out <dir>]
  qdit-batch verify <proof.json>... [--contract <C...>] [--offline]

  build    Build the tree and write batch.json and proofs/ without anchoring.
  anchor   Build, anchor the root with one anchor_batch transaction, read the
           stored batch back, and write the files with the anchor recorded.
           Signs with the key in QDIT_SECRET_KEY, which must hold the Submitter
           role in the project.
  verify   Check each proof file against the root stored on chain (get_batch)
           and with the contract's own verify_inclusion. --offline checks only
           that the file agrees with itself.

Options:
  --input <file>        { "project_id": "...", "milestones": [ { "milestone_id": "...", "proof_hash": "<64 hex>" } ] }
  --batch-id <id>       Unique per project, at most 64 bytes.
  --out <dir>           Output directory (default: ./batch-<batch-id>).
  --contract <C...>     milestone_proof_v2 contract id. verify defaults to the file's.
  --network <name>      testnet (default), or any name with --rpc-url and --passphrase.
  --rpc-url <url>       Soroban RPC endpoint.
  --passphrase <text>   Network passphrase.
  -h, --help            This text.
`;

function network(values: Record<string, unknown>): Network {
  const name = (values.network as string | undefined) ?? "testnet";
  const rpcUrl = values["rpc-url"] as string | undefined;
  const passphrase = values.passphrase as string | undefined;
  if (name === "testnet") {
    return { ...TESTNET, ...(rpcUrl ? { rpcUrl } : {}) };
  }
  if (!rpcUrl || !passphrase) throw new Error(`--network ${name} needs --rpc-url and --passphrase`);
  return { name, rpcUrl, passphrase };
}

function signer(): Keypair {
  const secret = process.env.QDIT_SECRET_KEY;
  if (!secret) throw new Error("set QDIT_SECRET_KEY to the submitter's secret key (S...); it is never read from a flag");
  return Keypair.fromSecret(secret.trim());
}

function required(values: Record<string, unknown>, key: string): string {
  const v = values[key];
  if (typeof v !== "string" || v === "") throw new Error(`--${key} is required`);
  return v;
}

async function cmdBuild(values: Record<string, unknown>): Promise<void> {
  const input = parseInput(readFileSync(required(values, "input"), "utf8"));
  const batchId = required(values, "batch-id");
  checkId("batch id", batchId);
  const tree = buildTree(input);
  const out = (values.out as string | undefined) ?? `batch-${batchId}`;
  writeBatch(out, tree, {
    network: network(values).name,
    contractId: (values.contract as string | undefined) ?? "",
    batchId,
  });
  console.log(`root        ${toHex(tree.root)}`);
  console.log(`leaves      ${tree.leafCount}`);
  console.log(`wrote       ${out}/batch.json and ${tree.leafCount} proof files (not anchored)`);
}

async function cmdAnchor(values: Record<string, unknown>): Promise<void> {
  const input = parseInput(readFileSync(required(values, "input"), "utf8"));
  const batchId = required(values, "batch-id");
  checkId("batch id", batchId);
  const net = network(values);
  const client = new Client(net, required(values, "contract"));
  const key = signer();
  const tree = buildTree(input);

  console.log(`root        ${toHex(tree.root)} (${tree.leafCount} leaves)`);
  console.log(`anchoring   ${batchId} on ${net.name} as ${key.publicKey()}`);
  const sent = await client.invoke(key, "anchor_batch", [
    sc.string(input.project_id),
    sc.string(batchId),
    sc.address(key.publicKey()),
    sc.bytes(tree.root),
    sc.u32(tree.leafCount),
  ]);

  // Read back what the chain stored, rather than trusting what was sent.
  const stored = toBatchRecord(
    (await client.read("get_batch", [sc.string(input.project_id), sc.string(batchId)])).value,
  );
  if (!equal(stored.root, tree.root) || stored.leafCount !== tree.leafCount) {
    throw new Error("the stored batch does not match the tree that was sent");
  }

  const out = (values.out as string | undefined) ?? `batch-${batchId}`;
  writeBatch(out, tree, {
    network: net.name,
    contractId: client.contractId,
    batchId,
    anchor: { tx_hash: sent.txHash, ledger: stored.ledger, timestamp: stored.timestamp },
    submitter: key.publicKey(),
    feeCharged: sent.feeCharged,
  });

  console.log(`tx          ${sent.txHash}`);
  console.log(`ledger      ${stored.ledger} at ${new Date(stored.timestamp * 1000).toISOString()}`);
  console.log(`fee         ${sent.feeCharged} stroops`);
  console.log(`wrote       ${out}/batch.json and ${tree.leafCount} proof files`);
}

async function cmdVerify(values: Record<string, unknown>, files: string[]): Promise<boolean> {
  if (files.length === 0) throw new Error("name at least one proof file");
  const offline = values.offline === true;
  const net = network(values);
  let allOk = true;

  for (const path of files) {
    const file = parseProofFile(readFileSync(path, "utf8"));
    const label = `${file.batch_id}/${file.milestone_id}`;

    if (offline) {
      const self = checkProofFile(file);
      const ok = self.leafMatches && self.pathValid;
      allOk &&= ok;
      console.log(`${ok ? "consistent" : "BROKEN    "}  ${label}  (offline: the root is not checked against the chain)`);
      continue;
    }

    const contractId = (values.contract as string | undefined) ?? file.contract_id;
    if (!contractId) throw new Error(`${path}: no contract id in the file; pass --contract`);
    const client = new Client(net, contractId);

    const stored = toBatchRecord(
      (await client.read("get_batch", [sc.string(file.project_id), sc.string(file.batch_id)])).value,
    );
    const local = checkProofFile(file, { root: stored.root, leafCount: stored.leafCount });
    const onChain = (
      await client.read("verify_inclusion", [
        sc.string(file.project_id),
        sc.string(file.batch_id),
        sc.string(file.milestone_id),
        sc.bytes(fromHex(file.proof_hash, 32)),
        sc.u32(file.index),
        sc.vec(file.path.map((h) => sc.bytes(fromHex(h, 32)))),
      ])
    ).value;

    const ok = local.leafMatches && local.pathValid && onChain === true;
    allOk &&= ok;
    console.log(
      `${ok ? "included" : "NOT OK  "}  ${label}  root ${toHex(stored.root).slice(0, 16)}…  ` +
        `ledger ${stored.ledger}  local ${local.pathValid}  contract ${onChain}`,
    );
  }
  return allOk;
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      input: { type: "string" },
      "batch-id": { type: "string" },
      out: { type: "string" },
      contract: { type: "string" },
      network: { type: "string" },
      "rpc-url": { type: "string" },
      passphrase: { type: "string" },
      offline: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 2;
  }
  switch (command) {
    case "build":
      await cmdBuild(values);
      return 0;
    case "anchor":
      await cmdAnchor(values);
      return 0;
    case "verify":
      return (await cmdVerify(values, rest)) ? 0 : 1;
    default:
      console.error(`unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`qdit-batch: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
