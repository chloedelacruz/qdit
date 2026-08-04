import Link from "next/link";
import { ArrowRight, Columns3, GitBranch, Link2, Milestone } from "lucide-react";

import { QditLogo, QditMark } from "@/components/brand/qdit-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const PILLARS = [
  {
    icon: Columns3,
    title: "Task board",
    body: "Todo, In Progress, Done. Owners and due dates. Nothing you have to configure first.",
  },
  {
    icon: Milestone,
    title: "Milestones with proof",
    body: "Contract ID, transaction hash, network and repo link attached to the milestone itself.",
  },
  {
    icon: GitBranch,
    title: "Deployment state",
    body: "From Not Started to Mainnet Live, with release notes and a full deployment history.",
  },
  {
    icon: Link2,
    title: "One proof trail",
    body: "Grant reports, hackathon submissions and reviews read from the same record you built against.",
  },
];

export default function Home() {
  return (
    <>
      <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-6 py-5">
        <QditLogo />
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="outline">
            <Link href="/dashboard">Open app</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6">
        <section className="py-20 sm:py-28">
          <p className="text-sm font-medium text-muted-foreground">Builder operations for Stellar</p>

          <h1 className="mt-4 max-w-3xl text-4xl leading-[1.1] font-bold sm:text-5xl">
            Track the work. Keep the proof.
          </h1>

          {/* Marketing surface — exempt from the app's density scale
              (spec §Density), so the hero keeps a readable display size. */}
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            qdit is a task hub for Soroban teams. Projects, tasks and milestones on one side —
            contract IDs, transaction hashes and deployment status on the other. No spreadsheet
            reconciliation before a grant report.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/dashboard">
                Open the dashboard
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <Link href="/projects">Browse projects</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-3 pb-20 sm:grid-cols-2">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="surface lift rounded-xl border border-border p-5">
              <span className="well flex size-9 items-center justify-center rounded-lg border border-border text-muted-foreground">
                <Icon className="size-4.5" />
              </span>
              <h2 className="mt-4 text-base font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        {/* The one place the brand gradient appears at full strength (spec: branding only). */}
        <section className="bg-brand-gradient mb-20 flex flex-wrap items-center gap-6 rounded-2xl px-8 py-10">
          <QditMark className="size-12 shrink-0 text-white" flat />
          <div className="min-w-56 flex-1">
            <h2 className="text-xl font-semibold text-white">Built for the proof trail</h2>
            <p className="mt-1.5 max-w-md text-sm text-white/80">
              Milestone approvals and proof records can be committed on-chain through the
              milestone_proof contract.
            </p>
          </div>
          <Button asChild variant="secondary" size="lg">
            <Link href="/proofs">Proof registry</Link>
          </Button>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 text-xs text-muted-foreground">
          <span>qdit</span>
          <span>Stellar · Soroban</span>
        </div>
      </footer>
    </>
  );
}
