import Link from "next/link";

import { ConnectWalletButton } from "@/components/auth/connect-wallet-button";
import { QditMark, QditWordmark } from "@/components/brand/qdit-mark";
import { MarketingHeader } from "@/components/landing/marketing-header";
import { ProofRecord } from "@/components/landing/proof-record";
import { Reveal } from "@/components/landing/reveal";
import {
  AnchorVignette,
  TrackVignette,
  VerifyVignette,
} from "@/components/landing/vignettes";
import { Button } from "@/components/ui/button";
import { ICON } from "@/lib/icons";

/**
 * The landing page.
 *
 * A marketing surface, and the one place in the app exempt from the density
 * scale (spec §Density) — display type is allowed here and nowhere else. Every
 * other rule still binds: one accent, the surface ladder, containers that
 * recede around content that is raised, and the brand gradient reserved for
 * branding rather than spent on UI.
 *
 * The page is built around a single argument: a milestone is a claim, and the
 * thing that makes qdit different from every other tracker is that the claim
 * arrives with what a stranger needs to check it. So the hero shows the
 * record, the middle shows the three moves that produce it, and the evidence
 * band shows the machinery underneath. There is no feature grid, because a
 * grid of icon tiles says nothing that a reader could not have guessed.
 */

/** The three moves. Each is a real surface, shown rather than described. */
const STEPS = [
  {
    n: "01",
    icon: ICON.board,
    title: "Track",
    body: "Tasks, milestones and deployments on a board that behaves like a board. Nothing to configure before the first card.",
    vignette: <TrackVignette />,
  },
  {
    n: "02",
    icon: ICON.anchor,
    title: "Anchor",
    body: "A milestone's proof is hashed and written to Stellar through the milestone_proof contract, signed by your own wallet.",
    vignette: <AnchorVignette />,
  },
  {
    n: "03",
    icon: ICON.proof,
    title: "Verify",
    body: "Anyone can paste the hash back and get an answer from the network — not from us, and not from your screenshot.",
    vignette: <VerifyVignette />,
  },
] as const;

/** What a proof actually carries. Column names, because they are the promise. */
const RECORD_FIELDS = [
  { field: "contract_id", body: "The contract the work was deployed to." },
  { field: "tx_hash", body: "The transaction, resolvable on Horizon." },
  { field: "network", body: "Testnet or Mainnet. Recorded, never inferred." },
  { field: "wallet_address", body: "The account that signed. Yours, not ours." },
  { field: "proof_url", body: "The tag, release or commit the claim points at." },
  { field: "created_at", body: "When the record was made, in UTC." },
] as const;

/** The rest of the surface area, as rows — the spec rules out icon tiles. */
const ALSO = [
  {
    icon: ICON.deployment,
    title: "Deployment state",
    body: "Not Started through Mainnet Live, with release notes and the full history behind it.",
  },
  {
    icon: ICON.wallet,
    title: "Signed by your wallet",
    body: "Anchoring is signed by your own Stellar account. qdit holds no key and signs nothing on your behalf.",
  },
  {
    icon: ICON.members,
    title: "Roles the database enforces",
    body: "A hidden button is courtesy. The boundary is 30 row-level security policies underneath it.",
  },
] as const;

/** Evidence, not adjectives. Every number here is checkable from the repo. */
const EVIDENCE = [
  { value: "6", label: "contract functions", sub: "milestone_proof, on Soroban" },
  { value: "26", label: "contract tests", sub: "plus clippy and fmt, clean" },
  { value: "30", label: "RLS policies", sub: "across 8 tables" },
  { value: "241", label: "app tests", sub: "117 unit, 124 end-to-end" },
] as const;

export default function Home() {
  return (
    <>
      {/* Reveal ships its children hidden so nothing flashes in and back out.
          With scripting off there is no observer to unhide them, so unhide
          them here instead — the copy is never gated on JavaScript. */}
      <noscript>
        <style>{`.reveal{opacity:1!important;transform:none!important}`}</style>
      </noscript>

      <MarketingHeader />

      <main className="flex-1">
        {/* ---------------------------------------------------------------- */}
        {/* Hero                                                              */}
        {/* ---------------------------------------------------------------- */}
        <section className="mx-auto w-full max-w-6xl px-6 pt-12 pb-14 sm:pt-20 sm:pb-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
            <div>
              <Reveal>
                <span className="surface inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-success" />
                  Live on Stellar Testnet
                </span>
              </Reveal>

              <Reveal delay={60}>
                <h1 className="mt-6 text-[2.625rem] leading-[1.04] font-bold tracking-tight sm:text-[3.25rem] lg:text-[3.75rem]">
                  A milestone is a claim.
                  <br />
                  <span className="text-brand-gradient">Make it checkable.</span>
                </h1>
              </Reveal>

              <Reveal delay={120}>
                <p className="mt-6 max-w-xl text-[1.0625rem] leading-[1.65] text-muted-foreground">
                  qdit is the task hub for Soroban teams. Projects, tasks and deployments live in
                  one record — and every milestone carries the contract ID, transaction hash and
                  signer that back it. Hand a reviewer a link, not a screenshot.
                </p>
              </Reveal>

              {/* The front door, on the marketing surface rather than one click
                  behind it. Connecting is the whole of signing up: there is no
                  form to fill in first and no account to create beforehand. */}
              <Reveal delay={180}>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <ConnectWalletButton />
                  <Button asChild variant="outline" size="lg">
                    <Link href="/proofs">Verify a hash</Link>
                  </Button>
                </div>

                <p className="mt-5 max-w-md text-xs text-muted-foreground">
                  No password. Your wallet is the account — and once you are in, you can add an
                  email so losing the wallet does not mean losing the workspace.
                </p>
              </Reveal>
            </div>

            <Reveal delay={140}>
              <ProofRecord />
            </Reveal>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* The gap — the problem, stated once and quietly                    */}
        {/* ---------------------------------------------------------------- */}
        <section className="mx-auto w-full max-w-6xl px-6">
          <div className="rule-fade" />

          <Reveal>
            <div className="flex flex-col gap-6 py-14 sm:flex-row sm:items-baseline sm:gap-12">
              <p className="max-w-md text-[1.375rem] leading-snug font-semibold tracking-tight text-balance sm:text-[1.625rem]">
                Your team ships. The proof lives{" "}
                <span className="text-muted-foreground">somewhere else.</span>
              </p>
              <p className="max-w-sm text-[0.9375rem] leading-[1.6] text-muted-foreground sm:ml-auto">
                Tasks in one tool, hashes in a thread, a screenshot in the report. At the end of the
                quarter someone reconciles it by hand and asks you to prove it.
              </p>
            </div>
          </Reveal>

          <Reveal>
            <p
              data-slot="hash"
              className="well rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground"
            >
              Q3 grant report · 40 tasks · 6 milestones ·{" "}
              <span className="text-destructive">0 on a ledger</span>
            </p>
          </Reveal>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* How it works                                                      */}
        {/* ---------------------------------------------------------------- */}
        <section className="mx-auto w-full max-w-6xl px-6 py-24">
          <Reveal>
            <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Three moves
            </p>
            <h2 className="mt-3 max-w-xl text-[1.875rem] leading-tight tracking-tight sm:text-[2.25rem]">
              Track the work. Keep the proof.
            </h2>
          </Reveal>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map(({ n, icon: Icon, title, body, vignette }, i) => (
              <Reveal key={title} delay={i * 80}>
                <article className="surface lift flex h-full flex-col rounded-xl border border-border p-4">
                  {vignette}

                  <div className="mt-5 flex items-center gap-2">
                    <Icon className="size-3.5 text-primary" />
                    <h3 className="text-base font-semibold">{title}</h3>
                    <span className="ml-auto text-xs text-muted-foreground/60 tabular-nums">
                      {n}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-[1.6] text-muted-foreground">{body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* The record                                                        */}
        {/* ---------------------------------------------------------------- */}
        <section className="border-y border-border bg-surface-sunken">
          <div className="mx-auto w-full max-w-6xl px-6 py-24">
            <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
              <Reveal>
                <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  What a proof carries
                </p>
                <h2 className="mt-3 text-[1.875rem] leading-tight tracking-tight text-balance sm:text-[2.25rem]">
                  Everything a reviewer asks for, on the milestone itself.
                </h2>
                <p className="mt-5 max-w-sm text-[0.9375rem] leading-[1.65] text-muted-foreground">
                  Not in a linked doc, not in a folder someone has to be granted. These are the
                  columns — the record is the same one you built against all quarter.
                </p>
              </Reveal>

              <Reveal delay={100}>
                <dl className="surface divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {RECORD_FIELDS.map(({ field, body }) => (
                    // No hover state: these rows go nowhere, and the spec keeps
                    // the accent for signalling state rather than decorating.
                    <div
                      key={field}
                      className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-6"
                    >
                      <dt data-slot="hash" className="w-40 shrink-0 text-xs text-accent-foreground">
                        {field}
                      </dt>
                      <dd className="text-sm text-muted-foreground">{body}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>

            <div className="mt-16 grid gap-8 border-t border-border pt-12 sm:grid-cols-3">
              {ALSO.map(({ icon: Icon, title, body }, i) => (
                <Reveal key={title} delay={i * 70}>
                  {/* Icons ride inline with the heading at 14px — never in a
                      tinted tile stacked above it (spec §Iconography). */}
                  <h3 className="flex items-center gap-2 text-base font-semibold">
                    <Icon className="size-3.5 text-muted-foreground" />
                    {title}
                  </h3>
                  <p className="mt-2 text-sm leading-[1.6] text-muted-foreground">{body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Evidence                                                          */}
        {/* ---------------------------------------------------------------- */}
        <section className="mx-auto w-full max-w-6xl px-6 py-24">
          <Reveal>
            <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Built to be checked
            </p>
            <h2 className="mt-3 max-w-lg text-[1.875rem] leading-tight tracking-tight text-balance sm:text-[2.25rem]">
              A tool that asks you to trust a number should show its own.
            </h2>
          </Reveal>

          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
            {EVIDENCE.map(({ value, label, sub }, i) => (
              <Reveal key={label} delay={i * 60}>
                <div className="surface h-full px-5 py-6">
                  <dd className="text-[2rem] leading-none font-semibold tracking-tight tabular-nums">
                    {value}
                  </dd>
                  <dt className="mt-2.5 text-sm font-medium">{label}</dt>
                  <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
                </div>
              </Reveal>
            ))}
          </dl>

          <Reveal delay={120}>
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Contract build</span>
              <span data-slot="hash" className="text-foreground">
                d4bbe221…f2a8b4
              </span>
              <span aria-hidden>·</span>
              <span>10,777 bytes</span>
              <span aria-hidden>·</span>
              <span>deployed to Stellar Testnet</span>
            </p>
          </Reveal>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Close. The one place the brand gradient runs at full strength.    */}
        {/* ---------------------------------------------------------------- */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-24">
          <Reveal>
            <div className="bg-brand-gradient relative overflow-hidden rounded-2xl px-8 py-14 text-center sm:px-12 sm:py-16">
              <QditMark className="mx-auto size-11 text-white" flat />

              <p className="mt-6 text-[1.5rem] leading-snug font-semibold tracking-tight text-balance text-white sm:text-[1.875rem]">
                Task hub and proof registry.{" "}
                <span className="text-white/65">One record.</span>
              </p>

              {/* The plate is theme-invariant, so its controls have to be too:
                  `secondary` would resolve to dark grey on purple in dark mode,
                  and the brand focus ring would vanish into the ground. #4436D2
                  is the deep stop of the mark's own gradient.

                  The same door as the hero, at the point the argument closes —
                  so the last thing on the page is the way in, not a link to a
                  gate that will ask for a wallet anyway. */}
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <ConnectWalletButton className="bg-white text-[#4436D2] hover:bg-white/90 focus-visible:border-white focus-visible:ring-white/50" />
                <Button
                  asChild
                  size="lg"
                  variant="ghost"
                  className="text-white hover:bg-white/12 hover:text-white focus-visible:border-white focus-visible:ring-white/50"
                >
                  <Link href="/proofs">Proof registry</Link>
                </Button>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <QditMark className="size-5" />
            <QditWordmark className="text-base" />
          </div>

          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground sm:ml-auto">
            <Link href="/dashboard" className="transition-qdit hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/projects" className="transition-qdit hover:text-foreground">
              Projects
            </Link>
            <Link href="/milestones" className="transition-qdit hover:text-foreground">
              Milestones
            </Link>
            <Link href="/proofs" className="transition-qdit hover:text-foreground">
              Proof registry
            </Link>
          </nav>

          <span className="text-xs text-muted-foreground sm:ml-6">Stellar · Soroban</span>
        </div>
      </footer>
    </>
  );
}
