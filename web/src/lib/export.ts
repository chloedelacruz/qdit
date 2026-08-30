import "server-only";

import { MILESTONE_STATUS } from "@/lib/constants";
import type { AnchorExport, MilestoneCertificate } from "@/lib/queries";
import { accountUrl, contractUrl, NETWORK_LABELS, txUrl } from "@/lib/stellar";

/**
 * Proof you can take away.
 *
 * Three cohorts, three separate asks, one hundred and twenty people, and the
 * round-2 version was specific: not a link, an artifact you can file — "a signed
 * export, one file per project, that I can attach to a report and that still
 * verifies six months from now when this site may or may not be up"
 * (FEEDBACK-PLAN §P1). Nothing in the app exported anything before this.
 *
 * Two formats, and the honest word about both: neither is signed *by qdit*. The
 * signature that matters is already on the ledger — each transaction below was
 * signed by the account that made it, and that is what a reader checks. These
 * files are a bundle of pointers into a public, permanent record, arranged so
 * the receipt outlives the vendor: every hash here is checkable on
 * stellar.expert whether or not this app is still running.
 *
 * Server-only: the templates below build strings, but they are handed straight
 * to a download route and never belong in a client bundle.
 */

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * RFC 4180 field escaping.
 *
 * A field is quoted when it contains a comma, a quote, or a newline, and an
 * embedded quote is doubled. A digest or an account address will not contain
 * any of these, but a milestone title is free text a person typed, so the rule
 * is applied to every field rather than trusted away.
 */
function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(fields: (string | number | null)[]): string {
  return fields.map(csvField).join(",");
}

/**
 * The anchor table, as the CSV a tester estimated at "an afternoon's work" and
 * wanted for their quarterly report — milestone, status, version, digest, tx
 * hash, ledger, timestamp, and the signer besides.
 *
 * `\r\n` line endings, because that is what RFC 4180 specifies and what
 * spreadsheet software is least surprised by. A leading comment naming the
 * project and the contract is not part of the CSV grid — so it is omitted here
 * and lives in the filename and the certificate instead, keeping this a file a
 * spreadsheet opens cleanly.
 */
export function buildAnchorCsv(data: AnchorExport): string {
  const header = [
    "milestone",
    "status",
    "action",
    "version",
    "digest",
    "tx_hash",
    "ledger",
    "network",
    "signer",
    "timestamp_utc",
  ];

  const rows = data.rows.map((row) =>
    csvRow([
      row.milestoneTitle,
      MILESTONE_STATUS[row.status].label,
      row.action,
      row.version,
      row.proofHash,
      row.txHash,
      row.ledger,
      NETWORK_LABELS[row.network],
      row.signerAddress,
      new Date(row.createdAt).toISOString(),
    ]),
  );

  return [csvRow(header), ...rows].join("\r\n") + "\r\n";
}

/* -------------------------------------------------------------------------- */
/* Certificate                                                                */
/* -------------------------------------------------------------------------- */

const ACTION_LABEL: Record<AnchorExport["rows"][number]["action"], string> = {
  submit: "Proof submitted",
  approve: "Approved",
  reject: "Rejected",
};

/** Minimal HTML escaping for text interpolated into the certificate. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtUtc(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/**
 * A single self-contained file certifying one milestone against the ledger.
 *
 * Deliberately one HTML document with its styles inlined and no external
 * request of any kind: it opens offline, prints to PDF, and — the whole point —
 * still resolves every transaction on stellar.expert years from now without qdit
 * in the loop. The links are the verification; the prose only explains what to
 * click and what a click proves.
 *
 * It is HTML rather than PDF because the project has no PDF toolchain, and a PDF
 * would only be a heavier wrapper around the same links. A reader who needs a
 * PDF prints this to one; a reader who needs to verify clicks the hashes.
 */
export function buildCertificateHtml(cert: MilestoneCertificate): string {
  const { project, milestone } = cert;
  const status = MILESTONE_STATUS[milestone.status].label;

  const anchorRows = cert.anchors
    .map((anchor) => {
      const digest = anchor.proofHash
        ? `<code>${esc(anchor.proofHash)}</code>`
        : '<span class="muted">—</span>';
      return `
        <tr>
          <td>${esc(ACTION_LABEL[anchor.action])}</td>
          <td>${anchor.version}</td>
          <td class="mono">${digest}</td>
          <td><a href="${esc(txUrl(anchor.txHash, anchor.network))}">${esc(anchor.txHash.slice(0, 12))}…</a></td>
          <td>${anchor.ledger ?? '<span class="muted">—</span>'}</td>
          <td class="nowrap">${esc(fmtUtc(anchor.createdAt))}</td>
          <td><a href="${esc(accountUrl(anchor.signerAddress, anchor.network))}">${esc(anchor.signerAddress.slice(0, 6))}…${esc(anchor.signerAddress.slice(-6))}</a></td>
        </tr>`;
    })
    .join("");

  const reviewRows = cert.reviews.length
    ? cert.reviews
        .map(
          (review) => `
        <li>
          <span class="review-head">${esc(MILESTONE_STATUS[review.toStatus].label)}</span>
          <span class="muted"> · ${esc(fmtUtc(review.createdAt))}</span>
          ${review.reason ? `<div class="reason">&ldquo;${esc(review.reason)}&rdquo;</div>` : ""}
        </li>`,
        )
        .join("")
    : "";

  const contractLine = project.contractId
    ? `<a href="${esc(contractUrl(project.contractId, project.network))}">${esc(project.contractId)}</a>`
    : '<span class="muted">not registered on chain</span>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Proof certificate — ${esc(milestone.title)} — ${esc(project.name)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem; background: #f6f7f9; color: #1a1d21;
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  main { max-width: 52rem; margin: 0 auto; background: #fff; border: 1px solid #e3e6ea; border-radius: 14px; padding: 2rem 2.25rem; }
  h1 { font-size: 1.3rem; margin: 0 0 .25rem; }
  h2 { font-size: .95rem; margin: 2rem 0 .6rem; }
  .eyebrow { font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; margin: 0 0 1.25rem; }
  .status { display: inline-block; margin-left: .5rem; padding: .05rem .5rem; border: 1px solid #cbd2da; border-radius: 999px; font-size: .78rem; color: #374151; vertical-align: middle; }
  .grid { display: grid; grid-template-columns: 8.5rem 1fr; gap: .35rem 1rem; margin: 1rem 0; font-size: .9rem; }
  .grid dt { color: #6b7280; }
  .grid dd { margin: 0; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; font-size: .82rem; margin-top: .5rem; }
  th, td { text-align: left; padding: .45rem .5rem; border-bottom: 1px solid #eceff2; vertical-align: top; }
  th { color: #6b7280; font-weight: 600; border-bottom-color: #d7dce1; }
  td.mono code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .78rem; word-break: break-all; }
  .nowrap { white-space: nowrap; }
  a { color: #1f6feb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .muted { color: #9aa1aa; }
  ul.reviews { list-style: none; padding: 0; margin: .5rem 0 0; }
  ul.reviews li { padding: .5rem 0; border-bottom: 1px solid #eceff2; }
  .review-head { font-weight: 600; }
  .reason { color: #4b5563; margin-top: .25rem; }
  .note { background: #f6f8fa; border: 1px solid #e3e6ea; border-radius: 10px; padding: .9rem 1rem; font-size: .84rem; color: #4b5563; margin-top: 1rem; }
  .note strong { color: #1a1d21; }
  footer { margin: 1.5rem auto 0; max-width: 52rem; font-size: .76rem; color: #9aa1aa; padding: 0 .25rem; }
  @media print {
    body { background: #fff; padding: 0; }
    main { border: none; border-radius: 0; padding: 0; }
    a { color: inherit; }
  }
</style>
</head>
<body>
<main>
  <p class="eyebrow">qdit · proof certificate</p>
  <h1>${esc(milestone.title)}<span class="status">${esc(status)}</span></h1>
  <p class="muted">${esc(project.name)}</p>

  <dl class="grid">
    <dt>Network</dt><dd>${esc(NETWORK_LABELS[project.network])}</dd>
    <dt>Contract</dt><dd class="mono">${contractLine}</dd>
    ${
      project.ownerAddress
        ? `<dt>Registered by</dt><dd class="mono"><a href="${esc(accountUrl(project.ownerAddress, project.network))}">${esc(project.ownerAddress)}</a></dd>`
        : ""
    }
    ${
      cert.currentDigest
        ? `<dt>Current digest</dt><dd class="mono">${esc(cert.currentDigest)}</dd>`
        : ""
    }
    <dt>Generated</dt><dd>${esc(fmtUtc(cert.generatedAt))}</dd>
  </dl>

  <h2>On-chain history</h2>
  ${
    cert.anchors.length
      ? `<table>
    <thead><tr><th>Event</th><th>Ver.</th><th>Digest</th><th>Transaction</th><th>Ledger</th><th>Time</th><th>Signer</th></tr></thead>
    <tbody>${anchorRows}</tbody>
  </table>`
      : `<p class="muted">This milestone has not been anchored on chain.</p>`
  }

  ${
    reviewRows
      ? `<h2>Decisions recorded in qdit</h2>
  <ul class="reviews">${reviewRows}</ul>`
      : ""
  }

  <div class="note">
    <strong>How to verify.</strong> Open each transaction link above on
    stellar.expert. The digest is a SHA-256 fingerprint of the milestone content
    as it was submitted; the ledger is authoritative, not this file and not qdit.
    Decision reasons are recorded in qdit, not on chain, and are covered by — not
    stored in — the digest. This certificate is not signed by qdit: each
    transaction was signed by the account shown, and that signature is the proof.
  </div>
</main>
<footer>
  Generated by qdit. Verifiable independently against the Stellar
  ${esc(NETWORK_LABELS[project.network])} ledger.
</footer>
</body>
</html>
`;
}
