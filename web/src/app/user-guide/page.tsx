import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { QditLogo } from "@/components/brand/qdit-mark";
import { IconLegend } from "@/components/icon-legend";
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
 * the anchor dialog's two buttons, the public link's copy and open buttons,
 * the mobile tab bar, and the wallet page. Where a detail could not be
 * confirmed, the instruction stays general and correct rather than inventing a
 * screen.
 *
 * ---------------------------------------------------------------------------
 * THE LONG-FORM HOME FOR WHAT THE APP NO LONGER PRINTS (QDIT-34)
 * ---------------------------------------------------------------------------
 * The app now puts its explanations behind ⓘ bubbles and lets a glyph stand in
 * for its word on repeated controls (spec §Iconography, amended). This page is
 * where those explanations are written out in full: how to find your way on a
 * phone and on a desktop, how to read a bubble or a disabled control, what is
 * on a milestone's page, and a legend of every concept glyph.
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

/**
 * A labelled part of a screen, for sections that describe rather than
 * instruct. Rendered as a definition list: label and icon, then the text.
 */
type Part = { label: string; icon?: IconName; text: ReactNode };

type Section = {
  id: string;
  icon: IconName;
  title: string;
  /** Descriptive lead. Keep to at most 25 words per sentence. */
  lead: ReactNode;
  /** A condition or a warning for the whole procedure, shown before the steps. */
  warn?: ReactNode;
  /** The numbered procedure. Optional for a section that only describes. */
  steps?: Step[];
  /** A small label above `parts`, when steps come first. */
  partsLabel?: string;
  /** What is where, after the steps. */
  parts?: Part[];
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
        Use a desktop browser to sign in for the first time. The Varial wallet
        does not run on most phones.
      </>,
      <>
        Install the <strong>Varial</strong> extension. Varial was called
        Freighter before. It is a browser extension that holds your Stellar
        account.
      </>,
      <>Create a Stellar account in the Varial extension.</>,
      {
        before: <>You pay a small network fee for each on-chain action.</>,
        do: <>Fund your account with XLM.</>,
      },
      <>Set the Varial extension to the same network as qdit.</>,
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
        Set the Varial extension to the same network as qdit. A wrong network
        stops the sign-in.
      </>
    ),
    steps: [
      <>Open the qdit home page.</>,
      <>
        Click <strong>Connect wallet</strong>.
      </>,
      <>Choose Varial in the wallet list.</>,
      <>Approve the connection in the Varial extension.</>,
      <>
        Sign the sign-in request in the Varial extension. This request is free
        and never reaches the network.
      </>,
      {
        before: <>A wallet that is new to qdit has no account yet.</>,
        do: <>Fill in the short form: a username, an email, and a password.</>,
      },
      <>Wait for the dashboard to open.</>,
    ],
    note: (
      <>
        The email and password are your way back in if you lose the wallet. You
        can also use them to sign in on a phone. On-chain actions still need the
        wallet.
      </>
    ),
  },
  {
    id: "find-your-way",
    icon: "dashboard",
    title: "3. Find your way around",
    lead: (
      <>
        qdit has two places: the workspace, which covers all your projects, and
        one project. The navigation follows the place you are in.
      </>
    ),
    parts: [
      {
        label: "On a desktop",
        text: (
          <>
            Use the sidebar on the left. At the top, choose a project in the
            project switcher. Inside a project, the sidebar lists{" "}
            <strong>Overview</strong>, <strong>Board</strong>,{" "}
            <strong>Milestones</strong>, <strong>Deployments</strong>,{" "}
            <strong>Proofs</strong>, and <strong>Members</strong>. Below them are
            the workspace pages, such as <strong>Dashboard</strong> and the{" "}
            <strong>Proof registry</strong>. <strong>Wallet</strong> and{" "}
            <strong>Settings</strong> are at the bottom.
          </>
        ),
      },
      {
        label: "On a phone",
        text: (
          <>
            Use the tab bar at the bottom of the screen. In the workspace it shows{" "}
            <strong>Dashboard</strong>, <strong>Projects</strong>,{" "}
            <strong>Tasks</strong>, <strong>Milestones</strong>, and{" "}
            <strong>More</strong>. Inside a project it shows{" "}
            <strong>Overview</strong>, <strong>Board</strong>,{" "}
            <strong>Milestones</strong>, <strong>Proofs</strong>, and{" "}
            <strong>More</strong>. Tap <strong>More</strong> for every other
            page, the project switcher, and help. A narrow browser window on a
            desktop shows the tab bar too.
          </>
        ),
      },
      {
        label: "Help",
        text: (
          <>
            On a desktop, open the account menu: your initials, top right. It
            links to <strong>Settings</strong>, the <strong>User guide</strong>,
            and the <strong>API docs</strong>. On a phone, the same links are
            under <strong>More</strong>.
          </>
        ),
      },
      {
        label: "Notifications",
        text: (
          <>
            Click the bell at the top of the screen. A notification about a
            milestone opens that milestone&apos;s page.
          </>
        ),
      },
    ],
  },
  {
    id: "hints",
    icon: "info",
    title: "4. Read icons, ⓘ bubbles, and greyed-out buttons",
    lead: (
      <>
        qdit prints little text on screen. A tooltip or a bubble holds the rest.
        This guide holds the long version.
      </>
    ),
    parts: [
      {
        label: "Icon buttons",
        icon: "share",
        text: (
          <>
            Some buttons show an icon and no word, such as the share icon on a
            milestone row. To read the name, point at the button, move to it with
            the Tab key, or tap it. The{" "}
            <Link href="#icons" className="underline underline-offset-2 hover:text-foreground">
              icon legend
            </Link>{" "}
            at the end of this guide lists every icon.
          </>
        ),
      },
      {
        label: "ⓘ bubbles",
        icon: "info",
        text: (
          <>
            An ⓘ beside a page title or a heading opens an explanation. Click or
            tap it. Press Escape or click outside to close it.
          </>
        ),
      },
      {
        label: "Greyed-out buttons",
        text: (
          <>
            A greyed-out button is one you cannot use yet. Point at it, move to
            it with the Tab key, or tap it to read why. Often the reason has a
            link to the place that fixes it.
          </>
        ),
      },
    ],
    note: (
      <>
        Examples: <strong>Anchor proof on chain</strong> is greyed out until the
        project is registered, and its reason links to the project overview.{" "}
        <strong>Certificate</strong> is greyed out until the milestone is
        anchored. A viewer sees the create buttons greyed out. An admin cannot
        edit the owner&apos;s row or their own row on the Members page.
      </>
    ),
  },
  {
    id: "create-a-project",
    icon: "project",
    title: "5. Create a project",
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
      {
        before: <>The wallet you sign with becomes the only wallet that can approve or reject this project&apos;s milestones.</>,
        do: (
          <>
            Click <strong>Create project</strong>. qdit waits for your wallet. If
            no wallet is connected, choose one in the dialog.
          </>
        ),
      },
      <>
        Confirm the registration in the Varial extension. The project is
        created once you confirm, and <strong>Project created</strong> appears.
      </>,
    ],
    note: (
      <>
        Registering is what lets you anchor milestones. Choose the wallet you
        intend to keep. If you close the chooser or the prompt, nothing is created: try again,
        or click <strong>Create without registering</strong> and register later
        with <strong>Register on chain</strong> on the project overview.
      </>
    ),
  },
  {
    id: "board",
    icon: "board",
    title: "6. Add tasks and move them on the board",
    lead: <>The board shows your tasks in three columns: Todo, In Progress, and Done.</>,
    warn: (
      <>
        A viewer cannot create tasks. If <strong>New task</strong> is greyed out,
        ask a project admin for the member role.
      </>
    ),
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
    note: (
      <>
        A task row anywhere in qdit, such as on a milestone&apos;s page, opens
        that task&apos;s panel on the board.
      </>
    ),
  },
  {
    id: "create-a-milestone",
    icon: "milestone",
    title: "7. Create a milestone",
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
    id: "milestone-page",
    icon: "milestone",
    title: "8. Open a milestone's page",
    lead: (
      <>
        Every milestone has its own page. It holds everything about the
        milestone in one place.
      </>
    ),
    steps: [
      <>
        Click a milestone row. Every milestone row opens its page: on the
        dashboard, on the project overview, and on both milestone lists.
      </>,
      <>Or click a notification about the milestone.</>,
    ],
    partsLabel: "On the page",
    parts: [
      {
        label: "Header",
        icon: "milestone",
        text: (
          <>
            The title, the status control, and the actions menu (⋯). They work
            the same as on a milestone row.
          </>
        ),
      },
      {
        label: "Progress",
        icon: "task",
        text: <>How many tasks are done, as a count and a percentage, and the due date.</>,
      },
      {
        label: "On chain",
        icon: "anchor",
        text: (
          <>
            Whether the proof is anchored, and on which network. A stale anchor
            means the milestone changed after it was anchored. If the project is
            not registered, the line links to the project overview.
          </>
        ),
      },
      {
        label: "Public link",
        icon: "public",
        text: (
          <>
            The milestone&apos;s public proof link, with a copy button and an
            open button. If publishing is off, the line says Private and links to
            the setting.
          </>
        ),
      },
      {
        label: "Tasks",
        icon: "task",
        text: <>The tasks in this milestone. A task row opens the task on the board.</>,
      },
      {
        label: "Proof",
        icon: "proof",
        text: (
          <>
            The proof records for this milestone. Click{" "}
            <strong>Record proof</strong> to add one.
          </>
        ),
      },
      {
        label: "History",
        icon: "history",
        text: (
          <>
            Every anchor and decision, oldest first. The anchor mark means the
            entry is on the ledger, and anyone can check it. The person mark
            means the entry is recorded in qdit only.
          </>
        ),
      },
      {
        label: "Certificate",
        icon: "certificate",
        text: (
          <>
            Click <strong>Certificate</strong> beside the History heading to
            download it. It is one file that anyone can check against the ledger
            without qdit. It is greyed out until the milestone is anchored.
          </>
        ),
      },
    ],
  },
  {
    id: "submit-a-milestone",
    icon: "anchor",
    title: "9. Submit a milestone for approval",
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
      <>Open the milestone&apos;s page. Its status is Proposed.</>,
      <>
        Open the status control and choose <strong>Submit for approval</strong>.
        The status becomes Submitted.
      </>,
      <>Open the actions menu (⋯) beside the title.</>,
      {
        before: <>The item is greyed out if the project is not registered. Its reason links to the overview.</>,
        do: (
          <>
            Click <strong>Anchor proof on chain</strong>.
          </>
        ),
      },
      <>
        In the dialog, click <strong>Anchor proof</strong>. qdit checks the rules
        and simulates the transaction.
      </>,
      <>Read the network fee that qdit shows. Nothing is sent yet.</>,
      <>
        Click <strong>Sign and submit</strong>.
      </>,
      <>Sign the transaction in the Varial extension.</>,
      <>
        Wait for the ledger to record the proof. qdit shows the transaction hash
        when it is done.
      </>,
    ],
    note: (
      <>
        The milestone content stays in qdit. Only the hash goes on the network,
        which is what lets someone else check it later. You can also do every
        step from the milestone&apos;s row on the Milestones page.
      </>
    ),
  },
  {
    id: "approve-or-reject",
    icon: "awaiting",
    title: "10. Approve or reject a milestone",
    lead: <>Only the project owner can approve or reject a milestone. A member cannot.</>,
    warn: <>Sign an on-chain approval or rejection with the wallet that registered the project.</>,
    steps: [
      <>Open the milestone&apos;s page. Its status is Submitted.</>,
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
        To record the decision on the network, open the actions menu (⋯) and
        click <strong>Approve on chain</strong> or <strong>Reject on chain</strong>.
      </>,
      <>Sign the transaction in the Varial extension.</>,
    ],
    note: (
      <>
        An approved milestone is final on the ledger. A rejected milestone can be
        re-submitted. Each decision appears in the milestone&apos;s History.
      </>
    ),
  },
  {
    id: "verify-a-proof",
    icon: "proof",
    title: "11. Verify a proof on the ledger",
    lead: (
      <>
        Anyone can check a proof against the ledger. The ledger is the public
        record that the Stellar network keeps. You do not need to trust qdit.
      </>
    ),
    steps: [
      <>
        Open the <strong>Proof registry</strong> page. On a phone, it is under{" "}
        <strong>More</strong>.
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
    icon: "public",
    title: "12. Publish a milestone and share the public proof link",
    lead: (
      <>
        A public proof page opens with no account. You send the link to a grant
        reviewer or a client.
      </>
    ),
    steps: [
      <>Open the project overview.</>,
      <>
        Find the <strong>Private proofs</strong> setting. Only an owner or an
        admin can change it.
      </>,
      <>
        Click <strong>Publish proofs</strong>. The setting now reads Public
        proofs. Anyone with a link can open a milestone&apos;s proof.
      </>,
      {
        before: <>Anchor the milestone first, so the public page can show a hash. Until then, the copy buttons are greyed out.</>,
        do: <>Open the milestone&apos;s page.</>,
      },
      <>
        In the <strong>Public link</strong> line, click the copy button. Click the
        open button to see the public page first.
      </>,
      <>Send the link to your reviewer or client.</>,
    ],
    note: (
      <>
        The share icon on a milestone row copies the same link. The public page
        shows the title, status, hashes, and decisions. It never shows tasks,
        descriptions, or member names.
      </>
    ),
  },
  {
    id: "wallet-page",
    icon: "wallet",
    title: "13. Use the wallet page",
    lead: <>The wallet page shows your account and lets you send XLM. It reads your balance from the network.</>,
    warn: <>On mainnet you send real XLM. Check the address and the amount before you send.</>,
    steps: [
      <>
        Open the <strong>Wallet</strong> page. On a phone, it is under{" "}
        <strong>More</strong>.
      </>,
      <>Connect your wallet if it is not connected.</>,
      <>Read your XLM balance.</>,
      <>Type the destination address in the Destination field.</>,
      <>Type the amount in the Amount field.</>,
      <>Add a short memo. This field is optional.</>,
      <>
        Click <strong>Send XLM</strong>.
      </>,
      <>Sign the transaction in the Varial extension.</>,
      <>Wait for the receipt. qdit shows the transaction hash and the ledger number.</>,
    ],
  },
  {
    id: "hackathon",
    icon: "send",
    title: "14. Submit to a hackathon",
    lead: (
      <>
        Your team sends one submission. It holds your qdit project, your doqtri
        notes, and your mindmap images.
      </>
    ),
    warn: (
      <>
        Only the project&apos;s owner or an admin can submit. The hackathon page
        shows when submissions close.
      </>
    ),
    steps: [
      <>Create one qdit project for your team. Section 5 shows how.</>,
      <>
        Open the project&apos;s <strong>Members</strong> page. Add each teammate
        with <strong>Add member</strong>. Every team member must be a member of
        the project.
      </>,
      <>
        In doqtri, open the global mindmap. Click{" "}
        <strong>Send to qdit hackathon</strong>.
      </>,
      <>
        Save an image of your global mindmap. You can add up to two note maps
        too. Use PNG, JPEG, or WebP, up to 5 MB each.
      </>,
      <>Open the hackathon page from the link you were given.</>,
      <>
        Click <strong>Add submission to hackathon</strong>.
      </>,
      <>Choose your team project. Type the team name. Tick each team member.</>,
      <>Attach the global mindmap image. Attach note maps if you have them.</>,
      <>
        Click <strong>Submit</strong>. Your entry shows{" "}
        <strong>Received</strong> under My entry.
      </>,
    ],
    note: (
      <>
        You can submit again until the deadline. Click{" "}
        <strong>Update submission</strong>. The last submission counts. If you
        send from doqtri again, submit again in qdit to include it. A person
        can be on one team only.
      </>
    ),
  },
];

/** The legend's entry in "On this page"; its body is `IconLegend`. */
const LEGEND = { id: "icons", icon: "guide", title: "Icon legend" } as const satisfies Pick<
  Section,
  "id" | "icon" | "title"
>;

/** The words a first-time reader meets in the steps, explained once. */
const TERMS: { term: string; meaning: ReactNode }[] = [
  { term: "wallet", meaning: <>The Varial extension. It holds your Stellar account and signs for you.</> },
  { term: "milestone", meaning: <>A group of tasks that you submit and prove as one result.</> },
  { term: "proof hash", meaning: <>A SHA-256 fingerprint of a milestone. qdit writes it to the network.</> },
  { term: "anchor", meaning: <>To write a proof hash to the Stellar network.</> },
  { term: "ledger", meaning: <>The public record that the Stellar network keeps.</> },
  { term: "fee", meaning: <>A small amount of XLM that you pay for an on-chain action.</> },
  { term: "ⓘ bubble", meaning: <>A small button beside a heading. It opens an explanation.</> },
  { term: "certificate", meaning: <>One file that proves a milestone without qdit.</> },
];

export default function UserGuidePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-5 sm:px-6">
        <Link href="/" className="transition-qdit shrink-0 hover:opacity-80">
          <QditLogo />
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          User guide
        </p>
        <h1 className="mt-1 text-lg font-semibold">How to use qdit</h1>

        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          qdit is a task hub for Stellar teams. You track your work in a project.
          You anchor a proof of each milestone on the Stellar network. Sections 1
          to 4 cover setup and how to find your way. The rest are short, numbered
          procedures. Follow the steps in order. The icon legend at the end names
          every icon in qdit.
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
            {[...SECTIONS, LEGEND].map((section) => {
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

          {/* Reference, like the glossary: looked up, not followed, so it has
              no steps — just every concept glyph with its name. */}
          <section id={LEGEND.id} aria-labelledby={`${LEGEND.id}-title`} className="scroll-mt-20 py-8">
            <h2 id={`${LEGEND.id}-title`} className="flex items-center gap-2 text-base font-semibold">
              <ICON.guide className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {LEGEND.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Each icon in qdit means one thing, everywhere it appears. Where an
              icon has no word beside it, its tooltip shows the name below.
            </p>
            <div className="mt-5">
              <IconLegend />
            </div>
          </section>
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

      {section.steps ? (
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
      ) : null}

      {section.parts ? (
        <>
          {section.partsLabel ? (
            <h3 className="mt-6 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {section.partsLabel}
            </h3>
          ) : null}
          {/* Label beside text from `sm` up, stacked on a phone. The label
              column is a fixed rem width and the text column shrinks, so it
              never scrolls sideways. */}
          <dl
            className={`${section.partsLabel ? "mt-3" : "mt-4"} grid gap-x-4 text-sm leading-6 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-y-3`}
          >
            {section.parts.map((part) => {
              const PartIcon = part.icon ? ICON[part.icon] : null;
              return (
                <div key={part.label} className="contents">
                  <dt className="flex items-center gap-2 font-medium">
                    {PartIcon ? (
                      <PartIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : null}
                    {part.label}
                  </dt>
                  <dd className="mb-3 text-muted-foreground sm:mb-0">{part.text}</dd>
                </div>
              );
            })}
          </dl>
        </>
      ) : null}

      {section.note ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{section.note}</p>
      ) : null}
    </section>
  );
}

function isConditional(step: Step): step is { before: ReactNode; do: ReactNode } {
  return typeof step === "object" && step !== null && "do" in step;
}
