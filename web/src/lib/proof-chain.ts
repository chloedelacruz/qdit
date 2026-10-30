import {
  namesThisMilestone,
  plannedVerdict,
  verifiedOnChain,
  type DocSourceCheck,
  type MilestoneRead,
  type NodeEvidence,
} from "@/lib/chain/doqtri-registry";
import type { PublicDocSource, PublicProof } from "@/lib/queries";
import { NETWORK_LABELS, type StellarNetwork } from "@/lib/stellar";

/**
 * The full proof chain of a linked milestone (WP-3.3, contract section 12):
 * the four facts an outside reader checks for gate G3, in order.
 *
 *   1. Plan version        DoqtriRegistry's document and the heading's record
 *                          (WP-3.2's two checks, both holding)
 *   2. Submitted           milestone_proof's current record for the milestone
 *   3. Approved            the same record, `Approved`
 *   4. Verified in doqtri  the heading's record: `tool = "qdit"`, `Verified`,
 *                          an `artifact_ref` naming this milestone at the
 *                          version step 3 approved
 *
 * Every state comes from a contract read made when the page loads (D-04).
 * qdit's own `milestone_anchors` rows only supply the transaction hash and
 * ledger behind steps 2 and 3, because a contract read returns state, not the
 * transaction that wrote it; the hash is a link a reader opens on
 * stellar.expert, not evidence on its own. Where qdit has no hash the step
 * still shows the record it read, and links the contract instead (section
 * 12, "Transaction links").
 *
 * Each step is one of four states, said in words on the page, the same four
 * words doqtri's public page uses (D-78):
 *
 *   done       "Done": the chain says it happened
 *   pending    "Pending": the chain says it has not happened yet
 *   mismatch   "Does not match": the records contradict each other; the
 *              step names how
 *   unchecked  "Could not check": a read failed or is not configured, never
 *              a pass
 *
 * Step 3 is keyed on the milestone's current on-chain record, as on doqtri's
 * page (D-78); when the heading was signed for another version than the one
 * approved, the step says so.
 *
 * Pure: the page passes the reads in. Steps 2 and 3 compare that record with
 * qdit's own anchors, which are read fresh from the database while the
 * record may be cached for up to 30 s; so before the page shows such a
 * contradiction it reads the record again, uncached, and builds the chain
 * from that (D-97, `contradictsQditRecord`, lib/public-proof-chain.ts).
 */

export type ChainStepKey = "plan" | "submitted" | "approved" | "verified";
export type ChainStepState = "done" | "pending" | "mismatch" | "unchecked";

/** Where a step sends a reader who wants to check it on stellar.expert. */
export type ChainStepLink =
  | {
      kind: "tx";
      hash: string;
      network: StellarNetwork;
      ledger: number | null;
      /** True when the hash is qdit's record of a step the chain could not confirm just now. */
      unconfirmed: boolean;
    }
  | {
      kind: "contract";
      contractId: string;
      network: StellarNetwork;
      /** Why there is no transaction to link, in words. */
      note: string;
    };

export type ChainStep = {
  key: ChainStepKey;
  title: string;
  state: ChainStepState;
  /** What the record says, one or two sentences. */
  summary: string;
  /** When it happened: ledger time from the contract, or the time qdit recorded it. */
  at: { iso: string; source: "ledger" | "qdit" } | null;
  /** The proof hash on chain, for step 2. */
  proofHash: string | null;
  /** The address that signed, for step 2 (the record's submitter). */
  signer: { address: string; network: StellarNetwork } | null;
  link: ChainStepLink | null;
};

export type ProofChainInput = {
  /** The project's `milestone_proof` registration; null when it has none. */
  network: StellarNetwork | null;
  contractId: string | null;
  anchors: PublicProof["anchors"];
  source: PublicDocSource;
  check: DocSourceCheck;
  /** `get_milestone_status` for this milestone; null when the project is not registered, so nothing was read. */
  milestone: MilestoneRead | null;
};

export const CHAIN_STEP_TITLES: Record<ChainStepKey, string> = {
  plan: "Plan version",
  submitted: "Submitted",
  approved: "Approved",
  verified: "Verified in doqtri",
};

/** Contract section 12: Stellar RPC keeps contract events for about this long. */
const EVENT_WINDOW = "about 7 days";

const NO_TX_QDIT =
  `qdit has no transaction on record for this step, and Stellar RPC keeps contract events for ${EVENT_WINDOW} only, ` +
  "so one older than that cannot be looked up there. This links the contract instead; the step shows its current record.";

const NO_TX_DOQTRI =
  "qdit does not keep doqtri's transactions, so this links the DoqtriRegistry contract instead. " +
  "Read from current state; see the contract's history on Stellar Expert for the transaction.";

const unixIso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** The four steps, in order. Pure. */
export function proofChain(input: ProofChainInput): ChainStep[] {
  return [planStep(input), submittedStep(input), approvedStep(input), verifiedStep(input)];
}

/**
 * True when step 2 or 3 says qdit's own record contradicts milestone_proof's
 * (D-97). Both reach "Does not match" only from a record the chain returned,
 * which may be a cached one older than qdit's newest anchor: the caller reads
 * the record again, fresh, before it shows them.
 */
export function contradictsQditRecord(steps: ChainStep[]): boolean {
  return steps.some((s) => (s.key === "submitted" || s.key === "approved") && s.state === "mismatch");
}

/** The first step that is not done: the one a reader is waiting on. */
export function currentStep(steps: ChainStep[]): ChainStepKey | null {
  return steps.find((step) => step.state !== "done")?.key ?? null;
}

function step(key: ChainStepKey, state: ChainStepState, summary: string, extra: Partial<ChainStep> = {}): ChainStep {
  return {
    key,
    title: CHAIN_STEP_TITLES[key],
    state,
    summary,
    at: null,
    proofHash: null,
    signer: null,
    link: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. Plan version
// ---------------------------------------------------------------------------

function registryLink(check: DocSourceCheck): ChainStepLink | null {
  return check.registryId && check.network
    ? { kind: "contract", contractId: check.registryId, network: check.network, note: NO_TX_DOQTRI }
    : null;
}

function planStep({ source, check }: ProofChainInput): ChainStep {
  const link = registryLink(check);
  const on = check.network ? NETWORK_LABELS[check.network] : "chain";
  const now = check.chainVersion !== null ? ` The doc is at v${check.chainVersion} on DoqtriRegistry now.` : "";

  switch (plannedVerdict(check)) {
    case "verified":
      return step(
        "plan",
        "done",
        `Planned in node ${source.nodeId} of a doqtri plan anchored at v${check.chainVersion} on ${on}, and the node is signed for this milestone.`,
        { link, at: check.docUpdatedAt !== null ? { iso: unixIso(check.docUpdatedAt), source: "ledger" } : null },
      );
    case "unsigned":
      return step(
        "plan",
        "pending",
        `Linked to a doqtri plan, but no heading of it is signed for this milestone yet, so no plan version is tied to it.${now}`,
        { link },
      );
    case "no-chain":
      return step(
        "plan",
        "pending",
        "This project is not registered on chain, so no doqtri signature can be checked against it yet.",
        { link },
      );
    case "inconsistent":
      return step(
        "plan",
        "mismatch",
        "The heading's record names this milestone, but does not line up with the milestone's record on chain (see Verified in doqtri).",
        { link },
      );
    case "doc":
      return check.state === "not-anchored"
        ? step(
            "plan",
            "pending",
            `The doc was not anchored when this milestone was linked, so there is no linked plan version to check.${now}`,
            { link },
          )
        : step(
            "plan",
            "mismatch",
            check.state === "not-found"
              ? `The link records v${source.docVersion}, but DoqtriRegistry on ${on} has no doc with this id.`
              : `The link records v${source.docVersion}, but DoqtriRegistry on ${on} has the doc at v${check.chainVersion}. Versions only go up on chain, so a correct link is never ahead of it.`,
            { link },
          );
    case "unchecked":
      return step(
        "plan",
        "unchecked",
        "The milestone's record on chain could not be read just now, so the heading's signature is unchecked.",
        { link },
      );
    case "unreachable":
      return step("plan", "unchecked", `DoqtriRegistry on ${on} did not answer just now.`, { link });
    case "unavailable":
      return step("plan", "unchecked", UNAVAILABLE, { link });
    case "unconfigured":
      return step("plan", "unchecked", "This qdit deployment does not read a DoqtriRegistry.");
  }
}

const UNAVAILABLE =
  "qdit could not look up which doqtri heading this milestone is linked to just now, so its record was not read.";

// ---------------------------------------------------------------------------
// 2. Submitted and 3. Approved
// ---------------------------------------------------------------------------

type Anchor = PublicProof["anchors"][number];

/** qdit's newest recorded transaction for an action at a version, on the project's network. */
function anchorFor(input: ProofChainInput, action: Anchor["action"], version?: number): Anchor | null {
  const rows = input.anchors.filter(
    (anchor) =>
      anchor.action === action &&
      anchor.network === input.network &&
      (version === undefined || anchor.version === version),
  );
  return rows.reduce<Anchor | null>(
    (best, anchor) =>
      !best || anchor.version > best.version || (anchor.version === best.version && anchor.createdAt > best.createdAt)
        ? anchor
        : best,
    null,
  );
}

/** The transaction behind a step, or the contract with the reason there is none. */
function txOrContract(input: ProofChainInput, anchor: Anchor | null, unconfirmed = false): ChainStepLink | null {
  if (anchor) {
    return { kind: "tx", hash: anchor.txHash, network: anchor.network, ledger: anchor.ledger, unconfirmed };
  }
  return input.contractId && input.network
    ? { kind: "contract", contractId: input.contractId, network: input.network, note: NO_TX_QDIT }
    : null;
}

function submittedStep(input: ProofChainInput): ChainStep {
  const { milestone } = input;
  const on = input.network ? NETWORK_LABELS[input.network] : "chain";

  if (!milestone || !input.network) {
    return step("submitted", "pending", "This project is not registered on chain yet, so nothing is submitted there.");
  }
  if (!milestone.ok) {
    const recorded = anchorFor(input, "submit");
    return step(
      "submitted",
      "unchecked",
      `milestone_proof on ${on} could not be read just now.${recorded ? ` qdit recorded v${recorded.version} in the transaction linked here, unconfirmed.` : ""}`,
      { link: txOrContract(input, recorded, true) },
    );
  }

  const record = milestone.record;
  const newest = anchorFor(input, "submit");
  if (!record || record.status === "Proposed") {
    return newest
      ? step(
          "submitted",
          "mismatch",
          `qdit recorded a submission (v${newest.version}), but milestone_proof on ${on} has none for this milestone.`,
          { link: txOrContract(input, newest, true) },
        )
      : step("submitted", "pending", `Not submitted on ${on} yet.`, { link: txOrContract(input, null) });
  }

  const anchor = anchorFor(input, "submit", record.version);
  const facts: Partial<ChainStep> = {
    at: { iso: unixIso(record.timestamp), source: "ledger" },
    proofHash: record.proofHash,
    signer: { address: record.submitter, network: input.network },
    link: txOrContract(input, anchor),
  };

  if (anchor?.proofHash && anchor.proofHash.toLowerCase() !== record.proofHash) {
    return step(
      "submitted",
      "mismatch",
      `Proof v${record.version} is submitted on ${on}, but qdit's record of v${record.version} names another proof hash. The one shown is the chain's.`,
      facts,
    );
  }
  if (newest && newest.version > record.version) {
    return step(
      "submitted",
      "mismatch",
      `Proof v${record.version} is submitted on ${on}, but qdit recorded a submission at v${newest.version}, which the chain does not have.`,
      facts,
    );
  }
  return step("submitted", "done", `Proof v${record.version} submitted on ${on}.`, facts);
}

function approvedStep(input: ProofChainInput): ChainStep {
  const { milestone } = input;
  const on = input.network ? NETWORK_LABELS[input.network] : "chain";

  if (!milestone || !input.network) {
    return step("approved", "pending", "Nothing can be approved on chain before the project is registered.");
  }
  if (!milestone.ok) {
    const recorded = anchorFor(input, "approve");
    return step(
      "approved",
      "unchecked",
      `milestone_proof on ${on} could not be read just now.${recorded ? ` qdit recorded an approval of v${recorded.version} in the transaction linked here, unconfirmed.` : ""}`,
      { link: txOrContract(input, recorded, true) },
    );
  }

  const record = milestone.record;
  if (!record || record.status === "Proposed") {
    return step("approved", "pending", "Nothing is submitted on chain to approve yet.");
  }

  // qdit's own record of a decision the chain contradicts at this version:
  // the chain wins (D-04), and the step names the contradiction and links
  // qdit's transaction as unconfirmed, as step 2 does.
  const contradicts = (action: "approve" | "reject", says: string) => {
    const anchor = anchorFor(input, action, record.version);
    return anchor
      ? step(
          "approved",
          "mismatch",
          `qdit recorded ${action === "approve" ? "an approval" : "a rejection"} of v${record.version}, but milestone_proof on ${on} says v${record.version} ${says}.`,
          { link: txOrContract(input, anchor, true) },
        )
      : null;
  };

  switch (record.status) {
    case "Submitted":
      return (
        contradicts("approve", "awaits a decision") ??
        step("approved", "pending", `v${record.version} awaits the project owner's decision on ${on}.`, {
          link: txOrContract(input, null),
        })
      );
    case "Rejected": {
      const mismatch = contradicts("approve", "was rejected");
      if (mismatch) return mismatch;
      const anchor = anchorFor(input, "reject", record.version);
      return step(
        "approved",
        "pending",
        `Not approved: v${record.version} was rejected on ${on}. A new submission would be v${record.version + 1}.`,
        {
          link: txOrContract(input, anchor),
          at: anchor ? { iso: anchor.createdAt, source: "qdit" } : null,
        },
      );
    }
    case "Approved": {
      const mismatch = contradicts("reject", "is approved");
      if (mismatch) return mismatch;
      const anchor = anchorFor(input, "approve", record.version);
      return step(
        "approved",
        "done",
        `v${record.version} approved on ${on} by the project's registered owner.${signedForOther(input, record.version)}`,
        {
          link: txOrContract(input, anchor),
          at: anchor ? { iso: anchor.createdAt, source: "qdit" } : null,
        },
      );
    }
  }
}

/**
 * D-78's note on step 3 (contract section 12, "Step states"): the heading
 * was signed for an older version than the one approved, because the
 * milestone was resubmitted after it was signed. It does not change the
 * step's state; step 4 says what that means for the signature. Only on node
 * evidence, the one case the page may name the node's version. A reference
 * ahead of the record is inconsistent, and step 4 says so instead.
 */
function signedForOther({ check }: ProofChainInput, approved: number): string {
  const node = check.node;
  return namesThisMilestone(node) && node.signedVersion < approved
    ? ` The doqtri heading was signed for v${node.signedVersion}, an older version of this milestone.`
    : "";
}

// ---------------------------------------------------------------------------
// 4. Verified in doqtri
// ---------------------------------------------------------------------------

type Inconsistent = Extract<NodeEvidence, { state: "inconsistent" }>;

/** Why a heading on this project's chain does not line up (node evidence only). */
const INCONSISTENT: Record<Inconsistent["reason"], (node: Inconsistent) => string> = {
  "not-found": () => "the milestone has no record on chain",
  older: (node) => `the milestone's record on chain is at v${node.chainVersion}, older than v${node.signedVersion}`,
};

function verifiedStep({ source, check }: ProofChainInput): ChainStep {
  const link = registryLink(check);
  const on = check.network ? NETWORK_LABELS[check.network] : "chain";

  if (check.state === "unconfigured") {
    return step("verified", "unchecked", "This qdit deployment does not read a DoqtriRegistry.");
  }
  if (check.state === "unreachable") {
    return step("verified", "unchecked", `DoqtriRegistry on ${on} did not answer just now.`, { link });
  }
  if (check.state === "unavailable") {
    return step("verified", "unchecked", UNAVAILABLE, { link });
  }

  const node = check.node;
  if (node?.state === "inconsistent" && (node.reason === "network" || node.reason === "contract")) {
    // D-74: a reference to another chain is no node evidence, so no node id
    // or version, only the explicit inconsistent state.
    return step(
      "verified",
      "mismatch",
      `A heading of this doc is signed for this milestone, but its record names another ${node.reason} than this project's registration. Not verified.`,
      { link },
    );
  }
  if (!namesThisMilestone(node)) {
    return step("verified", "pending", "Not yet verified in doqtri: no heading is signed for this milestone.", { link });
  }

  const at = check.nodeUpdatedAt !== null ? { iso: unixIso(check.nodeUpdatedAt), source: "ledger" as const } : null;
  const signed = node.status === "Verified" ? "signed as Verified" : `signed ${node.status}`;
  const heading = `Heading ${source.nodeId} is ${signed} for v${node.signedVersion}`;

  switch (node.state) {
    case "inconsistent":
      return step("verified", "mismatch", `${heading}, but ${INCONSISTENT[node.reason](node)}. Not verified.`, {
        link,
        at,
      });
    case "unchecked":
      return step(
        "verified",
        "unchecked",
        `${heading}; the milestone's record on chain could not be read just now, so it is unchecked.`,
        { link, at },
      );
    case "current":
      if (verifiedOnChain(node)) {
        return step(
          "verified",
          "done",
          `Heading ${source.nodeId} is signed Verified in doqtri for v${node.signedVersion}, the version approved on chain.`,
          { link, at },
        );
      }
      return node.status === "Verified"
        ? step("verified", "mismatch", `${heading}; the chain now says ${node.milestoneStatus}. Not verified.`, {
            link,
            at,
          })
        : step("verified", "pending", `Not yet verified in doqtri: ${heading.charAt(0).toLowerCase()}${heading.slice(1)}.`, {
            link,
            at,
          });
    case "resubmitted":
      return node.status === "Verified"
        ? step(
            "verified",
            "mismatch",
            `${heading}, but the milestone was resubmitted since and is ${node.milestoneStatus} at v${node.chainVersion}. The signature refers to v${node.signedVersion}. Not verified.`,
            { link, at },
          )
        : step(
            "verified",
            "pending",
            `Not yet verified in doqtri: ${heading.charAt(0).toLowerCase()}${heading.slice(1)}, and the milestone was resubmitted since (now v${node.chainVersion}).`,
            { link, at },
          );
  }
}
