// `qdit-batch certificates`: one self-contained HTML certificate per milestone
// of an anchored batch, carrying its inclusion-proof file.
//
// The certificate is for people: it opens offline, prints to PDF, and links the
// anchor transaction. What it proves is the embedded proof file, which
// `qdit-batch verify` and `@qdit/verify` read back out and check. The visible
// text is a rendering of that file and is never checked by itself.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  certificateProofBlock,
  checkProofFile,
  parseProofFile,
  type InclusionProofFile,
} from "@qdit/merkle";

import type { BatchSummary } from "./batch.ts";

/** stellar.expert serves testnet and public; any other network gets no links. */
function explorer(network: string): string | null {
  if (network === "testnet") return "https://stellar.expert/explorer/testnet";
  if (network === "public" || network === "mainnet") return "https://stellar.expert/explorer/public";
  return null;
}

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function utc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/**
 * The certificate for one proof file. Refuses a file with no anchor (an
 * unanchored root proves nothing) or one that does not agree with itself.
 */
export function renderCertificate(file: InclusionProofFile, opts: { generatedAt: Date }): string {
  if (!file.anchor) {
    throw new Error(`${file.batch_id}/${file.milestone_id}: the batch was never anchored, so there is nothing to certify`);
  }
  const self = checkProofFile(file);
  if (!self.leafMatches || !self.pathValid) {
    throw new Error(`${file.batch_id}/${file.milestone_id}: the proof file does not agree with itself`);
  }

  const base = explorer(file.network);
  const link = (kind: "tx" | "contract", id: string, text = id) =>
    base && id ? `<a href="${esc(`${base}/${kind}/${id}`)}">${esc(text)}</a>` : esc(id || "(none)");
  const anchor = file.anchor;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Batch inclusion certificate: ${esc(file.milestone_id)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem; background: #f6f7f9; color: #1a1d21;
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  main { max-width: 52rem; margin: 0 auto; background: #fff; border: 1px solid #e3e6ea; border-radius: 14px; padding: 2rem 2.25rem; }
  h1 { font-size: 1.3rem; margin: 0 0 .25rem; word-break: break-all; }
  h2 { font-size: .95rem; margin: 2rem 0 .6rem; }
  .eyebrow { font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; margin: 0 0 1.25rem; }
  .grid { display: grid; grid-template-columns: 9rem 1fr; gap: .35rem 1rem; margin: 1rem 0; font-size: .9rem; }
  .grid dt { color: #6b7280; }
  .grid dd { margin: 0; word-break: break-all; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8rem; }
  ol.path { margin: .25rem 0 0; padding-left: 1.5rem; font-size: .78rem; }
  pre { background: #f6f8fa; border: 1px solid #e3e6ea; border-radius: 10px; padding: .75rem 1rem; font-size: .78rem; overflow-x: auto; }
  a { color: #1f6feb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .muted { color: #9aa1aa; }
  .note { background: #f6f8fa; border: 1px solid #e3e6ea; border-radius: 10px; padding: .9rem 1rem; font-size: .84rem; color: #4b5563; margin-top: 1rem; }
  .note strong { color: #1a1d21; }
  footer { margin: 1.5rem auto 0; max-width: 52rem; font-size: .76rem; color: #9aa1aa; padding: 0 .25rem; }
  @media (max-width: 36rem) { main { padding: 1.25rem 1rem; } .grid { grid-template-columns: 1fr; } .grid dd { margin-bottom: .5rem; } }
  @media print { body { background: #fff; padding: 0; } main { border: none; border-radius: 0; padding: 0; } a { color: inherit; } }
</style>
</head>
<body>
<main>
  <p class="eyebrow">qdit · batch inclusion certificate</p>
  <h1>${esc(file.milestone_id)}</h1>
  <p class="muted">Project ${esc(file.project_id)}</p>

  <dl class="grid">
    <dt>Milestone</dt><dd class="mono">${esc(file.milestone_id)}</dd>
    <dt>Version</dt><dd>${esc(file.version)}</dd>
    <dt>Proof hash</dt><dd class="mono">${esc(file.proof_hash)}</dd>
    <dt>Leaf</dt><dd class="mono">${esc(file.leaf)}</dd>
  </dl>

  <h2>Anchored batch</h2>
  <dl class="grid">
    <dt>Network</dt><dd>Stellar ${esc(file.network)}</dd>
    <dt>Contract</dt><dd class="mono">${link("contract", file.contract_id)}</dd>
    <dt>Batch</dt><dd class="mono">${esc(file.batch_id)}</dd>
    <dt>Merkle root</dt><dd class="mono">${esc(file.root)}</dd>
    <dt>Position</dt><dd>leaf ${esc(file.index)} of ${esc(file.leaf_count)} (index from 0)</dd>
    <dt>Transaction</dt><dd class="mono">${link("tx", anchor.tx_hash)}</dd>
    <dt>Ledger</dt><dd>${esc(anchor.ledger)}, ${esc(utc(anchor.timestamp))}</dd>
    <dt>Proof path</dt><dd>${
      file.path.length
        ? `<ol class="path mono">${file.path.map((h) => `<li>${esc(h)}</li>`).join("")}</ol>`
        : '<span class="muted">none: the batch has one leaf, so the leaf is the root</span>'
    }</dd>
  </dl>

  <div class="note">
    <strong>What this proves.</strong> The milestone above, at that version and with that
    proof hash, was one of ${esc(file.leaf_count)} records whose Merkle root was anchored in
    the transaction above. It does not carry the milestone's approval state. The ledger
    is the authority, not this page and not qdit. The page is not signed by qdit; the
    anchor transaction was signed by the batch submitter.
  </div>

  <h2>How to verify</h2>
  <p>This page carries its inclusion-proof file (<span class="mono">qdit-inclusion-proof/v2</span>)
  in a script block. Only that block is checked; the text above is a rendering of it.</p>
  <p>With <span class="mono">qdit-batch</span> from <a href="https://github.com/chloedelacruz/qdit">github.com/chloedelacruz/qdit</a> (<span class="mono">packages/qdit-batch</span>):</p>
<pre>qdit-batch verify ${esc(`<this file>`)}            # against the root stored on chain
qdit-batch verify --offline ${esc(`<this file>`)}  # the file agrees with itself, no network</pre>
  <p class="muted">The on-chain check reads the root with <span class="mono">get_batch</span> and asks the
  contract's own <span class="mono">verify_inclusion</span>. Both are simulations: no key and no fee.
  An offline check alone proves only that the file is consistent, not that its root was anchored.</p>
</main>
<footer>Generated ${esc(opts.generatedAt.toISOString().replace("T", " ").slice(0, 19))} UTC by qdit-batch.
Verifiable independently against the Stellar ${esc(file.network)} ledger.</footer>
${certificateProofBlock(file)}
</body>
</html>
`;
}

/** The certificate file name for a proof file: the same name, `.html`. */
export function certificateFileName(proofFile: string): string {
  return basename(proofFile).replace(/\.json$/i, "") + ".html";
}

/**
 * Write a certificate for each named proof file into `outDir`, for when the
 * batch directory isn't at hand. Every file must carry its anchor.
 */
export function writeCertificatesForFiles(proofPaths: string[], outDir: string, generatedAt: Date): string[] {
  const pages = proofPaths.map((p) => ({
    name: certificateFileName(p),
    html: renderCertificate(parseProofFile(readFileSync(p, "utf8")), { generatedAt }),
  }));
  mkdirSync(outDir, { recursive: true });
  return pages.map(({ name, html }) => {
    const path = join(outDir, name);
    writeFileSync(path, html);
    return path;
  });
}

/**
 * Write a certificate for every milestone of the batch in `batchDir` (as
 * `qdit-batch anchor` laid it out) into `outDir`. Returns the paths written.
 */
export function writeCertificates(batchDir: string, outDir: string, generatedAt: Date): string[] {
  const summary = JSON.parse(readFileSync(join(batchDir, "batch.json"), "utf8")) as BatchSummary;
  if (summary.format !== "qdit-batch/v2") {
    throw new Error(`${batchDir}/batch.json is not a qdit-batch/v2 batch`);
  }
  if (!summary.anchor) {
    throw new Error(
      `batch ${summary.batch_id} was built but never anchored; run qdit-batch anchor first, certificates need the anchor transaction`,
    );
  }

  // Render everything before writing anything, so a bad file leaves no partial set.
  const pages = summary.milestones.map((m) => {
    const file = parseProofFile(readFileSync(join(batchDir, m.proof_file), "utf8"));
    if (
      file.batch_id !== summary.batch_id ||
      file.project_id !== summary.project_id ||
      file.root !== summary.root ||
      file.milestone_id !== m.milestone_id ||
      file.anchor?.tx_hash !== summary.anchor!.tx_hash
    ) {
      throw new Error(`${m.proof_file} does not belong to batch ${summary.batch_id} as batch.json records it`);
    }
    return { name: certificateFileName(m.proof_file), html: renderCertificate(file, { generatedAt }) };
  });

  mkdirSync(outDir, { recursive: true });
  return pages.map(({ name, html }) => {
    const path = join(outDir, name);
    writeFileSync(path, html);
    return path;
  });
}
