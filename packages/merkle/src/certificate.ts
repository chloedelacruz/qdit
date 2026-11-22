/**
 * The inclusion-proof file as carried inside an HTML certificate.
 *
 * A certificate (written by `qdit-batch certificates`) is a page for people,
 * but it carries the `qdit-inclusion-proof/v2` file in one
 * `<script type="application/json" id="qdit-inclusion-proof">` block. Only that
 * block is ever checked: the visible text is a rendering of it and proves
 * nothing on its own.
 */

import { parseProofFile, type InclusionProofFile } from "./proof-file.ts";

/** The `id` of the script block that carries the proof file. */
export const CERTIFICATE_PROOF_ID = "qdit-inclusion-proof";

const OPEN_TAG = `<script type="application/json" id="${CERTIFICATE_PROOF_ID}">`;
const CLOSE_TAG = "</script>";

/**
 * The script block for a proof file. `<`, `>` and `&` are written as JSON
 * `\u` escapes, so no milestone id can close the block or open another tag,
 * and the text still parses to the same JSON value.
 */
export function certificateProofBlock(file: InclusionProofFile): string {
  const json = JSON.stringify(file, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `${OPEN_TAG}\n${json}\n${CLOSE_TAG}`;
}

/** Whether `text` looks like an HTML document rather than a JSON proof file. */
export function looksLikeHtml(text: string): boolean {
  return text.trimStart().startsWith("<");
}

/**
 * Read the proof file out of a certificate. Throws unless the page holds
 * exactly one proof block and it is a well-formed proof file. The result is
 * shape-checked only: check it with `checkProofFile`, or against the chain.
 */
export function extractCertificateProof(html: string): InclusionProofFile {
  const start = html.indexOf(OPEN_TAG);
  if (start < 0) throw new TypeError(`not a qdit certificate: no ${CERTIFICATE_PROOF_ID} block`);
  if (html.indexOf(OPEN_TAG, start + OPEN_TAG.length) >= 0) {
    throw new TypeError(`not a qdit certificate: more than one ${CERTIFICATE_PROOF_ID} block`);
  }
  const bodyStart = start + OPEN_TAG.length;
  const end = html.indexOf(CLOSE_TAG, bodyStart);
  if (end < 0) throw new TypeError(`not a qdit certificate: the ${CERTIFICATE_PROOF_ID} block is not closed`);
  let value: unknown;
  try {
    value = JSON.parse(html.slice(bodyStart, end));
  } catch (cause) {
    throw new TypeError(`not a qdit certificate: the ${CERTIFICATE_PROOF_ID} block is not JSON`, { cause });
  }
  return parseProofFile(value);
}
