import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { QditLogo } from "@/components/brand/qdit-mark";
import { HashLink } from "@/components/hash-link";
import { PlannedInDoqtri } from "@/components/planned-in-doqtri";
import { ProofChain } from "@/components/proof-chain";
import { StatusBadge } from "@/components/status-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { MILESTONE_STATUS } from "@/lib/constants";
import { readPublicChain } from "@/lib/public-proof-chain";
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
 *
 * ---------------------------------------------------------------------------
 * PLANNED IN DOQTRI (WP-3.2)
 * ---------------------------------------------------------------------------
 * A milestone linked to a doqtri heading also gets a "Planned in doqtri"
 * block. The link row only says which doc and node to read (it is not
 * evidence, contract section 12); the node, its record and the doc's version
 * are what DoqtriRegistry says when the page loads, and the doqtri link is
 * built from the doc id. The function sends the reference only for a linked
 * milestone, and the registry is read only then, so an unlinked milestone's
 * page is exactly what it was.
 *
 * ---------------------------------------------------------------------------
 * PROOF CHAIN (WP-3.3)
 * ---------------------------------------------------------------------------
 * Above that block, a linked milestone gets the whole chain in four steps:
 * plan version, submitted, approved, verified in doqtri (contract section
 * 12). Steps 2 and 3 are milestone_proof's current record, read here, with
 * the transaction from the anchor history; 1 and 4 are the registry reads
 * the block already makes. It is what gate G3's outside reader follows. An
 * unlinked milestone gets no chain: its anchor history already tells steps
 * 2 and 3, and its page stays exactly what it was. The reads are
 * lib/public-proof-chain.ts, which reads the milestone's record again,
 * uncached, before the chain says qdit's record contradicts it (D-97).
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

  // The registry and milestone_proof reads behind the proof chain and the
  // Planned in doqtri block (contract section 12), only for a linked
  // milestone: lib/public-proof-chain.ts.
  const docSource = proof.docSource ?? null;
  const read = await readPublicChain(proof);
  const docCheck = read?.check ?? null;
  const chain = read?.steps ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 py-5">
        <Link href="/" className="transition-qdit shrink-0 hover:opacity-80">
          <QditLogo />
        </Link>
        {/* The network, named rather than inferred. A tester read a testnet
            proof as production; on a page whose whole job is to be trusted, the
            difference between Testnet and Mainnet has to be stated, not guessed
            from a hash. */}
        <span
          className="ml-auto rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground"
          title={
            network === "mainnet"
              ? "Anchored on the Stellar public network."
              : "Anchored on the Stellar test network — not the public ledger."
          }
        >
          {NETWORK_LABELS[network]}
        </span>
        <ThemeToggle />
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
            the history to find it. A digest, not a transaction: copyable, but
            with no stellar.expert link, which would only open "not found"
            (D-83). The transaction that anchored it is in the history. */}
        {currentHash ? (
          <section className="surface-primary mt-6 rounded-xl border border-border-strong p-4">
            <h2 className="text-sm font-medium">Current proof hash</h2>
            <div className="mt-2">
              <HashLink value={currentHash} kind="hash" lead={10} tail={10} />
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

        {/*
          What the ledger settles, and what it does not. An auditor in the round
          put it precisely: "the ledger proves a rejection happened and your
          server tells me why — that's a weaker claim than the landing page
          makes it sound." So this says it out loud, on the page rather than only
          in the repo. The chain carries the status, the version and the digest;
          the reason text lives in qdit and is covered by — not stored in — the
          hash. A reader who wants to trust nothing here can still recompute the
          digest and check every transaction on stellar.expert.
        */}
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-4">
            <h2 className="text-sm font-medium text-success">What the ledger proves</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li>That this milestone reached each status, and when.</li>
              <li>The version counter — how many times its proof was submitted.</li>
              <li>The digest: a fingerprint of the content as it was submitted.</li>
              <li>Which Stellar account signed each transaction.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-border p-4">
            <h2 className="text-sm font-medium text-muted-foreground">What it does not</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li>The content itself is not on chain — only its digest is.</li>
              <li>
                Reasons for a decision are written in qdit, not on the ledger.
                They are shown below as this project published them.
              </li>
              <li>The ledger does not vouch for who a signer is off chain.</li>
            </ul>
          </div>
        </section>

        {chain ? <ProofChain steps={chain} /> : null}
        {docSource && docCheck ? <PlannedInDoqtri source={docSource} check={docCheck} /> : null}

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
