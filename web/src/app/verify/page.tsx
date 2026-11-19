import type { Metadata } from "next";
import Link from "next/link";

import { QditLogo } from "@/components/brand/qdit-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { VerifyTx } from "@/components/verify-tx";

/**
 * The public "Verify a hash" page.
 *
 * The landing page says anyone can paste a hash back and get an answer from
 * the network, not from qdit. This page keeps that promise for someone with no
 * account: it lives outside the `(app)` route group, like the user guide and
 * the public proof page, and the check it runs is `/api/verify-tx`, which
 * answers signed-out callers under a rate limit. The signed-in proof registry
 * (`/proofs`) keeps the same check above the workspace's own records.
 */

export const metadata: Metadata = {
  title: "Verify a hash",
  description:
    "Paste a Stellar transaction hash and see what the network recorded: whether it succeeded, the ledger, the time and the signer. No account needed.",
};

const CHECKS = [
  { label: "Result", body: "Whether the transaction succeeded. A transaction can be in a ledger and still have failed." },
  { label: "Ledger and time", body: "The ledger that includes it and when that ledger closed, in UTC." },
  { label: "Source", body: "The account that signed and paid for it. For a qdit anchor, that is the team's own wallet." },
  { label: "Operations", body: "How many operations it carried. A qdit anchor is one contract call." },
] as const;

export default function VerifyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-5 sm:px-6">
        <Link href="/" aria-label="qdit — home" className="transition-qdit shrink-0 hover:opacity-80">
          <QditLogo />
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Verify a hash
        </p>
        <h1 className="mt-1 text-lg font-semibold">Ask the network, not us</h1>
        <p className="mt-3 mb-5 text-sm leading-6 text-muted-foreground">
          Paste a transaction hash from a qdit milestone, or any other Stellar
          transaction. The answer comes from Horizon, the network&rsquo;s own API.
          qdit&rsquo;s database is not part of the check. You do not need an
          account.
        </p>

        <VerifyTx />

        <section aria-labelledby="what" className="well mt-6 rounded-xl border border-border p-4">
          <h2 id="what" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            What you get back
          </h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {CHECKS.map(({ label, body }) => (
              <div key={label} className="text-sm">
                <dt className="inline font-medium">{label}</dt>{" "}
                <dd className="inline text-muted-foreground">— {body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="mt-6 text-xs leading-5 text-muted-foreground">
          Got a link to a milestone instead? Its public page shows the proof
          digest, the transaction and the signer. Working in qdit?{" "}
          <Link href="/proofs" className="underline underline-offset-2 hover:text-foreground">
            Open the proof registry
          </Link>{" "}
          to check hashes next to your team&rsquo;s records, or read the{" "}
          <Link href="/user-guide" className="underline underline-offset-2 hover:text-foreground">
            user guide
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
