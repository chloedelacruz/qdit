import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { MarketingHeader } from "@/components/landing/marketing-header";
import { ICON } from "@/lib/icons";

/**
 * Public technical reference for qdit — for developers, integrators and
 * auditors, not end users.
 *
 * Lives outside the `(app)` route group, so no session is required. It is
 * static content, so a plain Server Component with no `"use client"`: the table
 * of contents is anchor links, not a scroll spy.
 *
 * Everything here is grounded in the repository it describes —
 * `contracts/milestone_proof/src/lib.rs`, the `supabase/migrations`,
 * `web/src/lib/queries.ts`, `web/src/lib/chain/*` and the `web/src/app/api`
 * routes. If a detail could not be verified against the code it was left out.
 */

export const metadata: Metadata = {
  title: "Technical documentation",
  description:
    "How qdit fits together: the milestone_proof Soroban contract, the Postgres data model and RLS, the wallet-signed anchoring flow, and the public proof pages.",
};

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                      */
/* -------------------------------------------------------------------------- */

/** Inline monospace for an identifier, function name or column. */
function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  );
}

/** A section heading: an inline icon at ~14px, then the label. Never a tile. */
function Heading({
  id,
  icon: Icon,
  accent,
  children,
}: {
  id: string;
  icon: (typeof ICON)[keyof typeof ICON];
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <h2
      id={id}
      className="flex scroll-mt-24 items-center gap-2 text-base font-semibold tracking-tight"
    >
      <Icon
        aria-hidden
        className={accent ? "size-3.5 text-primary" : "size-3.5 text-muted-foreground"}
      />
      {children}
    </h2>
  );
}

/** Third-level label. Weight and colour carry the hierarchy, not size. */
function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

/** A horizontally scrollable data table on a bordered card. */
function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="bg-card">
            {head.map((cell) => (
              <th
                key={cell}
                className="whitespace-nowrap border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="border-b border-border px-3 py-2 last:border-b-0 [tr:last-child_&]:border-b-0"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A sunken, scrollable code block. */
function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="well overflow-x-auto rounded-lg border border-border p-4 font-mono text-xs leading-relaxed text-foreground">
      {children}
    </pre>
  );
}

/* -------------------------------------------------------------------------- */
/* Reference data                                                             */
/* -------------------------------------------------------------------------- */

const MAINNET_CONTRACT = "CBJHS2ZGKYJJUQR6YNSMZYGDPVHEESKGONN7IEOUMBDWAMUYAVIOOZRD";
const TESTNET_CONTRACT = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";
const WASM_HASH = "d4bbe221cbe9837cf277448d0fe3aa99cf0dd9213a98db15b671a34dadf2a8b4";

const TOC: { id: string; label: string }[] = [
  { id: "at-a-glance", label: "At a glance" },
  { id: "architecture", label: "Architecture" },
  { id: "contract", label: "On-chain contract" },
  { id: "data-model", label: "Data model" },
  { id: "anchoring", label: "Anchoring flow" },
  { id: "api", label: "API routes" },
  { id: "public-proofs", label: "Public proof pages" },
  { id: "verify", label: "Verify it yourself" },
];

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <MarketingHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 pb-24 pt-10">
        <div className="max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Documentation
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ICON.anchor aria-hidden className="size-4 text-primary" />
            Technical reference
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            qdit is a builder task hub for Stellar teams: projects, tasks, milestones,
            deployments and proofs in one hub, where each approved milestone&rsquo;s
            SHA-256 proof hash is anchored on the Stellar network through a Soroban
            contract, signed by the builder&rsquo;s own wallet. This page describes how
            the pieces fit — the contract, the database, the anchoring flow and the
            public proof pages — for developers, integrators and auditors. It is grounded
            in the code it documents; every identifier below is real.
          </p>
        </div>

        <div className="mt-12 lg:grid lg:grid-cols-[12rem_1fr] lg:gap-12">
          {/* Table of contents — sticky on wide screens, hidden when there is
              no room for a second column. */}
          <aside className="hidden lg:block">
            <nav className="sticky top-24">
              <SubHeading>On this page</SubHeading>
              <ul className="mt-3 space-y-1.5 text-sm">
                {TOC.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="transition-qdit text-muted-foreground hover:text-foreground"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          <div className="min-w-0 max-w-3xl space-y-16">
            <AtAGlance />
            <Architecture />
            <Contract />
            <DataModel />
            <Anchoring />
            <ApiRoutes />
            <PublicProofs />
            <Verify />
          </div>
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

function AtAGlance() {
  return (
    <section id="at-a-glance" className="scroll-mt-24">
      {/* The primary object of this page: the two live deployments a reader is
          most likely to be here to look up. One elevated surface; everything
          below it steps down to flush prose. */}
      <div className="surface-primary rounded-xl border border-border-strong p-5">
        <SubHeading>Deployed milestone_proof contract</SubHeading>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The same reproducible build runs on both networks — the WASM hash is
          byte-identical, so <C>stellar contract build</C> against this source yields the
          hash deployed to each. The contract carries no admin address and no{" "}
          <C>upgrade</C> entry point on either network.
        </p>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Mainnet
            </dt>
            <dd className="mt-1 break-all font-mono text-xs leading-5">{MAINNET_CONTRACT}</dd>
            <dd className="mt-1 text-xs text-muted-foreground">
              Public Global Stellar Network ; September 2015
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Testnet
            </dt>
            <dd className="mt-1 break-all font-mono text-xs leading-5">{TESTNET_CONTRACT}</dd>
            <dd className="mt-1 text-xs text-muted-foreground">
              Test SDF Network ; September 2015
            </dd>
          </div>
        </dl>

        <div className="mt-4 border-t border-border pt-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            WASM hash (both networks)
          </dt>
          <dd className="mt-1 break-all font-mono text-xs leading-5">{WASM_HASH}</dd>
        </div>

        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          10,777 bytes optimized · 6 exported functions · built with{" "}
          <C>soroban-sdk 27.0.4</C>, targeting <C>wasm32v1-none</C>. Explorer links live in
          the repository README.
        </p>
      </div>
    </section>
  );
}

function Architecture() {
  return (
    <section className="space-y-4">
      <Heading id="architecture" icon={ICON.overview} accent>
        Architecture
      </Heading>
      <p className="text-sm leading-6 text-muted-foreground">
        Four layers, each with a single job. The chain never holds user content — only a
        32-byte hash of it — so the database stays authoritative for the work while the
        ledger stays authoritative for the proof.
      </p>

      <Table
        head={["Layer", "Where", "Responsibility"]}
        rows={[
          [
            "Next.js app",
            <C key="w">web/</C>,
            "App Router (v16), React 19, TypeScript, Tailwind v4. Server Components read the database through one query module; Server Actions write it. Browser-side wallet signing for anchoring and payments.",
          ],
          [
            "Soroban contract",
            <C key="c">contracts/</C>,
            "The milestone_proof Rust crate (no_std, soroban-sdk 27). Owner-gated registry: registers projects and records milestone proof hashes with an approve / reject lifecycle.",
          ],
          [
            "Supabase Postgres",
            <C key="s">supabase/</C>,
            "Plain-SQL migrations: tables, enums, triggers, indexes and Row Level Security. Holds the actual project, task and milestone content, plus local pointers at each on-chain transaction.",
          ],
          [
            "Stellar network",
            "mainnet · testnet",
            "Soroban RPC assembles and submits the signed contract calls; Horizon answers balance and transaction-verification reads. The ledger is the source of truth for what was anchored.",
          ],
        ]}
      />

      <p className="text-sm leading-6 text-muted-foreground">
        Auth is Supabase Auth reached through Stellar wallet sign-in (SEP-10): the wallet
        signs a self-verifying challenge transaction and the server mints a session. The
        deployment&rsquo;s network is fixed by <C>NEXT_PUBLIC_STELLAR_NETWORK</C> (
        <C>mainnet</C> or, by default, <C>testnet</C>) and the contract it anchors against
        by <C>NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID</C>.
      </p>
    </section>
  );
}

function Contract() {
  return (
    <section className="space-y-5">
      <Heading id="contract" icon={ICON.anchor} accent>
        On-chain contract
      </Heading>
      <p className="text-sm leading-6 text-muted-foreground">
        <C>milestone_proof</C> is an owner-gated registry. A project owner registers a
        project reference, a submitter attaches a proof hash for a milestone, and the
        project owner approves or rejects it. Only the 32-byte proof hash lives on chain;
        the artifact stays off chain. Identifiers are the app&rsquo;s own UUIDs, passed as
        Soroban <C>String</C> and capped at 64 characters.
      </p>

      <div className="space-y-3">
        <SubHeading>Exported functions</SubHeading>
        <Table
          head={["Function", "Auth", "Notes"]}
          rows={[
            [
              <C key="f">create_project_ref(project_id, owner)</C>,
              <C key="a">owner</C>,
              <>
                Registers a project. Errors <C>ProjectExists</C> (1) if the id is taken,
                rather than upserting.
              </>,
            ],
            [
              <C key="f">transfer_project_owner(project_id, current_owner, new_owner)</C>,
              <span key="a" className="font-medium">
                both
              </span>,
              <>
                <C>current_owner</C> must equal the address in storage. Milestone records
                are untouched.
              </>,
            ],
            [
              <C key="f">submit_milestone_proof(project_id, milestone_id, submitter, proof_hash)</C>,
              <C key="a">submitter</C>,
              <>
                Sets status <C>Submitted</C>, increments <C>version</C>, stamps the ledger
                timestamp.
              </>,
            ],
            [
              <C key="f">approve_milestone(project_id, milestone_id, approver)</C>,
              <>
                <C>approver</C> = owner
              </>,
              <>
                Only valid from <C>Submitted</C>. Terminal.
              </>,
            ],
            [
              <C key="f">reject_milestone(project_id, milestone_id, approver)</C>,
              <>
                <C>approver</C> = owner
              </>,
              <>
                Only valid from <C>Submitted</C>. May be re-submitted afterwards.
              </>,
            ],
            [
              <C key="f">get_milestone_status(project_id, milestone_id)</C>,
              "none",
              <>
                Read-only, unauthenticated. Errors <C>MilestoneNotFound</C> (3). Read
                through simulation — free, no signature.
              </>,
            ],
          ]}
        />
      </div>

      <div className="space-y-3">
        <SubHeading>Milestone lifecycle</SubHeading>
        <p className="text-sm leading-6 text-muted-foreground">
          A single state machine, enforced on chain. An unseen milestone is implicitly{" "}
          <C>Proposed</C>; a submission moves it to <C>Submitted</C>; the owner rules on
          it. <C>Approved</C> is terminal, <C>Rejected</C> can be re-submitted (which
          overwrites <C>proof_hash</C> and increments the monotonic <C>version</C>).
          Approve and reject preserve <C>version</C> — they attest to a submission rather
          than making one.
        </p>
        <Code>{`Proposed ──submit──▶ Submitted ──approve──▶ Approved   (terminal)
                        │
                        └────reject───▶ Rejected ──submit──▶ Submitted …`}</Code>
      </div>

      <div className="space-y-3">
        <SubHeading>Owner authorization</SubHeading>
        <p className="text-sm leading-6 text-muted-foreground">
          Every write calls <C>require_auth()</C>. On creation the <C>owner</C> argument is
          authorized (there is no stored state yet); on every subsequent write the owner is
          read <em>from storage</em> and authorized, never trusted from an argument — that
          is the difference between an owner-gated registry and a free-for-all. Approve and
          reject additionally check <C>approver == stored owner</C> and return{" "}
          <C>NotAuthorized</C> (4) otherwise, so the on-chain owner rules regardless of what
          the app&rsquo;s membership table says.
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          <C>transfer_project_owner</C> requires <span className="font-medium">both</span>{" "}
          signatures: the outgoing owner proves the right to give the project away, the
          incoming owner proves the destination is an address someone actually controls.
          With no admin path and no upgrade, a one-sided transfer could strand a project on
          an unsignable address permanently — so both must sign. It recovers a
          wrong-but-controlled address and enables key rotation; it cannot recover a lost
          key, because a lost key cannot sign as <C>current_owner</C>.
        </p>
      </div>

      <div className="space-y-3">
        <SubHeading>Storage &amp; TTL</SubHeading>
        <p className="text-sm leading-6 text-muted-foreground">
          Records live in <C>persistent</C> storage under a <C>DataKey</C> enum —{" "}
          <C>Project(project_id)</C> maps to the owner address, and{" "}
          <C>Milestone(project_id, milestone_id)</C> to the full record. Every write extends
          the TTL of every key it touches back out to ~90 days (
          <C>90 × 17,280</C> ledgers), topped up whenever fewer than ~30 days remain.
        </p>
      </div>

      <div className="space-y-3">
        <SubHeading>Events</SubHeading>
        <p className="text-sm leading-6 text-muted-foreground">
          Every write emits exactly one event and a failed call emits none, so an off-chain
          indexer can resync from the ledger alone. The shape is uniform: topic&nbsp;0 is the
          constant namespace <C>qdit</C> (one predicate filters every event of this
          contract), topic&nbsp;1 is the verb, and topic&nbsp;2 is the indexed{" "}
          <C>project_id</C> (watch one project without decoding each body).
        </p>
        <Table
          head={["Topic 0", "Topic 1", "Topic 2", "Data"]}
          rows={[
            [<C key="a">qdit</C>, <C key="b">register</C>, <C key="c">project_id</C>, <C key="d">owner</C>],
            [
              <C key="a">qdit</C>,
              <C key="b">transfer</C>,
              <C key="c">project_id</C>,
              <C key="d">previous_owner, new_owner</C>,
            ],
            [
              <C key="a">qdit</C>,
              <C key="b">submit</C>,
              <C key="c">project_id</C>,
              <C key="d">milestone_id, submitter, proof_hash, version</C>,
            ],
            [
              <C key="a">qdit</C>,
              <C key="b">approve</C>,
              <C key="c">project_id</C>,
              <C key="d">milestone_id, approver, version</C>,
            ],
            [
              <C key="a">qdit</C>,
              <C key="b">reject</C>,
              <C key="c">project_id</C>,
              <C key="d">milestone_id, approver, version</C>,
            ],
          ]}
        />
      </div>

      <div className="space-y-3">
        <SubHeading>Errors</SubHeading>
        <p className="text-sm leading-6 text-muted-foreground">
          A <C>#[repr(u32)]</C> error enum with explicit, append-only discriminants —
          returned inside a <C>Result</C> rather than panicked, so a client maps the code to
          a message: <C>ProjectExists</C> (1), <C>ProjectNotFound</C> (2),{" "}
          <C>MilestoneNotFound</C> (3), <C>NotAuthorized</C> (4), <C>InvalidStatus</C> (5),{" "}
          <C>IdTooLong</C> (6).
        </p>
      </div>
    </section>
  );
}

function DataModel() {
  return (
    <section className="space-y-5">
      <Heading id="data-model" icon={ICON.project} accent>
        Data model
      </Heading>
      <p className="text-sm leading-6 text-muted-foreground">
        The off-chain layer is plain-SQL migrations. Access is derived entirely from{" "}
        <C>project_members</C>: every table has Row Level Security enabled and no permissive
        default, so with RLS on and no matching policy the answer is &ldquo;no rows&rdquo;.
      </p>

      <div className="space-y-3">
        <SubHeading>Tables</SubHeading>
        <Table
          head={["Table", "Holds"]}
          rows={[
            [<C key="t">profiles</C>, "One row per auth user: display name, avatar, and the immutable linked wallet address."],
            [<C key="t">projects</C>, "A workspace. Carries the per-project on-chain registration columns and the public_proofs switch."],
            [<C key="t">project_members</C>, "Membership + role join table — the single source of truth for every RLS check."],
            [<C key="t">milestones</C>, "Milestone with an off-chain status mirroring the contract's state machine."],
            [<C key="t">tasks</C>, "Board card: Todo → In Progress → Done, priority, assignee, optional milestone link."],
            [<C key="t">stellar_proofs</C>, "Proof-of-work record: contract id, tx hash, network, wallet, links."],
            [<C key="t">deployments</C>, "Append-only deployment history; the latest row is the current release state."],
            [<C key="t">milestone_anchors</C>, "Append-only log of submit / approve / reject transactions — a local pointer at each ledger entry."],
            [<C key="t">milestone_reviews</C>, "Why a decision was made: from_status → to_status and a reason. Off chain by design."],
            [<C key="t">notifications</C>, "Per-recipient bell items, written by a database trigger on a milestone status change."],
          ]}
        />
      </div>

      <div className="space-y-3">
        <SubHeading>Enums</SubHeading>
        <p className="text-sm leading-6 text-muted-foreground">
          <C>milestone_status</C> (<C>proposed</C>, <C>submitted</C>, <C>approved</C>,{" "}
          <C>rejected</C>) is deliberately identical to the contract&rsquo;s{" "}
          <C>MilestoneStatus</C> so off-chain and on-chain state can be compared directly.
          The others: <C>project_status</C>, <C>member_role</C>, <C>task_status</C>,{" "}
          <C>task_priority</C>, <C>stellar_network</C>, <C>deployment_status</C>,{" "}
          <C>anchor_action</C> and <C>notification_kind</C>.
        </p>
      </div>

      <div className="space-y-3">
        <SubHeading>RLS policy model</SubHeading>
        <p className="text-sm leading-6 text-muted-foreground">
          Roles rank <C>viewer</C> &lt; <C>member</C> &lt; <C>admin</C> &lt; <C>owner</C>.
          Policies route through a <C>SECURITY DEFINER</C> helper,{" "}
          <C>is_project_member(project_id, min_role)</C>, which reads{" "}
          <C>project_members</C> as its owner to avoid the infinite-recursion trap of a
          policy that queries the table it protects. It always evaluates <C>auth.uid()</C>,
          never an argument, and returns only a boolean. Broadly: viewer+ reads, member+
          writes tasks / milestones / proofs, admin+ manages the project, its deployments
          and its members. The two ledger-pointer tables (<C>milestone_anchors</C>,{" "}
          <C>milestone_reviews</C>) have no <C>UPDATE</C> or <C>DELETE</C> policy — editing a
          row would make it lie, and deleting one does not delete the ledger entry it names.
        </p>
      </div>

      <div className="space-y-3">
        <SubHeading>Read path</SubHeading>
        <p className="text-sm leading-6 text-muted-foreground">
          Every read goes through <C>web/src/lib/queries.ts</C>. RLS does the scoping, so
          the queries never filter by membership themselves — a missing filter is a narrower
          result, not a leak. Each list function returns a <C>Page&lt;T&gt;</C> —{" "}
          <C>rows</C> (after the limit), <C>total</C> (unfiltered) and <C>matched</C> (after
          filters) — so a view can tell &ldquo;you have nothing yet&rdquo; from &ldquo;your
          filter matched nothing&rdquo; without a second round trip, and no view can render
          an unbounded list by accident.
        </p>
      </div>

      <div className="space-y-3">
        <SubHeading>Write path</SubHeading>
        <p className="text-sm leading-6 text-muted-foreground">
          Mutations are Server Actions in <C>web/src/app/**/actions.ts</C>. They re-validate
          with the same zod schema the client used — the client copy is a convenience, this
          one is the boundary, because a POST can be made without ever loading the form — and
          return <C>{`{ ok, error, fieldErrors }`}</C> rather than throwing, so a form renders
          the failure inline. Postgres error codes are mapped to sentences (a{" "}
          <C>42501</C> becomes a permission message); RLS remains the actual boundary, and a
          hidden button is courtesy, not security.
        </p>
      </div>
    </section>
  );
}

function Anchoring() {
  return (
    <section className="space-y-5">
      <Heading id="anchoring" icon={ICON.ready} accent>
        Anchoring flow
      </Heading>
      <p className="text-sm leading-6 text-muted-foreground">
        Signing happens in the browser, so a single Server Action cannot own the whole
        transaction. It splits in three, and anchoring is deliberately{" "}
        <span className="font-medium">additive</span> — it never writes{" "}
        <C>milestones.status</C>. Moving a milestone through the approval flow in the app and
        proving it on chain are separate acts, and the two are allowed to disagree; the UI
        shows both.
      </p>

      <ol className="space-y-4">
        <li className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">1 · Prepare (server)</p>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            <C>prepare*</C> authorizes the caller, computes the SHA-256 proof hash over a
            canonical, length-prefixed encoding of the milestone and its linked proofs
            (server-only, encoding pinned to <C>utf8</C>), then assembles and simulates the
            contract call and hands back base64 XDR plus the simulated fee. Simulation
            surfaces a contract error — an already-approved milestone, an unregistered
            project — <em>before</em> the user is asked to sign, costing nothing.
          </p>
        </li>
        <li className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">2 · Sign (browser)</p>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            The wallet kit signs that XDR string and nothing else. The same{" "}
            <C>signTransaction</C> call every supported wallet already implements.
          </p>
        </li>
        <li className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium">3 · Submit (server)</p>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            <C>submit*</C> treats the signed XDR as untrusted input:{" "}
            <C>assertInvocation</C> re-derives what the transaction is allowed to be and
            refuses anything else — exactly one operation, an <C>invokeContract</C> host
            function, the configured contract id, and the expected function name. Only then
            does it submit through Soroban RPC and poll <C>getTransaction</C> until success
            (a timeout or <C>TRY_AGAIN_LATER</C> is an error, not an optimistic success). It
            reads <C>version</C> back from the contract by simulation, then inserts a{" "}
            <C>milestone_anchors</C> row whose <C>signer_address</C> comes from the verified
            transaction, never from a profile field.
          </p>
        </li>
      </ol>

      <p className="text-sm leading-6 text-muted-foreground">
        The client half of this lives in <C>web/src/lib/chain/client.ts</C> and{" "}
        <C>web/src/lib/chain/actions.ts</C>; the contract calls go through a TypeScript
        client generated by <C>stellar contract bindings typescript</C> from the deployed
        contract, never hand-written.
      </p>
    </section>
  );
}

function ApiRoutes() {
  return (
    <section className="space-y-4">
      <Heading id="api" icon={ICON.wallet} accent>
        API routes
      </Heading>
      <p className="text-sm leading-6 text-muted-foreground">
        A handful of Route Handlers under <C>web/src/app/api</C>. The two Horizon readers sit
        behind the auth gate so neither can be used as an open Horizon proxy, and both use a
        plain <C>fetch</C> — <C>stellar.ts</C> stays dependency-free and does the arithmetic.
      </p>
      <Table
        head={["Route", "Does"]}
        rows={[
          [
            <C key="r">POST /api/auth/wallet/challenge</C>,
            "Step one of SEP-10 sign-in: returns a self-verifying challenge transaction (server-signed, sequence 0, short expiry) for any well-formed G-address. It answers for every address on purpose — a Stellar address is public, and answering here must never become an account-existence oracle.",
          ],
          [
            <C key="r">POST /api/auth/wallet/verify</C>,
            "Step two: verifies the signature and reads the address out of the signed transaction (never the request body). The caller states intent — sign-in mints a Supabase session (or returns registration-required plus a ticket cookie), link binds the wallet to the signed-in profile, which is a one-time, immutable write.",
          ],
          [
            <C key="r">GET /api/balance</C>,
            "Auth-gated. Reads Horizon /accounts and returns three numbers — balance, reserve (the minimum-balance rule plus liabilities) and spendable — because reporting only the total invites a send that fails on the reserve.",
          ],
          [
            <C key="r">GET /api/verify-tx</C>,
            "Auth-gated. Paste a 64-hex transaction hash; confirms it on the given network via Horizon /transactions and returns ledger, success, source, fee, operation count and memo.",
          ],
        ]}
      />
    </section>
  );
}

function PublicProofs() {
  return (
    <section className="space-y-4">
      <Heading id="public-proofs" icon={ICON.proof} accent>
        Public proof pages
      </Heading>
      <p className="text-sm leading-6 text-muted-foreground">
        A milestone&rsquo;s proof, reachable by someone with no account, lives at{" "}
        <C>/p/[slug]/[milestone]</C> — outside the <C>(app)</C> route group, so no session is
        required. It is the product&rsquo;s claim made checkable by the person the claim is
        for: a title, a status, the anchor history and the decisions with their reasons, each
        with a link to the ledger, so a reader can verify the hashes on stellar.expert
        without trusting the page.
      </p>
      <p className="text-sm leading-6 text-muted-foreground">
        The data comes only from the <C>public_milestone_proof(p_slug, p_milestone_id)</C>{" "}
        function. Every table keeps its RLS unchanged and <C>anon</C> holds no membership
        row, so a direct read returns nothing; the function is a <C>SECURITY DEFINER</C>{" "}
        window that returns a fixed, hand-listed shape — project name, milestone title,
        status, network, contract id, owner address, the anchor list and the review list, and
        nothing else. It returns null unless the project&rsquo;s owner turned on{" "}
        <C>public_proofs</C>. Not-published, no-such-milestone and wrong-project all return
        null and are deliberately indistinguishable: telling them apart would confirm that
        private work exists.
      </p>
    </section>
  );
}

function Verify() {
  return (
    <section className="space-y-4">
      <Heading id="verify" icon={ICON.deployment} accent>
        Verify it yourself
      </Heading>
      <p className="text-sm leading-6 text-muted-foreground">
        The WASM hash is the point: anyone can rebuild this source and check the bytes
        deployed match the code. If it does not, the deployed bytes are not this code.
      </p>
      <Code>{`# Reproduce the deployed contract
cd contracts
stellar contract build          # → target/wasm32v1-none/release/milestone_proof.wasm

# Compare against the deployed hash on both networks:
#   ${WASM_HASH}

# Inspect the live interface directly
stellar contract info interface --id milestone_proof --network testnet`}</Code>
      <p className="text-sm leading-6 text-muted-foreground">
        Deployment is not upgradable, by choice — no admin address, no <C>upgrade</C> entry
        point. A bug means deploying a new contract id and migrating the per-project{" "}
        <C>chain_contract_id</C> the app stores, since a project&rsquo;s ownership stays
        behind in the old contract rather than being upgraded in place. Individual anchors
        are verifiable independently of qdit: every <C>milestone_anchors</C> row names a
        transaction hash you can open on the explorer, and the ledger — not the database — is
        authoritative.
      </p>
      <p className="pt-2 text-xs text-muted-foreground">
        Prefer the app?{" "}
        <Link href="/proofs" className="underline underline-offset-2 hover:text-foreground">
          Open the proof registry
        </Link>{" "}
        or{" "}
        <Link href="/dashboard" className="underline underline-offset-2 hover:text-foreground">
          the dashboard
        </Link>
        .
      </p>
    </section>
  );
}
