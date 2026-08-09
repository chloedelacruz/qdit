import "server-only";

import { createHash } from "node:crypto";

/**
 * The bridge between the app database and the chain.
 *
 * `milestone_proof` stores a 32-byte hash and nothing else — the milestone's
 * content stays in Postgres, and the ledger only proves that *this* version of
 * it existed at *that* time. This module defines what "this version" means.
 *
 * Server-only, deliberately. Importing it from a Client Component pulls
 * `node:crypto` into the browser bundle; compute staleness on the server and
 * hand the client a boolean.
 *
 * Three rules, all of which have teeth:
 *
 *   1. The encoding is pinned to `utf8`. The digest is a cross-system contract
 *      — an implicit encoding difference silently invalidates every anchor
 *      ever written, and nothing would fail loudly when it happened.
 *   2. The input is canonicalised by construction, not by `JSON.stringify` on
 *      whatever shape a query happened to return. Field order and array order
 *      are both fixed below, because both change the digest.
 *   3. A missing hash counts as stale. Fail toward "re-anchor", never toward
 *      "assume valid".
 */

/** A proof row as it contributes to the digest. */
export type ProofDigestInput = {
  id: string;
  contractId: string | null;
  txHash: string | null;
  network: string;
  walletAddress: string | null;
  proofUrl: string | null;
};

/** Everything the hash covers. */
export type MilestoneDigestInput = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  /** The `stellar_proofs` rows linked to this milestone, in any order. */
  proofs: ProofDigestInput[];
};

/** Bumped only when the canonical form below changes. Part of the digest. */
const DIGEST_VERSION = "qdit/milestone/v1";

/**
 * The exact string that gets hashed.
 *
 * Every field is length-prefixed (`12:some content`) and `~` stands for null.
 * That makes the encoding unambiguous without relying on a separator byte that
 * "cannot appear in the data" — a claim that tends to stop being true later.
 * Concatenating `"ab"` + `"c"` and `"a"` + `"bc"` cannot collide, and an empty
 * string (`0:`) stays distinguishable from an absent one (`~`).
 *
 * Written as an explicit array of scalars rather than an object literal so the
 * field order is the code, not a property of whatever serialises it.
 *
 * Exported because the tests assert the canonical form directly: a change here
 * changes every future digest and invalidates every past one, so it should be a
 * deliberate, visible edit rather than a side effect of a refactor.
 */
export function canonicalMilestone(input: MilestoneDigestInput): string {
  const fields: (string | null)[] = [
    DIGEST_VERSION,
    input.id,
    input.projectId,
    input.title,
    input.description,
    input.status,
    input.dueDate,
  ];

  // Sorted by id so the digest does not depend on the order the database
  // happened to return the rows in.
  const proofs = [...input.proofs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  fields.push(String(proofs.length));

  for (const proof of proofs) {
    fields.push(
      proof.id,
      proof.contractId,
      proof.txHash,
      proof.network,
      proof.walletAddress,
      proof.proofUrl,
    );
  }

  return fields.map((field) => (field === null ? "~" : `${field.length}:${field}`)).join("|");
}

/** SHA-256 of the canonical form, as 64 lowercase hex characters. */
export function milestoneProofHash(input: MilestoneDigestInput): string {
  return createHash("sha256").update(canonicalMilestone(input), "utf8").digest("hex");
}

/** The contract wants `BytesN<32>`; the generated bindings want a `Buffer`. */
export function proofHashBytes(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

/**
 * Has the milestone changed since the hash was anchored?
 *
 * A null or undefined `anchoredHash` is stale: there is no evidence of what the
 * anchor was taken from, which is not the same as evidence that it matches.
 */
export function isMilestoneAnchorStale(
  input: MilestoneDigestInput,
  anchoredHash: string | null | undefined,
): boolean {
  if (!anchoredHash) return true;
  return anchoredHash !== milestoneProofHash(input);
}
