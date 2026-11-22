#!/usr/bin/env node
// npx @qdit/verify milestone | proof | replay
//
// JSON on stdout, always: the result, or { "ok": false, "error": { code, message } }.
// Exit codes: 0 verified, 1 not verified, 2 usage error, 3 network or RPC error.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { extractCertificateProof, looksLikeHtml } from "@qdit/merkle";

import { NETWORK, VerifyError } from "./chain.ts";
import { verifyInclusion } from "./inclusion.ts";
import { verifyMilestone } from "./milestone.ts";
import { compareWithContract, replay } from "./replay.ts";

/** The current qdit milestone_proof_v2 deployment on testnet. */
const DEFAULT_CONTRACT = "CAIBMWYDR37HTGITV64BNHWMCFY5Z2UNGA7LTE2JAEKL4PTHGJ7BBFNB";

export const EXIT = { VERIFIED: 0, NOT_VERIFIED: 1, USAGE: 2, NETWORK: 3 } as const;

const USAGE = `@qdit/verify: check qdit records on Stellar testnet without trusting qdit

Usage:
  qdit-verify milestone --project <id> --milestone <id> [--hash <64 hex>] [--version <n>]
  qdit-verify proof <proof.json | certificate.html> [--on-chain]
  qdit-verify replay [--from-ledger <n>] [--to-ledger <n>] [--out <file>] [--compare]

  milestone  Is the milestone Approved on chain (and at this proof hash / version)?
  proof      Does a qdit-batch inclusion-proof file, or a certificate carrying one,
             prove its milestone is in a batch? Offline it checks only that the
             file agrees with itself; --on-chain checks it against the root the
             contract stored and asks the contract's own verify_inclusion.
  replay     Rebuild every project's state from the contract's events and print
             (or --out) the snapshot. --compare also checks it against the
             contract's getters. "complete": false means some events were past
             the RPC's retention window; "gaps" says which.

Options:
  --contract <C...>   milestone_proof_v2 contract (default: ${DEFAULT_CONTRACT})
  --network testnet   The only network v0.1 checks; any other is refused.
  --rpc-url <url>     Soroban RPC endpoint (default: the public testnet RPC).
  -h, --help          This text.

Output is JSON on stdout. Exit codes: 0 verified, 1 not verified, 2 usage
error, 3 network or RPC error.
`;

class UsageError extends Error {}

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function int(values: Record<string, unknown>, key: string): number | undefined {
  const v = values[key];
  if (v === undefined) return undefined;
  const n = Number(v);
  if (typeof v !== "string" || !/^\d+$/.test(v) || !Number.isSafeInteger(n)) {
    throw new UsageError(`--${key} must be a whole number`);
  }
  return n;
}

function str(values: Record<string, unknown>, key: string, required = false): string | undefined {
  const v = values[key];
  if (v === undefined || v === "") {
    if (required) throw new UsageError(`--${key} is required`);
    return undefined;
  }
  return v as string;
}

export async function run(argv: string[]): Promise<number> {
  let values: Record<string, unknown>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        contract: { type: "string" },
        network: { type: "string" },
        "rpc-url": { type: "string" },
        project: { type: "string" },
        milestone: { type: "string" },
        hash: { type: "string" },
        version: { type: "string" },
        "on-chain": { type: "boolean" },
        "from-ledger": { type: "string" },
        "to-ledger": { type: "string" },
        out: { type: "string" },
        compare: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (e) {
    return fail(new UsageError(e instanceof Error ? e.message : String(e)));
  }

  const [command, ...rest] = positionals;
  if (values.help) {
    process.stderr.write(USAGE);
    return EXIT.VERIFIED;
  }

  try {
    const network = str(values, "network") ?? NETWORK;
    if (network !== NETWORK) {
      throw new UsageError(`--network ${network}: @qdit/verify v0.1 checks Stellar testnet only`);
    }
    const contractId = str(values, "contract") ?? DEFAULT_CONTRACT;
    const rpcUrl = str(values, "rpc-url");
    // A contract named on the command line is one the caller trusts; it must
    // still run a known milestone_proof_v2 build.
    const chain = {
      ...(rpcUrl ? { rpcUrl } : {}),
      ...(values.contract !== undefined ? { trustedContracts: [contractId] } : {}),
    };

    switch (command) {
      case "milestone": {
        if (rest.length) throw new UsageError(`milestone takes no positional arguments, got ${rest.join(" ")}`);
        const version = int(values, "version");
        const proofHash = str(values, "hash");
        const r = await verifyMilestone({
          contractId,
          projectId: str(values, "project", true)!,
          milestoneId: str(values, "milestone", true)!,
          ...(proofHash !== undefined || version !== undefined
            ? { expected: { ...(proofHash !== undefined ? { proofHash } : {}), ...(version !== undefined ? { version } : {}) } }
            : {}),
        }, chain);
        print(r);
        return r.ok ? EXIT.VERIFIED : EXIT.NOT_VERIFIED;
      }

      case "proof": {
        if (rest.length !== 1) throw new UsageError("proof takes exactly one file");
        let text: string;
        try {
          text = readFileSync(rest[0]!, "utf8");
        } catch (e) {
          throw new UsageError(`cannot read ${rest[0]}: ${e instanceof Error ? e.message : String(e)}`);
        }
        let file: unknown;
        try {
          file = looksLikeHtml(text) ? extractCertificateProof(text) : JSON.parse(text);
        } catch (e) {
          throw new VerifyError("BAD_INPUT", `${rest[0]}: ${e instanceof Error ? e.message : String(e)}`);
        }
        const onChain = values["on-chain"] === true;
        // The contract a proof is checked against is never the file's choice.
        const named = (file as { contract_id?: unknown } | null)?.contract_id;
        if (onChain && named !== contractId) {
          throw new VerifyError(
            "WRONG_CONTRACT",
            `the proof names contract ${JSON.stringify(named)}, not ${contractId}; pass --contract to check another deployment you trust`,
          );
        }
        const r = await verifyInclusion(file, { onChain, ...chain });
        print(r);
        return r.ok ? EXIT.VERIFIED : EXIT.NOT_VERIFIED;
      }

      case "replay": {
        if (rest.length) throw new UsageError(`replay takes no positional arguments, got ${rest.join(" ")}`);
        const startLedger = int(values, "from-ledger");
        const endLedger = int(values, "to-ledger");
        const snapshot = await replay({
          contractId,
          ...(startLedger !== undefined ? { startLedger } : {}),
          ...(endLedger !== undefined ? { endLedger } : {}),
          ...chain,
        });
        const out = str(values, "out");
        if (out) writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
        if (!snapshot.complete) process.stderr.write(`qdit-verify: snapshot is incomplete:\n  ${snapshot.gaps.join("\n  ")}\n`);

        if (values.compare) {
          const comparison = await compareWithContract(snapshot, chain);
          const summary = { ok: comparison.ok, complete: snapshot.complete, gaps: snapshot.gaps, comparison };
          print(out ? { ...summary, snapshot: out } : { ...summary, snapshot });
          return comparison.ok ? EXIT.VERIFIED : EXIT.NOT_VERIFIED;
        }
        print(out ? { ok: true, complete: snapshot.complete, gaps: snapshot.gaps, eventCount: snapshot.eventCount, snapshot: out } : snapshot);
        return EXIT.VERIFIED;
      }

      case undefined:
        throw new UsageError("name a command: milestone, proof or replay (--help for usage)");
      default:
        throw new UsageError(`unknown command ${JSON.stringify(command)}: use milestone, proof or replay`);
    }
  } catch (e) {
    return fail(e);
  }
}

function fail(e: unknown): number {
  let code: string;
  let exit: number;
  if (e instanceof UsageError) {
    code = "USAGE";
    exit = EXIT.USAGE;
  } else if (e instanceof VerifyError) {
    code = e.code;
    exit = e.code === "RPC" ? EXIT.NETWORK : EXIT.USAGE;
  } else {
    code = "RPC";
    exit = EXIT.NETWORK;
  }
  const message = e instanceof Error ? e.message : String(e);
  print({ ok: false, error: { code, message } });
  process.stderr.write(`qdit-verify: ${message}\n`);
  return exit;
}

run(process.argv.slice(2)).then((code) => {
  // Exit once stdout is flushed, without waiting on idle RPC sockets.
  process.stdout.write("", () => process.exit(code));
});
