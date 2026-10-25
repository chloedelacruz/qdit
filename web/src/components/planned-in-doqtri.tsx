import { CircleAlert, CircleCheck, CircleHelp, ExternalLink, History } from "lucide-react";

import { HashLink } from "@/components/hash-link";
import type { DocSourceCheck, NodeAttestation } from "@/lib/chain/doqtri-registry";
import { ICON } from "@/lib/icons";
import type { PublicDocSource } from "@/lib/queries";
import { NETWORK_LABELS, type StellarNetwork } from "@/lib/stellar";
import { cn } from "@/lib/utils";

/**
 * "Planned in doqtri" on a public milestone page (WP-3.2): the doqtri heading
 * the milestone came from, and whether DoqtriRegistry agrees with the doc
 * version qdit stored for it.
 *
 * Confluence's "Jira work items" panel and Jira's "mentioned on" Confluence
 * link are the model for the reference itself — what it was planned in and a
 * way to open it. What they do not have, and this does, is the check: the
 * version comes from qdit's link row, and the verdict next to it comes from
 * the ledger (D-04), read when the page loads (`lib/chain/doqtri-registry.ts`).
 * A reader who trusts neither app can open the registry contract on
 * stellar.expert and read `get_document` themselves.
 *
 * Public, so it shows only what the function published: the heading (which
 * is the milestone title, D-12), its node id, the version and the link. Never
 * the doc's title. The page renders this only for a linked milestone; an
 * unlinked one gets no block at all.
 */
export function PlannedInDoqtri({
  source,
  check,
}: {
  source: PublicDocSource;
  check: DocSourceCheck;
}) {
  const verdict = VERDICT[check.state](source, check);
  const VerdictIcon = verdict.icon;

  return (
    <section
      data-slot="planned-in-doqtri"
      data-state={check.state}
      className="mt-6 rounded-xl border border-border p-4"
    >
      <div className="flex items-start gap-2">
        <ICON.planDoc aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Planned in doqtri</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            This milestone came from a heading in a doqtri plan. doqtri keeps the plan;
            its version is anchored on {NETWORK_LABELS[check.network]} in the DoqtriRegistry
            contract, which this page reads.
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Heading</dt>
        <dd className="min-w-0 break-words">
          {source.nodeLabel}{" "}
          <span className="font-mono text-xs text-muted-foreground">({source.nodeId})</span>
        </dd>

        <dt className="text-muted-foreground">Doc version</dt>
        <dd>{source.docVersion !== null ? `v${source.docVersion}` : "Not anchored when linked"}</dd>

        <dt className="text-muted-foreground">Registry check</dt>
        <dd className="min-w-0">
          <p role="status" className={cn("flex items-start gap-1.5 font-medium", TONE_CLASS[verdict.tone])}>
            <VerdictIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {verdict.label}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{verdict.detail}</p>
        </dd>

        {check.node ? (
          <>
            <dt className="text-muted-foreground">Heading on chain</dt>
            <dd className="text-xs leading-5 text-muted-foreground">{nodeText(check.node)}</dd>
          </>
        ) : null}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {source.docUrl ? (
          <a
            href={source.docUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="transition-qdit inline-flex items-center gap-1.5 font-medium hover:underline"
          >
            Open in doqtri
            <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}

        {check.registryId ? (
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

const net = (network: StellarNetwork) => NETWORK_LABELS[network];

/**
 * One sentence per state. "Could not check" is said in words wherever the
 * ledger was not read, so a failed read never looks like a pass.
 */
const VERDICT: Record<DocSourceCheck["state"], (source: PublicDocSource, check: DocSourceCheck) => Verdict> = {
  verified: (source, check) => ({
    tone: "success",
    icon: CircleCheck,
    label: `Matches DoqtriRegistry at v${check.chainVersion}`,
    detail: `The plan's current version on ${net(check.network)} is the v${source.docVersion} this milestone was linked against.`,
  }),
  newer: (source, check) => ({
    tone: "warning",
    icon: History,
    label: "Plan changed since",
    detail:
      source.docVersion === null
        ? `The plan was not anchored when this milestone was linked; DoqtriRegistry now has it at v${check.chainVersion}.`
        : `DoqtriRegistry has the plan at v${check.chainVersion}; this milestone was linked against v${source.docVersion}.`,
  }),
  mismatch: (source, check) => ({
    tone: "warning",
    icon: CircleAlert,
    label: "Does not match DoqtriRegistry",
    detail: `DoqtriRegistry has the plan at v${check.chainVersion}, behind the v${source.docVersion} recorded here. Versions only go up on chain, so a correct link is never ahead of it.`,
  }),
  "not-found": (source, check) => ({
    tone: "warning",
    icon: CircleAlert,
    label: "Not found on DoqtriRegistry",
    detail: `No plan with this id is anchored on ${net(check.network)}, though this milestone records v${source.docVersion}.`,
  }),
  "not-anchored": (_, check) => ({
    tone: "muted",
    icon: CircleHelp,
    label: "Not anchored",
    detail: `The plan has no version on ${net(check.network)} yet, so there is nothing on the ledger to check it against.`,
  }),
  unreachable: (_, check) => ({
    tone: "muted",
    icon: CircleHelp,
    label: "Could not check",
    detail: `DoqtriRegistry on ${net(check.network)} did not answer just now. This is not a pass: reload the page to try again.`,
  }),
  unconfigured: (_, check) => ({
    tone: "muted",
    icon: CircleHelp,
    label: "Could not check",
    detail: `This qdit deployment does not read DoqtriRegistry on ${net(check.network)}, so the version above is unchecked.`,
  }),
};

/** The heading's own record, as contract section 10 says it is signed. */
function nodeText(node: NodeAttestation): string {
  switch (node.state) {
    case "attests":
      return `Signed ${node.status} for this milestone, at its on-chain version ${node.milestoneVersion}.`;
    case "elsewhere":
      return `Signed ${node.status}, but its record points at a different qdit milestone or contract.`;
    case "other":
      return `Signed ${node.status} with tool "${node.tool}", not as this milestone.`;
    case "none":
      return "Not signed on chain yet.";
  }
}
