import { CircleAlert, CircleCheck, CircleDashed, CircleHelp } from "lucide-react";

import { HashLink } from "@/components/hash-link";
import { currentStep, type ChainStep, type ChainStepState } from "@/lib/proof-chain";
import { NETWORK_LABELS } from "@/lib/stellar";
import { cn } from "@/lib/utils";

/**
 * The proof chain on a public milestone page (WP-3.3, contract section 12):
 * plan version, submitted, approved, verified in doqtri, in that order, each
 * with what the chain says now and where to check it on stellar.expert.
 *
 * Jira's development panel and Confluence's Jira macro both show a work
 * item's state next to where it came from, but as a status somebody set.
 * This is the same row of facts with the trust moved: every state is a
 * contract read made when the page loads (`lib/proof-chain.ts`), and every
 * step links the transaction or the contract that backs it, so a reader who
 * trusts neither app checks it on the ledger. Gate G3 is exactly that
 * reader.
 *
 * Accessible as an ordered list: the order is the point, so the steps are
 * `<li>`s of an `<ol>` and the visible number is only decoration. Each state
 * is a word next to its icon ("Done", "Pending", "Does not match", "Could not
 * check"), never a colour alone, and the first step that is not done carries
 * `aria-current="step"`.
 *
 * Rendered only for a milestone linked to doqtri; an unlinked milestone's
 * page is what it was before phase 3, its anchor history covering what
 * steps 2 and 3 would say.
 */
export function ProofChain({ steps }: { steps: ChainStep[] }) {
  const current = currentStep(steps);

  return (
    <section
      data-slot="proof-chain"
      aria-labelledby="proof-chain-heading"
      className="mt-6 rounded-xl border border-border p-4"
    >
      <h2 id="proof-chain-heading" className="text-sm font-medium">
        Proof chain
      </h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        From the doqtri plan to the approval, as the two contracts say now. Each step links what
        backs it on stellar.expert.
      </p>

      {/* role="list" keeps the list a list for VoiceOver, which drops it under list-style: none. */}
      <ol role="list" className="mt-4 space-y-4">
        {steps.map((step, index) => (
          <Step key={step.key} step={step} number={index + 1} current={current === step.key} />
        ))}
      </ol>
    </section>
  );
}

const STATE: Record<ChainStepState, { label: string; icon: typeof CircleCheck; tone: string }> = {
  done: { label: "Done", icon: CircleCheck, tone: "text-success" },
  pending: { label: "Pending", icon: CircleDashed, tone: "text-muted-foreground" },
  mismatch: { label: "Does not match", icon: CircleAlert, tone: "text-warning" },
  unchecked: { label: "Could not check", icon: CircleHelp, tone: "text-muted-foreground" },
};

const utc = (iso: string) => `${new Date(iso).toISOString().replace("T", " ").slice(0, 16)} UTC`;

function Step({ step, number, current }: { step: ChainStep; number: number; current: boolean }) {
  const state = STATE[step.state];
  const Icon = state.icon;
  const link = step.link;
  const ledger = link?.kind === "tx" ? link.ledger : null;

  return (
    <li
      data-step={step.key}
      data-step-state={step.state}
      aria-current={current ? "step" : undefined}
      className="flex gap-3"
    >
      <span
        aria-hidden
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted-foreground"
      >
        {number}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{step.title}</span>
          <span data-slot="step-state" className={cn("inline-flex items-center gap-1 text-xs font-medium", state.tone)}>
            <Icon aria-hidden className="size-3.5 shrink-0" />
            {state.label}
          </span>
        </p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.summary}</p>

        {step.at || ledger !== null ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {step.at ? (
              <>
                {step.at.source === "ledger" ? "Ledger time " : "Recorded by qdit "}
                <time dateTime={step.at.iso}>{utc(step.at.iso)}</time>
              </>
            ) : null}
            {step.at && ledger !== null ? " · " : null}
            {ledger !== null ? `ledger ${ledger}` : null}
          </p>
        ) : null}

        {step.proofHash ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Proof hash <code className="font-mono break-all text-foreground">{step.proofHash}</code>
          </p>
        ) : null}

        {step.signer || link ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {link?.kind === "tx" ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {link.unconfirmed ? "Transaction qdit recorded (unconfirmed)" : "Transaction"}
                </span>
                <HashLink value={link.hash} kind="tx" network={link.network} />
              </span>
            ) : null}
            {link?.kind === "contract" ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Contract on {NETWORK_LABELS[link.network]}</span>
                <HashLink value={link.contractId} kind="contract" network={link.network} />
              </span>
            ) : null}
            {step.signer ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">submitted by</span>
                <HashLink
                  value={step.signer.address}
                  kind={step.signer.address.startsWith("C") ? "contract" : "account"}
                  network={step.signer.network}
                />
              </span>
            ) : null}
          </div>
        ) : null}

        {link?.kind === "contract" ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{link.note}</p>
        ) : null}
      </div>
    </li>
  );
}
