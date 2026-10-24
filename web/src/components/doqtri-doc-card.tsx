import { ExternalLink, Lock, Unplug } from "lucide-react";

import { HashLink } from "@/components/hash-link";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LOSS_TEXT, type DocCardData, type DocCardProof } from "@/lib/doqtri-doc-card";
import { ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * The doqtri plan behind a milestone, or one entry of a project's Plan docs,
 * as qdit knows it (WP-2.6). Jira's Confluence-page panel is the model: the
 * page's title and a way to open it, the context it was linked from, and a
 * plain statement when the viewer may not see it or the connection is gone.
 *
 * Read-only in every state: docs and headings are doqtri's (D-11), titles
 * come from doqtri (D-12), and qdit has no token to ask doqtri anything
 * (D-02). Which state applies, and from which rows, is
 * `lib/doqtri-doc-card.ts`.
 *
 * A server component; the popover wrappers below are the only interactive
 * part, and they only open and close it.
 */
export function DoqtriDocCard({ card, className }: { card: DocCardData; className?: string }) {
  if (card.state === "no-access") {
    // Nothing about the plan: not its title, not the copy of it the link row
    // keeps, not the heading or version. Only that a plan is linked, which
    // the "From doqtri" badge has already said.
    return (
      <div data-slot="doqtri-doc-card" data-state="no-access" className={cn("flex gap-2", className)}>
        <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">Linked doqtri plan</p>
          <p className="text-xs text-muted-foreground">
            You don&apos;t have access to the plan this milestone is linked to.
          </p>
        </div>
      </div>
    );
  }

  const lost = card.state === "not-connected";

  return (
    <div data-slot="doqtri-doc-card" data-state={card.state} className={cn("space-y-2.5", className)}>
      <div className="flex min-w-0 items-start gap-2">
        <ICON.planDoc aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 font-medium break-words">{card.title}</p>
      </div>

      {lost ? (
        <div role="status" className="space-y-1 rounded-md border border-warning/40 px-2 py-1.5 text-xs">
          <p className="flex items-center gap-1.5 font-medium text-warning">
            <Unplug aria-hidden className="size-3.5 shrink-0" />
            Connection to doqtri lost
          </p>
          <p className="text-muted-foreground">
            {LOSS_TEXT[card.loss ?? "unknown"]} This is the last copy doqtri sent, and it
            stays read-only until someone reconnects doqtri and saves the plan.
          </p>
        </div>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {card.node ? (
          <>
            <dt className="text-muted-foreground">Heading</dt>
            <dd className="min-w-0 break-words">
              {card.node.label}{" "}
              <span className="font-mono text-muted-foreground">({card.node.id})</span>
            </dd>
          </>
        ) : null}

        <dt className="text-muted-foreground">Doc version</dt>
        <dd>
          {card.docVersion !== null
            ? `v${card.docVersion}`
            : card.proof.kind === "doc" && card.proof.total === 0
              ? "Not known yet"
              : "Not anchored"}
        </dd>

        <dt className="text-muted-foreground">Proof</dt>
        <dd className="min-w-0">
          <ProofState proof={card.proof} />
        </dd>
      </dl>

      {card.url ? (
        <a
          href={card.url}
          title={card.url}
          target="_blank"
          rel="noreferrer noopener"
          className="transition-qdit inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
        >
          Open in doqtri
          <ExternalLink aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          <span className="sr-only">{card.host ? `(opens ${card.host} in a new tab)` : "(opens in a new tab)"}</span>
        </a>
      ) : (
        // D-45: only a doc_url on doqtri's origin is a link.
        <p className="text-xs text-muted-foreground">
          The stored link is not on doqtri, so qdit does not open it.
        </p>
      )}
    </div>
  );
}

const ACTION_LABEL = { submit: "Submitted", approve: "Approved", reject: "Rejected" } as const;

/** The anchor as qdit recorded it: a pointer to chain data, not proof (D-04). */
function ProofState({ proof }: { proof: DocCardProof }) {
  if (proof.kind === "doc") {
    if (proof.total === 0) return <>No linked milestones</>;
    return (
      <>
        {proof.anchored} of {proof.total} linked milestone{proof.total === 1 ? "" : "s"} anchored
      </>
    );
  }

  if (!proof.anchor) return <>Not anchored</>;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span>
        {ACTION_LABEL[proof.anchor.action]} on chain, v{proof.anchor.version}
      </span>
      <HashLink value={proof.anchor.txHash} kind="tx" network={proof.anchor.network} lead={4} tail={4} />
      {proof.stale ? (
        <span className="text-warning" title="The milestone changed after this was anchored.">
          stale
        </span>
      ) : null}
    </span>
  );
}

/** The card in a popover, opened from `trigger` (rendered as the button). */
export function DoqtriDocCardPopover({
  card,
  label,
  children,
}: {
  card: DocCardData;
  /** The trigger's accessible name. */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className="transition-qdit rounded-4xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <DoqtriDocCard card={card} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * "From doqtri" on a milestone linked to a plan heading, opening the card.
 * Marked when the connection is lost, so a list says so without opening it.
 */
export function FromDoqtriBadge({ card }: { card: DocCardData }) {
  const lost = card.state === "not-connected";
  const label =
    card.state === "no-access"
      ? "From doqtri: linked to a plan you don't have access to"
      : lost
        ? `From doqtri: "${card.title}", connection to doqtri lost`
        : `From doqtri: "${card.title}". The title is managed by doqtri.`;

  return (
    <DoqtriDocCardPopover card={card} label={label}>
      <Badge
        variant="outline"
        className={cn("cursor-pointer font-normal text-muted-foreground hover:bg-muted", lost && "border-warning/50")}
      >
        {lost ? <Unplug aria-hidden className="text-warning" /> : null}
        From doqtri
      </Badge>
    </DoqtriDocCardPopover>
  );
}

/** The trailing control on a Plan docs row: connection state, opening the card. */
export function PlanDocConnectionBadge({ card }: { card: DocCardData }) {
  if (card.state === "no-access") return null;
  const lost = card.state === "not-connected";

  return (
    <DoqtriDocCardPopover
      card={card}
      label={lost ? `"${card.title}": connection to doqtri lost` : `"${card.title}": details`}
    >
      <Badge
        variant="outline"
        className={cn(
          "cursor-pointer font-normal hover:bg-muted",
          lost ? "border-warning/50 text-warning" : "text-muted-foreground",
        )}
      >
        {lost ? <Unplug aria-hidden /> : null}
        {lost ? "Connection lost" : "Details"}
      </Badge>
    </DoqtriDocCardPopover>
  );
}
