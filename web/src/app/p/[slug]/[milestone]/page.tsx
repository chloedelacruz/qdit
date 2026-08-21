import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { QditLogo } from "@/components/brand/qdit-mark";
import { HashLink } from "@/components/hash-link";
import { StatusBadge } from "@/components/status-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { MILESTONE_STATUS } from "@/lib/constants";
import { getPublicProof, type PublicProof } from "@/lib/queries";
import { NETWORK_LABELS } from "@/lib/stellar";

/**
 * A milestone's proof, for somebody with no account.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE EXISTS
 * ---------------------------------------------------------------------------
 * A tester handed the product its own problem back: they verified a hash in
 * /proofs, said that part was genuinely good, and then said they still could
 * not send their grant contact a link that person could open — everything
 * needed a login, so they were back to sending screenshots, which is the exact
 * thing qdit exists to kill. An auditor in the same round said the same from
 * the other side.
 *
 * So this page is the product's claim, finally reachable by the person the
 * claim is for. It is deliberately plain: a title, a status, the anchor
 * history, the decisions with their reasons, and a link to the ledger for every
 * one of them. Anyone who does not believe a word of it can check the hashes on
 * stellar.expert without ever trusting this page.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * Not a login wall, and not a leak either. It lives outside the `(app)` route
 * group, so no session is required; the data comes from
 * `public_milestone_proof()`, which returns nothing unless the project's owner
 * turned publishing on, and which hand-lists the fields it exposes. There is no
 * description here, no task list, no member names — not because they are hidden
 * from the page, but because the function never sends them.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; milestone: string }>;
}): Promise<Metadata> {
  const { slug, milestone } = await params;
  const proof = await getPublicProof(slug, milestone);

  if (!proof) return { title: "Proof not found", robots: { index: false } };

  return {
    title: `${proof.title} — ${proof.projectName}`,
    description: `Milestone proof anchored on Stellar, verifiable against the ledger.`,
  };
}

export default async function PublicProofPage({
  params,
}: {
  params: Promise<{ slug: string; milestone: string }>;
}) {
  const { slug, milestone } = await params;
  const proof = await getPublicProof(slug, milestone);

  // Not published, no such milestone, and wrong project all land here. The
  // function does not distinguish them and neither should this page: telling
  // them apart would confirm that private work exists.
  if (!proof) notFound();

  const network = proof.network ?? "testnet";
  const submissions = proof.anchors.filter((anchor) => anchor.action === "submit");
  const currentHash = submissions.at(-1)?.proofHash ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 py-5">
        <Link href="/" className="transition-qdit shrink-0 hover:opacity-80">
          <QditLogo />
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-16">
        <p className="text-sm text-muted-foreground">{proof.projectName}</p>

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl">{proof.title}</h1>
          <StatusBadge state={MILESTONE_STATUS[proof.status]} />
        </div>

        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Published by its project. The content stays in qdit — only the hash is
          on the ledger, which is what lets you check this page without being
          asked to trust it. Every hash below opens on stellar.expert.
        </p>

        {/* The one number a reader is most likely to want to compare against
            something they were sent separately, so it does not make them read
            the history to find it. */}
        {currentHash ? (
          <section className="surface-primary mt-6 rounded-xl border border-border-strong p-4">
            <h2 className="text-sm font-medium">Current proof hash</h2>
            <div className="mt-2">
              <HashLink value={currentHash} kind="tx" network={network} lead={10} tail={10} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              SHA-256 of the milestone content as it was submitted. Version{" "}
              {submissions.length} on {NETWORK_LABELS[network]}.
            </p>
          </section>
        ) : (
          <p className="mt-6 text-sm text-warning">
            This milestone has not been anchored yet, so there is nothing on the
            ledger to check it against.
          </p>
        )}

        <Timeline proof={proof} />

        {proof.contractId ? (
          <section className="mt-8">
            <h2 className="text-sm font-medium">Contract</h2>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <HashLink value={proof.contractId} kind="contract" network={network} />
              {proof.ownerAddress ? (
                <>
                  <span className="text-muted-foreground">registered by</span>
                  <HashLink
                    value={proof.ownerAddress}
                    kind="account"
                    network={network}
                  />
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        <p className="mt-10 text-xs text-muted-foreground">
          Anchored with{" "}
          <Link href="/" className="underline underline-offset-2">
            qdit
          </Link>
          . Nothing on this page requires an account to verify.
        </p>
      </main>
    </div>
  );
}

/**
 * The sequence, oldest first.
 *
 * A tester asked for exactly this and explained why better than a spec could:
 * showing only the newest hash tells a funder nothing, and "v1 was rejected on
 * this date, v2 was approved on this date" is the story they actually want. The
 * data was already on chain; the app simply was not reading it back.
 *
 * Anchors and decisions are merged into one list because they are one sequence
 * to a reader — the ledger entry says a decision happened, the review says why,
 * and separating them would make somebody reconcile two tables by timestamp.
 */
function Timeline({ proof }: { proof: PublicProof }) {
  const network = proof.network ?? "testnet";

  const entries = [
    ...proof.anchors.map((anchor) => ({
      at: anchor.createdAt,
      kind: "anchor" as const,
      anchor,
    })),
    ...proof.reviews.map((review) => ({
      at: review.createdAt,
      kind: "review" as const,
      review,
    })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  if (entries.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium">History</h2>

      <ol className="mt-3 space-y-3">
        {entries.map((entry) => (
          <li
            key={`${entry.kind}-${entry.at}`}
            className="border-l-2 border-border pl-4"
          >
            {entry.kind === "anchor" ? (
              <>
                <p className="text-sm">
                  {ANCHOR_VERB[entry.anchor.action]}
                  <span className="text-muted-foreground">
                    {" "}
                    — version {entry.anchor.version}
                  </span>
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <HashLink
                    value={entry.anchor.txHash}
                    kind="tx"
                    network={entry.anchor.network}
                  />
                  <span className="text-xs text-muted-foreground">
                    signed by {entry.anchor.signerAddress.slice(0, 6)}…
                    {entry.anchor.signerAddress.slice(-6)}
                    {entry.anchor.ledger ? ` · ledger ${entry.anchor.ledger}` : ""}
                  </span>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm">
                  {REVIEW_VERB[entry.review.toStatus] ?? "Updated"}
                  <span className="text-muted-foreground"> in qdit</span>
                </p>
                {entry.review.reason ? (
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    “{entry.review.reason}”
                  </p>
                ) : null}
              </>
            )}

            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(entry.at).toISOString().replace("T", " ").slice(0, 16)} UTC
              {entry.kind === "anchor"
                ? ` · ${NETWORK_LABELS[network]}`
                : " · not on the ledger"}
            </p>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        The ledger records that a decision happened and which key signed it. The
        reason for it is written in qdit, not on chain, and is shown here as the
        project published it.
      </p>
    </section>
  );
}

const ANCHOR_VERB: Record<PublicProof["anchors"][number]["action"], string> = {
  submit: "Proof anchored",
  approve: "Approved on chain",
  reject: "Rejected on chain",
};

const REVIEW_VERB: Partial<Record<PublicProof["status"], string>> = {
  approved: "Approved",
  rejected: "Rejected",
  submitted: "Submitted for approval",
};
