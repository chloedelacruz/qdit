import { CircleAlert, CircleCheck, CircleHelp, ExternalLink, History } from "lucide-react";

import { HashLink } from "@/components/hash-link";
import {
  namesThisMilestone,
  plannedVerdict,
  verifiedOnChain,
  type DocSourceCheck,
  type NodeEvidence,
  type PlannedVerdict,
} from "@/lib/chain/doqtri-registry";
import { ICON } from "@/lib/icons";
import type { PublicDocSource } from "@/lib/queries";
import { NETWORK_LABELS, type StellarNetwork } from "@/lib/stellar";
import { cn } from "@/lib/utils";

/**
 * "Planned in doqtri" on a public milestone page (WP-3.2): the doqtri doc a
 * milestone is linked to, and what DoqtriRegistry says about it.
 *
 * Confluence's "Jira work items" panel and Jira's "mentioned on" Confluence
 * link are the model for the reference itself — what it was planned in and a
 * way to open it. What they do not have, and this does, is the check: every
 * doqtri claim here comes from the ledger (D-04), read when the page loads
 * (`lib/chain/doqtri-registry.ts`). qdit's link row only says which doc and
 * node to read, because it is not evidence (contract section 12): an OAuth
 * client with the role, or a project member's own session, may write it. A
 * reader who trusts neither app can open the registry contract on
 * stellar.expert and read `get_document` and `get_node` themselves.
 *
 * Section 12's two checks are two lines, and the verdict on top is whether
 * both hold:
 *
 *   - node evidence: only when the heading's record has `tool = "qdit"` and
 *     an `artifact_ref` naming this project and milestone does the block
 *     show the node id, the record's status and version, or say "planned in
 *     node N". Otherwise it says "linked to doqtri doc D" and that the
 *     milestone is not signed in doqtri yet;
 *   - doc anchor: "doc anchored at version >= V", which speaks only for the
 *     doc (V is the link row's), so it is never in the success tone alone.
 *
 * Public, so it shows only what section 12 allows: the doc id, the node id on
 * evidence, the linked version, what the registry said, and a doqtri link
 * built from the doc id (never the stored `doc_url`). Never the doc's title.
 * The page renders this only for a linked milestone; an unlinked one gets no
 * block at all.
 */
export function PlannedInDoqtri({
  source,
  check,
}: {
  source: PublicDocSource;
  check: DocSourceCheck;
}) {
  const planned = plannedVerdict(check);
  const verdict = VERDICT[planned](source, check);
  const VerdictIcon = verdict.icon;
  const evidence = namesThisMilestone(check.node) ? check.node : null;
  const record = evidence ? nodeLine(evidence) : null;
  const read = check.state !== "unreachable" && check.state !== "unconfigured";
  const anchor = read ? anchorLine(source, check) : null;
  const where = check.network ? ` on ${NETWORK_LABELS[check.network]}` : "";

  return (
    <section
      data-slot="planned-in-doqtri"
      data-state={check.state}
      data-verdict={planned}
      className="mt-6 rounded-xl border border-border p-4"
    >
      <div className="flex items-start gap-2">
        <ICON.planDoc aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Planned in doqtri</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {evidence ? (
              <>
                doqtri signed node <span className="font-mono">{source.nodeId}</span> of a doqtri
                plan for this milestone.
              </>
            ) : (
              <>
                Linked to doqtri doc <span className="font-mono break-all">{source.docId}</span>.{" "}
                {read
                  ? "Not signed in doqtri for this milestone yet."
                  : "Whether doqtri signed it for this milestone could not be checked."}
              </>
            )}{" "}
            doqtri keeps the plan; its version is anchored{where} in the DoqtriRegistry contract,
            which this page reads.
          </p>
        </div>
      </div>

      <p role="status" className={cn("mt-3 flex items-start gap-1.5 text-sm font-medium", TONE_CLASS[verdict.tone])}>
        <VerdictIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        {verdict.label}
      </p>
      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{verdict.detail}</p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Doc</dt>
        <dd className="min-w-0 break-all font-mono text-xs leading-5">{source.docId}</dd>

        {evidence && record ? (
          <>
            <dt className="text-muted-foreground">Node</dt>
            <dd className="min-w-0 break-words">
              {source.nodeLabel}{" "}
              <span className="font-mono text-xs text-muted-foreground">({source.nodeId})</span>
            </dd>

            <dt className="text-muted-foreground">Node record</dt>
            <dd data-node-state={evidence.state} className={cn("text-xs leading-5", TONE_CLASS[record.tone])}>
              {record.text}
            </dd>
          </>
        ) : null}

        {anchor ? (
          <>
            <dt className="text-muted-foreground">Doc anchor</dt>
            <dd data-anchor-state={check.state} className="min-w-0 text-xs leading-5">
              <p className={TONE_CLASS[anchor.tone]}>{anchor.label}</p>
              {anchor.detail ? (
                <p className="mt-0.5 flex items-start gap-1.5 text-muted-foreground">
                  {anchor.changed ? <History aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : null}
                  {anchor.detail}
                </p>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {source.docLink ? (
          <a
            href={source.docLink}
            target="_blank"
            rel="noreferrer noopener"
            className="transition-qdit inline-flex items-center gap-1.5 font-medium hover:underline"
          >
            Open in doqtri
            <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}

        {check.registryId && check.network ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">DoqtriRegistry</span>
            <HashLink value={check.registryId} kind="contract" network={check.network} />
          </span>
        ) : null}
      </div>
    </section>
  );
}

type Tone = "success" | "warning" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  muted: "text-muted-foreground",
};

type Verdict = {
  tone: Tone;
  icon: typeof CircleCheck;
  label: string;
  detail: string;
};

const net = (network: StellarNetwork | null) => (network ? NETWORK_LABELS[network] : "chain");

/**
 * The verdict on top, one per `PlannedVerdict`. Only `verified` is in the
 * success tone, and it names the on-chain version, not the link's. "Could
 * not check" is said in words wherever a read failed, so a failed read never
 * looks like a pass. Nothing here names the node unless the evidence holds.
 */
const VERDICT: Record<PlannedVerdict, (source: PublicDocSource, check: DocSourceCheck) => Verdict> = {
  verified: (source, check) => ({
    tone: "success",
    icon: CircleCheck,
    label: `Verified: planned in node ${source.nodeId}, plan at v${check.chainVersion}`,
    detail: `DoqtriRegistry on ${net(check.network)} holds node ${source.nodeId} signed for this milestone, and the plan at v${check.chainVersion}.`,
  }),
  unsigned: () => ({
    tone: "muted",
    icon: CircleHelp,
    label: "Not verified",
    detail:
      "No heading of this doc is signed in doqtri for this milestone yet. qdit's link alone is not evidence of what doqtri planned.",
  }),
  "no-chain": () => ({
    tone: "muted",
    icon: CircleHelp,
    label: "Not verified",
    detail:
      "This project is not registered on chain, so no doqtri signature can be checked against it yet. qdit's link alone is not evidence of what doqtri planned.",
  }),
  inconsistent: () => ({
    tone: "warning",
    icon: CircleAlert,
    label: "Not verified",
    detail: "The node's record names this milestone, but does not line up with the milestone's record on chain (below).",
  }),
  doc: () => ({
    tone: "warning",
    icon: CircleAlert,
    label: "Not verified",
    detail: "The node is signed for this milestone, but the doc anchor below does not hold.",
  }),
  unchecked: (_, check) => ({
    tone: "muted",
    icon: CircleHelp,
    label: "Could not check",
    detail: `The milestone's record on ${net(check.network)} could not be read just now, so the node's signature is unchecked. This is not a pass: reload the page to try again.`,
  }),
  unreachable: (_, check) => ({
    tone: "muted",
    icon: CircleHelp,
    label: "Could not check",
    detail: `DoqtriRegistry on ${net(check.network)} did not answer just now. This is not a pass: reload the page to try again.`,
  }),
  unconfigured: () => ({
    tone: "muted",
    icon: CircleHelp,
    label: "Could not check",
    detail: "This qdit deployment does not read a DoqtriRegistry, so nothing here is checked.",
  }),
};

/**
 * Section 12's doc anchor, for a registry that answered. Never the success
 * tone: the version it holds against is the link row's, so on its own it
 * does not show that doqtri linked this milestone.
 */
function anchorLine(
  source: PublicDocSource,
  check: DocSourceCheck,
): { tone: Tone; label: string; detail: string | null; changed: boolean } {
  const on = net(check.network);
  switch (check.state) {
    case "verified": {
      const changed = source.docVersion !== null && check.chainVersion !== null && check.chainVersion > source.docVersion;
      return {
        tone: "muted",
        label: `Doc anchored at version ≥ v${source.docVersion}`,
        detail: changed
          ? `Now v${check.chainVersion} on ${on}: the plan changed since v${source.docVersion}.`
          : `Now v${check.chainVersion} on ${on}.`,
        changed,
      };
    }
    case "not-anchored":
      return {
        tone: "muted",
        label: "No linked version",
        detail:
          check.chainVersion === null
            ? `The doc was not anchored when this milestone was linked, and has no version on ${on} yet.`
            : `The doc was not anchored when this milestone was linked, so there is no linked version to check. DoqtriRegistry has it at v${check.chainVersion} now.`,
        changed: false,
      };
    case "not-found":
      return {
        tone: "warning",
        label: "Doc not found on DoqtriRegistry",
        detail: `No doc with this id is anchored on ${on}, though the link records v${source.docVersion}.`,
        changed: false,
      };
    case "mismatch":
      return {
        tone: "warning",
        label: `Doc not anchored at version ≥ v${source.docVersion}`,
        detail: `DoqtriRegistry has it at v${check.chainVersion}. Versions only go up on chain, so a correct link is never ahead of it.`,
        changed: false,
      };
    default:
      // unreachable and unconfigured have no anchor line; the verdict says why.
      return { tone: "muted", label: "", detail: null, changed: false };
  }
}

type Inconsistent = Extract<NodeEvidence, { state: "inconsistent" }>;

/** The end of "Signed … for this milestone at vV, but …", per reason. */
const INCONSISTENT: Record<Inconsistent["reason"], (node: Inconsistent) => string> = {
  // Never shown: without a registration there is no node evidence.
  "no-chain": () => "this project is not registered on chain, so no milestone record backs it",
  network: () => "its record names another network than this project's",
  contract: () => "its record names another contract than this project's",
  "not-found": () => "the milestone has no record on chain",
  older: (node) => `the milestone's record on chain is at v${node.chainVersion}, older than v${node.signedVersion}`,
};

/**
 * The node's own record (contract sections 10 and 12), shown only on node
 * evidence. "Verified" in the success tone only for fact 4: signed Verified,
 * and the milestone Approved on chain at the version the signature names.
 */
function nodeLine(node: NodeEvidence): { tone: Tone; text: string } {
  const signed = (status: string) => (status === "Verified" ? "Signed as Verified" : `Signed ${status}`);
  switch (node.state) {
    case "inconsistent":
      return {
        tone: "warning",
        text: `${signed(node.status)} for this milestone at v${node.signedVersion}, but ${INCONSISTENT[node.reason](node)}. Not verified.`,
      };
    case "unchecked":
      return {
        tone: "muted",
        text: `${signed(node.status)} for this milestone at v${node.signedVersion}. Its record on chain could not be read just now, so this is unchecked.`,
      };
    case "current":
      if (verifiedOnChain(node)) {
        return {
          tone: "success",
          text: `Verified in doqtri at v${node.signedVersion}, and the milestone is Approved on chain at v${node.signedVersion}.`,
        };
      }
      if (node.status === "Verified") {
        return {
          tone: "warning",
          text: `Signed as Verified; the chain now says ${node.milestoneStatus} (at v${node.signedVersion}).`,
        };
      }
      return {
        tone: "muted",
        text: `Signed ${node.status} at v${node.signedVersion}; the milestone is ${node.milestoneStatus} on chain at v${node.signedVersion}.`,
      };
    case "resubmitted":
      return {
        tone: node.status === "Verified" ? "warning" : "muted",
        text:
          node.status === "Verified"
            ? `Signed as Verified; the chain now says ${node.milestoneStatus} at v${node.chainVersion}. The milestone was resubmitted after the heading was signed, so the signature refers to v${node.signedVersion}.`
            : `Signed ${node.status} at v${node.signedVersion}. The milestone was resubmitted since and is ${node.milestoneStatus} at v${node.chainVersion}; the signature refers to v${node.signedVersion}.`,
      };
  }
}
