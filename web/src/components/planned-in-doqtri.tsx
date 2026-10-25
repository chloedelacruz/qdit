import { CircleAlert, CircleCheck, CircleHelp, ExternalLink, History } from "lucide-react";

import { HashLink } from "@/components/hash-link";
import { verifiedOnChain, type DocSourceCheck, type NodeAttestation } from "@/lib/chain/doqtri-registry";
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
 * Two verdicts, kept apart because contract section 12 keeps them apart: the
 * plan version (fact 1, DoqtriRegistry's document against the stored
 * version) and the heading's own record (fact 4, a node signed Verified,
 * which counts only when this milestone is Approved on chain at the version
 * the node names). A node signed Verified for a milestone the chain does not
 * show Approved at that version is said to be exactly that, never verified.
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
  const node = check.node ? nodeLine(check.node) : null;
  const changedSince =
    check.state === "verified" &&
    source.docVersion !== null &&
    check.chainVersion !== null &&
    check.chainVersion > source.docVersion;

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
            its version is anchored{check.network ? ` on ${NETWORK_LABELS[check.network]}` : ""} in
            the DoqtriRegistry contract, which this page reads.
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
          {changedSince ? (
            <p className="mt-0.5 flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
              <History aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              Plan changed since v{source.docVersion} (now v{check.chainVersion}).
            </p>
          ) : null}
        </dd>

        {check.node && node ? (
          <>
            <dt className="text-muted-foreground">Heading on chain</dt>
            <dd data-node-state={check.node.state} className={cn("text-xs leading-5", TONE_CLASS[node.tone])}>
              {node.text}
            </dd>
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
 * One sentence per state of the plan version (contract section 12). Every
 * state but `verified` names why it is not, and "Could not check" is said in
 * words wherever the ledger was not read, so a failed read never looks like
 * a pass.
 */
const VERDICT: Record<DocSourceCheck["state"], (source: PublicDocSource, check: DocSourceCheck) => Verdict> = {
  verified: (source, check) => ({
    tone: "success",
    icon: CircleCheck,
    label: `Verified on DoqtriRegistry at v${check.chainVersion}`,
    detail:
      check.chainVersion === source.docVersion
        ? `The plan's current version on ${net(check.network)} is the v${source.docVersion} this milestone was linked against.`
        : `The plan is on ${net(check.network)} at v${check.chainVersion}, past the v${source.docVersion} this milestone was linked against; versions only go up.`,
  }),
  "not-anchored": (_, check) => ({
    tone: "muted",
    icon: CircleHelp,
    label: "Not verified",
    detail:
      check.chainVersion === null
        ? `The plan was not anchored when this milestone was linked, and has no version on ${net(check.network)} yet.`
        : `The plan was not anchored when this milestone was linked, so there is no linked version to check. DoqtriRegistry has it at v${check.chainVersion} now.`,
  }),
  "not-found": (source, check) => ({
    tone: "warning",
    icon: CircleAlert,
    label: "Not found on DoqtriRegistry",
    detail: `No plan with this id is anchored on ${net(check.network)}, though this milestone records v${source.docVersion}.`,
  }),
  mismatch: (source, check) => ({
    tone: "warning",
    icon: CircleAlert,
    label: "Does not match DoqtriRegistry",
    detail: `DoqtriRegistry has the plan at v${check.chainVersion}, behind the v${source.docVersion} recorded here. Versions only go up on chain, so a correct link is never ahead of it.`,
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
    detail: "This qdit deployment does not read a DoqtriRegistry, so the version above is unchecked.",
  }),
};

type Inconsistent = Extract<NodeAttestation, { state: "inconsistent" }>;

/** The end of "Signed … for this milestone at vV, but …", per reason. */
const INCONSISTENT: Record<Inconsistent["reason"], (node: Inconsistent) => string> = {
  "no-chain": () => "this project is not registered on chain, so no milestone record backs it",
  network: () => "its record names another network than this project's",
  contract: () => "its record names another contract than this project's",
  "not-found": () => "the milestone has no record on chain",
  older: (node) => `the milestone's record on chain is at v${node.chainVersion}, older than v${node.signedVersion}`,
};

/**
 * The heading's own record (contract sections 10 and 12). "Verified" in the
 * success tone only for fact 4: signed Verified, and the milestone Approved
 * on chain at the version the signature names.
 */
function nodeLine(node: NodeAttestation): { tone: Tone; text: string } {
  const signed = (status: string) => (status === "Verified" ? "Signed as Verified" : `Signed ${status}`);
  switch (node.state) {
    case "none":
      return { tone: "muted", text: "Not signed in doqtri for this milestone yet." };
    case "other":
      return {
        tone: "muted",
        text: `Not signed in doqtri for this milestone yet. The heading's current record is signed with tool "${node.tool}".`,
      };
    case "elsewhere":
      return {
        tone: "muted",
        text: "Not signed in doqtri for this milestone yet. The heading's current record names another qdit milestone.",
      };
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
