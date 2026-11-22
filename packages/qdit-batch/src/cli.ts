#!/usr/bin/env node
// qdit-batch: build a Merkle batch of milestone proofs, anchor its root in one
// transaction, and write a portable inclusion-proof file per milestone.
// The scheme is docs/merkle/SPEC.md.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { Keypair } from "@stellar/stellar-sdk";
import {
  checkProofFile,
  equal,
  extractCertificateProof,
  fromHex,
  looksLikeHtml,
  parseProofFile,
  toHex,
  type InclusionProofFile,
} from "@qdit/merkle";

import { buildTree, checkId, parseInput, writeBatch } from "./batch.ts";
import { writeCertificates, writeCertificatesForFiles } from "./certificate.ts";
import { CURRENT_CONTRACT, Client, TESTNET, sc, toBatchRecord, type Network } from "./soroban.ts";

const USAGE = `qdit-batch: Merkle batch anchoring for milestone_proof_v2

Usage:
  qdit-batch build  --input <file> --batch-id <id> [--out <dir>] [--contract <C...>]
  qdit-batch anchor --input <file> --batch-id <id> --contract <C...> [--out <dir>]
  qdit-batch certificates <batch-dir | proof.json...> [--out <dir>]
  qdit-batch verify <proof.json | certificate.html>... [--contract <C...>] [--offline]

  build    Build the tree and write batch.json and proofs/ without anchoring.
  anchor   Build, anchor the root with one anchor_batch transaction, read the
           stored batch back, and write the files with the anchor recorded.
           Signs with the key in QDIT_SECRET_KEY, which must hold the Submitter
           role in the project.
  certificates
           Write one self-contained HTML certificate per milestone of an
           anchored batch (default <batch-dir>/certificates/), or for each
           named proof file (default ./certificates/). Each carries its
           proof file, so verify reads a certificate like a proof file.
  verify   Check each proof file (or certificate) against the root stored on
           chain (get_batch) and with the contract's own verify_inclusion.
           --offline checks only that the file agrees with itself.

Options:
  --input <file>        { "project_id": "...", "milestones": [ { "milestone_id": "...", "version": 1, "proof_hash": "<64 hex>" } ] }
  --batch-id <id>       Unique per project, at most 64 bytes.
  --out <dir>           Output directory (default: ./batch-<batch-id>, or
                        <batch-dir>/certificates or ./certificates for
                        certificates).
  --contract <C...>     milestone_proof_v2 contract id. verify defaults to the
                        current deployment and refuses a file naming another.
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
  // Print it before anything else can fail: the batch id is now spent, and a
  // re-run would be refused with BatchExists.
  console.log(`tx          ${sent.txHash}`);

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
    const file = readProofOrCertificate(path);
    const label = `${file.batch_id}/${file.milestone_id}`;

    if (offline) {
      const self = checkProofFile(file);
      const ok = self.leafMatches && self.pathValid;
      allOk &&= ok;
      console.log(`${ok ? "consistent" : "BROKEN    "}  ${label}  (offline: the root is not checked against the chain)`);
      continue;
    }

    // The root is only as good as the contract it is read from, so the file
    // doesn't get to choose it: anyone can deploy the same WASM and anchor any
    // root there. Check against --contract, or the current deployment.
    const contractId = (values.contract as string | undefined) ?? CURRENT_CONTRACT;
    if (file.contract_id !== contractId) {
      throw new Error(
        `${path}: the file names contract ${file.contract_id || "(none)"}, not ${contractId}; ` +
          "pass --contract to check against another deployment you trust",
      );
    }
    if (file.network !== net.name) {
      throw new Error(`${path}: the file is for ${file.network}, but this checks ${net.name}`);
    }
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
        sc.u32(file.version),
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

function cmdCertificates(values: Record<string, unknown>, paths: string[]): void {
  if (paths.length === 0) throw new Error("name a batch directory, as qdit-batch anchor wrote it, or proof files");
  const isDir = paths.length === 1 && statSync(paths[0]!).isDirectory();
  const out = (values.out as string | undefined) ?? (isDir ? join(paths[0]!, "certificates") : "certificates");
  const written = isDir
    ? writeCertificates(paths[0]!, out, new Date())
    : writeCertificatesForFiles(paths, out, new Date());
  console.log(`wrote       ${written.length} certificates to ${out}`);
}

/** A proof file, or the proof file a certificate carries. */
function readProofOrCertificate(path: string): InclusionProofFile {
  const text = readFileSync(path, "utf8");
  return looksLikeHtml(text) ? extractCertificateProof(text) : parseProofFile(text);
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
    case "certificates":
      cmdCertificates(values, rest);
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
