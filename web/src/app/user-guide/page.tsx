import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { QditLogo } from "@/components/brand/qdit-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { ICON, type IconName } from "@/lib/icons";

/**
 * The public user guide.
 *
 * A static, account-free page — it lives outside the `(app)` route group, like
 * the landing page and the public proof page, so a first-time reader can open it
 * before they own a wallet. It is a server component: nothing here is
 * interactive, so there is no reason to ship it as client code.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PROSE READS PLAINER THAN THE REST OF THE APP
 * ---------------------------------------------------------------------------
 * Every user-facing sentence below is written in a plain, simplified style:
 * short sentences, one instruction each, the imperative and the active voice,
 * present tense, and one word for one thing. The audience is a builder
 * who may not read English as a first language and who has a wallet prompt open
 * in another window. Plain is the point, not a shortfall.
 *
 * The steps name real controls only. Every button, screen and label quoted here
 * is one that exists in the product — the status actions ("Submit for
 * approval", "Approve", "Reject"), the row-menu items ("Anchor proof on chain"),
 * the anchor dialog's two buttons, the share control, and the wallet page. Where
 * a detail could not be confirmed, the instruction stays general and correct
 * rather than inventing a screen.
 */

export const metadata: Metadata = {
  title: "User guide",
  description:
    "A step-by-step guide to qdit: sign in with a Stellar wallet, run a project, and anchor each milestone's proof on the ledger.",
};

/**
 * A single procedure step. A plain node is one instruction. The object form adds
 * an optional condition, which is shown *before* the instruction it applies to.
 */
type Step = ReactNode | { before: ReactNode; do: ReactNode };

type Section = {
  id: string;
  icon: IconName;
  title: string;
  /** Descriptive lead. Keep to at most 25 words per sentence. */
  lead: ReactNode;
  /** A condition or a warning for the whole procedure, shown before the steps. */
  warn?: ReactNode;
  steps: Step[];
  /** A closing note, for reference detail that is not itself an instruction. */
  note?: ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: "before-you-start",
    icon: "ready",
    title: "1. Before you start",
    lead: (
      <>
        You need a few things before you sign in. qdit runs on two networks.
        Testnet uses free test XLM. Mainnet uses real XLM.
      </>
    ),
    steps: [
      <>
        Use a desktop browser. The Freighter wallet does not run on most phones.
      </>,
      <>
        Install the <strong>Freighter</strong> extension. Freighter is a browser
        extension that holds your Stellar account.
      </>,
      <>Create a Stellar account in the Freighter extension.</>,
      {
        before: <>You pay a small network fee for each on-chain action.</>,
        do: <>Fund your account with XLM.</>,
      },
      <>Set the Freighter extension to the same network as qdit.</>,
    ],
    note: (
      <>
        On testnet you can fund an account for free. qdit offers a{" "}
        <strong>Fund it with Friendbot</strong> button when your account has no
        XLM.
      </>
    ),
  },
  {
    id: "sign-in",
    icon: "wallet",
    title: "2. Sign in with your wallet",
    lead: <>qdit uses your wallet as your identity. You do not type a password to sign in.</>,
    warn: (
      <>
        Set the Freighter extension to the same network as qdit. A wrong network
        stops the sign-in.
      </>
    ),
    steps: [
      <>Open the qdit home page.</>,
      <>
        Click <strong>Connect wallet</strong>.
      </>,
      <>Choose the Freighter extension in the wallet list.</>,
      <>Approve the connection in the Freighter extension.</>,
      <>
        Sign the sign-in request in the Freighter extension. This request is free
        and never reaches the network.
      </>,
      {
        before: <>A wallet that is new to qdit has no account yet.</>,
        do: <>Fill in the short form: a username, an email, and a password.</>,
      },
      <>Wait for the dashboard to open.</>,
    ],
  },
  {
    id: "create-a-project",
    icon: "project",
    title: "3. Create a project",
    lead: <>A project holds your tasks, milestones, and proof trail. You register it on the network once.</>,
    steps: [
      <>
        Open the <strong>Projects</strong> page.
      </>,
      <>
        Click <strong>New project</strong>.
      </>,
      <>Type a name for the project.</>,
      <>
        Check the URL slug. qdit fills it in from the name. You can edit it before
        you save.
      </>,
      <>
        Click <strong>Create project</strong>.
      </>,
      <>Open your new project from the list.</>,
      {
        before: <>Only the project owner can register the project. The wallet you sign with becomes the only wallet that can approve or reject this project&apos;s milestones.</>,
        do: (
          <>
            On the project overview, click <strong>Register on chain</strong>, then
            sign the transaction in the Freighter extension.
          </>
        ),
      },
    ],
    note: (
      <>
        You must register the project before you anchor any milestone. Choose the
        wallet you intend to keep.
      </>
    ),
  },
  {
    id: "board",
    icon: "board",
    title: "4. Add tasks and move them on the board",
    lead: <>The board shows your tasks in three columns: Todo, In Progress, and Done.</>,
    steps: [
      <>
        Open the project <strong>Board</strong> page.
      </>,
      <>
        Click <strong>New task</strong>.
      </>,
      <>Type a title for the task.</>,
      <>Set a priority, an assignee, or a milestone. Each field is optional.</>,
      <>
        Click <strong>Create task</strong>.
      </>,
      <>Drag a task card to another column to change its state.</>,
    ],
  },
  {
    id: "create-a-milestone",
    icon: "milestone",
    title: "5. Create a milestone",
    lead: <>A milestone groups tasks into one result. You submit and prove a milestone, not a single task.</>,
    steps: [
      <>
        Open the project <strong>Milestones</strong> page.
      </>,
      <>
        Click <strong>New milestone</strong>.
      </>,
      <>Type a title for the milestone.</>,
      <>Add a description or a due date. Both fields are optional.</>,
      <>
        Click <strong>Create milestone</strong>.
      </>,
      <>Open the board and set the milestone on the tasks that belong to it.</>,
    ],
  },
  {
    id: "submit-a-milestone",
    icon: "anchor",
    title: "6. Submit a milestone for approval",
    lead: (
      <>
        A submit does two things. First you move the milestone to Submitted. Then
        you anchor its proof. To anchor means to write a proof hash to the
        network. The proof hash is a SHA-256 fingerprint of the milestone.
      </>
    ),
    warn: (
      <>
        The project must be registered on the network first. You need XLM to pay
        the network fee.
      </>
    ),
    steps: [
      <>
        Open the project <strong>Milestones</strong> page.
      </>,
      <>Find the milestone. Its status is Proposed.</>,
      <>
        Open the status control and choose <strong>Submit for approval</strong>.
        The status becomes Submitted.
      </>,
      <>Open the milestone&apos;s actions menu.</>,
      <>
        Click <strong>Anchor proof on chain</strong>.
      </>,
      <>Click the anchor button. qdit checks the rules and simulates the transaction.</>,
      <>Read the network fee that qdit shows. Nothing is sent yet.</>,
      <>
        Click <strong>Sign and submit</strong>.
      </>,
      <>Sign the transaction in the Freighter extension.</>,
      <>
        Wait for the ledger to record the proof. qdit shows the transaction hash
        when it is done.
      </>,
    ],
    note: (
      <>
        The milestone content stays in qdit. Only the hash goes on the network,
        which is what lets someone else check it later.
      </>
    ),
  },
  {
    id: "approve-or-reject",
    icon: "awaiting",
    title: "7. Approve or reject a milestone",
    lead: <>Only the project owner can approve or reject a milestone. A member cannot.</>,
    warn: <>Sign an on-chain approval or rejection with the wallet that registered the project.</>,
    steps: [
      <>
        Open the project <strong>Milestones</strong> page.
      </>,
      <>Find a milestone with the Submitted status.</>,
      <>Open its status control.</>,
      <>
        Choose <strong>Approve</strong> or <strong>Reject</strong>.
      </>,
      {
        before: <>A rejection needs a reason. Whoever submitted the milestone reads it.</>,
        do: <>Type the reason in the dialog.</>,
      },
      <>Confirm the decision. qdit saves it. The reason stays in qdit, not on the ledger.</>,
      <>
        To record the decision on the network, open the actions menu and click{" "}
        <strong>Approve on chain</strong> or <strong>Reject on chain</strong>.
      </>,
      <>Sign the transaction in the Freighter extension.</>,
    ],
    note: <>An approved milestone is final on the ledger. A rejected milestone can be re-submitted.</>,
  },
  {
    id: "verify-a-proof",
    icon: "proof",
    title: "8. Verify a proof on the ledger",
    lead: (
      <>
        Anyone can check a proof against the ledger. The ledger is the public
        record that the Stellar network keeps. You do not need to trust qdit.
      </>
    ),
    steps: [
      <>
        Open the <strong>Proof registry</strong> page.
      </>,
      <>Paste a contract ID or a transaction hash into the search box.</>,
      <>Read the answer. qdit shows which record the identifier belongs to.</>,
      <>Open the hash on stellar.expert. Every hash links to the explorer.</>,
      <>
        Compare the proof hash on the explorer with the one in qdit. A match
        confirms the record.
      </>,
    ],
  },
  {
    id: "publish-and-share",
    icon: "proof",
    title: "9. Publish a milestone and share the public proof link",
    lead: (
      <>
        A public proof page opens with no account. You send the link to a grant
        reviewer or a client.
      </>
    ),
    steps: [
      <>Open the project overview.</>,
      <>
        Find the <strong>Public proofs</strong> setting. Only an owner or an admin
        can change it.
      </>,
      <>
        Click <strong>Publish proofs</strong>. Now anyone with a link can open a
        milestone&apos;s proof.
      </>,
      <>
        Open the project <strong>Milestones</strong> page.
      </>,
      {
        before: <>Anchor the milestone first, so the public page can show a hash.</>,
        do: (
          <>
            Click <strong>Share public link</strong> on the milestone.
          </>
        ),
      },
      <>Copy the link from the dialog.</>,
      <>Send the link to your reviewer or client.</>,
    ],
    note: (
      <>
        The public page shows the title, status, hashes, and decisions. It never
        shows tasks, descriptions, or member names.
      </>
    ),
  },
  {
    id: "wallet-page",
    icon: "wallet",
    title: "10. Use the wallet page",
    lead: <>The wallet page shows your account and lets you send XLM. It reads your balance from the network.</>,
    warn: <>On mainnet you send real XLM. Check the address and the amount before you send.</>,
    steps: [
      <>
        Open the <strong>Wallet</strong> page.
      </>,
      <>Connect your wallet if it is not connected.</>,
      <>Read your XLM balance.</>,
      <>Type the destination address in the Destination field.</>,
      <>Type the amount in the Amount field.</>,
      <>Add a short memo. This field is optional.</>,
      <>
        Click <strong>Send XLM</strong>.
      </>,
      <>Sign the transaction in the Freighter extension.</>,
      <>Wait for the receipt. qdit shows the transaction hash and the ledger number.</>,
    ],
  },
];

/** The words a first-time reader meets in the steps, explained once. */
const TERMS: { term: string; meaning: ReactNode }[] = [
  { term: "wallet", meaning: <>The Freighter extension. It holds your Stellar account and signs for you.</> },
  { term: "milestone", meaning: <>A group of tasks that you submit and prove as one result.</> },
  { term: "proof hash", meaning: <>A SHA-256 fingerprint of a milestone. qdit writes it to the network.</> },
  { term: "anchor", meaning: <>To write a proof hash to the Stellar network.</> },
  { term: "ledger", meaning: <>The public record that the Stellar network keeps.</> },
  { term: "fee", meaning: <>A small amount of XLM that you pay for an on-chain action.</> },
];

export default function UserGuidePage() {
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
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          User guide
        </p>
        <h1 className="mt-1 text-lg font-semibold">How to use qdit</h1>

        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          qdit is a task hub for Stellar teams. You track your work in a project.
          You anchor a proof of each milestone on the Stellar network. This guide
          covers ten tasks. Each task is a short, numbered procedure. Follow the
          steps in order.
        </p>

        {/* Reference material recedes: the glossary sits on the sunken plane,
            because it is looked up, not read straight through (spec §Visual
            Priority). */}
        <section aria-labelledby="terms" className="well mt-6 rounded-xl border border-border p-4">
          <h2 id="terms" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Words in this guide
          </h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {TERMS.map(({ term, meaning }) => (
              <div key={term} className="text-sm">
                <dt className="inline font-medium">{term}</dt>{" "}
                <dd className="inline text-muted-foreground">— {meaning}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* On this page. Plain jump links; hover resolves to the foreground
            rather than the accent, which stays reserved for state. */}
        <nav aria-label="On this page" className="mt-8">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            On this page
          </h2>
          <ol className="mt-3 space-y-1.5">
            {SECTIONS.map((section) => {
              const Icon = ICON[section.icon];
              return (
                <li key={section.id}>
                  <Link
                    href={`#${section.id}`}
                    className="transition-qdit flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <Icon className="size-3.5 shrink-0" aria-hidden />
                    {section.title}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="mt-4 divide-y divide-border">
          {SECTIONS.map((section) => (
            <Procedure key={section.id} section={section} />
          ))}
        </div>

        <p className="mt-10 text-xs text-muted-foreground">
          Ready to start?{" "}
          <Link href="/" className="underline underline-offset-2 hover:text-foreground">
            Open qdit
          </Link>{" "}
          or{" "}
          <Link href="/proofs" className="underline underline-offset-2 hover:text-foreground">
            verify a proof
          </Link>
          .
        </p>
      </main>
    </div>
  );
}

function Procedure({ section }: { section: Section }) {
  const Icon = ICON[section.icon];

  return (
    <section id={section.id} className="scroll-mt-20 py-8">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        {section.title}
      </h2>

      <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.lead}</p>

      {section.warn ? (
        <p className="mt-3 text-sm leading-6 text-warning">{section.warn}</p>
      ) : null}

      <ol className="mt-4 list-decimal space-y-2.5 pl-5 text-sm leading-6 marker:text-xs marker:font-medium marker:text-muted-foreground">
        {section.steps.map((step, index) => (
          <li key={index} className="pl-1">
            {isConditional(step) ? (
              <>
                <span className="text-muted-foreground">{step.before}</span>{" "}
                {step.do}
              </>
            ) : (
              step
            )}
          </li>
        ))}
      </ol>

      {section.note ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{section.note}</p>
      ) : null}
    </section>
  );
}

function isConditional(step: Step): step is { before: ReactNode; do: ReactNode } {
  return typeof step === "object" && step !== null && "do" in step;
}
