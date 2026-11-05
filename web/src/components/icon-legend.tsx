import { ICON, type IconName } from "@/lib/icons";

/**
 * Every qdit concept glyph, with its name and what it means (QDIT-34).
 *
 * The app lets a glyph stand in for its word on repeated row actions and
 * status marks (spec §Iconography, amended). A tooltip names each one in
 * place; this is the same vocabulary written out once, for the user guide.
 *
 * Concepts only. The lucide controls — close, copy, a chevron — are plain
 * mechanics with no qdit meaning, so they need no legend.
 *
 * Names follow the label the app itself uses for the mark (its tooltip or
 * `aria-label`) wherever it has one, so a reader can match the two. A server
 * component: nothing here is interactive.
 */

type Entry = { icon: IconName; name: string; meaning: string };

/** Grouped as `lib/icons.ts` groups them, so a reader can scan by kind. */
const GROUPS: { title: string; entries: Entry[] }[] = [
  {
    title: "Places",
    entries: [
      { icon: "dashboard", name: "Dashboard", meaning: "Your work across every project, at a glance." },
      { icon: "project", name: "Project", meaning: "One project: its tasks, milestones, and proof." },
      { icon: "overview", name: "Overview", meaning: "The project's home page. You register and publish the project here." },
      { icon: "board", name: "Board", meaning: "The project's tasks in three columns: Todo, In Progress, and Done." },
      { icon: "settings", name: "Settings", meaning: "Your account and the apps you connected to it." },
    ],
  },
  {
    title: "Work",
    entries: [
      { icon: "task", name: "Task", meaning: "One piece of work on the board." },
      { icon: "milestone", name: "Milestone", meaning: "A group of tasks that you submit and prove as one result." },
      { icon: "deployment", name: "Deployment", meaning: "A release of the project that someone recorded." },
      { icon: "proof", name: "Proof", meaning: "A record of a transaction or a contract that backs a milestone." },
      { icon: "planDoc", name: "doqtri plan", meaning: "A plan in doqtri that is linked to this project or milestone." },
    ],
  },
  {
    title: "People",
    entries: [
      {
        icon: "assignedToMe",
        name: "Person",
        meaning: "You, or one person. In a milestone's history, it marks an entry that is recorded in qdit only.",
      },
      { icon: "members", name: "Members", meaning: "The people in a project and their roles." },
      { icon: "wallet", name: "Wallet", meaning: "Your connected Stellar account. It signs for you." },
    ],
  },
  {
    title: "The ledger",
    entries: [
      {
        icon: "anchor",
        name: "Anchored",
        meaning: "The proof hash is on the ledger. Anyone can check it. In a history, it marks an entry on the ledger.",
      },
      {
        icon: "anchorStale",
        name: "Stale anchor",
        meaning: "The milestone changed after it was anchored. The anchor still proves the old version.",
      },
      {
        icon: "unregistered",
        name: "Not registered",
        meaning: "The project is not on chain yet. Register it on the project overview.",
      },
      { icon: "pending", name: "Pending", meaning: "Sent to the network. Not confirmed yet." },
      { icon: "certificate", name: "Certificate", meaning: "One file that proves a milestone without qdit." },
      { icon: "history", name: "History", meaning: "Every anchor and decision on a milestone, oldest first." },
    ],
  },
  {
    title: "Visibility",
    entries: [
      { icon: "public", name: "Public", meaning: "Anyone with the link can open it. No account is needed." },
      { icon: "private", name: "Private", meaning: "Only the project's members can see it." },
      { icon: "locked", name: "No access", meaning: "This exists, but your account cannot open it." },
      { icon: "share", name: "Copy public link", meaning: "Copies a milestone's public proof link." },
      { icon: "external", name: "Opens outside qdit", meaning: "A doqtri plan, or a page on the stellar.expert explorer." },
    ],
  },
  {
    title: "Signals",
    entries: [
      { icon: "info", name: "About", meaning: "Opens an explanation. It is never a status." },
      { icon: "awaiting", name: "Awaiting", meaning: "Waiting on someone else, such as an approval." },
      { icon: "notification", name: "Notifications", meaning: "News about your milestones. Each one opens its milestone." },
      {
        icon: "ready",
        name: "Ready",
        meaning: "A setup step is done: the wallet is installed, the network is right, or the account is funded.",
      },
      { icon: "verified", name: "Verified", meaning: "The check passed. The record matches." },
      { icon: "mismatch", name: "Does not match", meaning: "The record differs from the ledger or from the plan." },
      { icon: "failed", name: "Failed", meaning: "The check or the transaction failed." },
      { icon: "unchecked", name: "Could not check", meaning: "qdit could not reach the source to compare." },
      { icon: "disconnected", name: "Disconnected", meaning: "The connection to a wallet, an app, or doqtri is lost." },
      { icon: "error", name: "Error", meaning: "Something went wrong. Shown on an error page only." },
      { icon: "missing", name: "Not found", meaning: "The page or the record does not exist." },
    ],
  },
  {
    title: "Help",
    entries: [
      { icon: "guide", name: "User guide", meaning: "This guide." },
      { icon: "api", name: "API docs", meaning: "The reference for apps that connect to qdit." },
    ],
  },
];

/**
 * One definition list per group: the glyph and its name in the `dt`, the
 * meaning in the `dd`. One column on a phone, two from `sm` up; nothing has a
 * fixed width, so it never scrolls sideways.
 */
export function IconLegend() {
  return (
    <div className="space-y-5">
      {GROUPS.map((group) => {
        const headingId = `icons-${group.title.toLowerCase().replace(/\s+/g, "-")}`;
        return (
          <section key={group.title} aria-labelledby={headingId}>
            <h3
              id={headingId}
              className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
            >
              {group.title}
            </h3>
            <dl className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {group.entries.map((entry) => {
                const Icon = ICON[entry.icon];
                return (
                  <div key={entry.icon} className="min-w-0">
                    <dt className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      {entry.name}
                    </dt>
                    <dd className="mt-0.5 pl-6 text-sm leading-6 text-muted-foreground">
                      {entry.meaning}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
