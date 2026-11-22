import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MerkleTree,
  certificateProofBlock,
  extractCertificateProof,
  looksLikeHtml,
  proofFiles,
} from "../src/index.ts";

const tree = MerkleTree.build("p", [
  { milestoneId: "a</script>\u2028&<!--", version: 1, proofHash: new Uint8Array(32).fill(1) },
  { milestoneId: "b", version: 2, proofHash: new Uint8Array(32).fill(2) },
]);
const [file] = proofFiles(tree, { network: "testnet", contractId: "C", batchId: "x" });

test("the block round-trips and holds no markup", () => {
  const block = certificateProofBlock(file!);
  const inner = block.slice(block.indexOf(">") + 1, block.lastIndexOf("</script>"));
  assert.ok(!/[<>&\u2028\u2029]/.test(inner));
  assert.deepEqual(extractCertificateProof(`<!doctype html><p>x</p>${block}`), file);
});

test("a page with no block, two blocks, an open block or bad JSON is refused", () => {
  const block = certificateProofBlock(file!);
  assert.throws(() => extractCertificateProof("<html></html>"), /no qdit-inclusion-proof block/);
  assert.throws(() => extractCertificateProof(block + block), /more than one/);
  assert.throws(() => extractCertificateProof(block.replace("</script>", "")), /not closed/);
  assert.throws(() => extractCertificateProof(block.replace('"format"', "format")), /not JSON/);
  assert.throws(
    () => extractCertificateProof(block.replace("qdit-inclusion-proof/v2", "something-else")),
    /not a qdit-inclusion-proof\/v2 file/,
  );
});

test("looksLikeHtml", () => {
  assert.ok(looksLikeHtml("  \n<!doctype html>"));
  assert.ok(!looksLikeHtml('{"format":"qdit-inclusion-proof/v2"}'));
});
