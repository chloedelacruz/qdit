import type { ComponentType, ReactNode, SVGProps } from "react";

import { cn } from "@/lib/utils";

/**
 * qdit's own glyphs (QDIT-34).
 *
 * Drawn to spec §Iconography rather than picked from a library: a 24px grid,
 * a 2px stroke with round caps and joins, geometric shapes, minimal detail and
 * no literal crypto imagery. Each one names a *concept* the app has — a
 * milestone, a proof, an anchored or stale record — so the same mark can stand
 * in for the word wherever the word would only repeat itself.
 *
 * Same call signature as a lucide icon (`size`, `strokeWidth`, `className`,
 * any SVG attribute), so the two are interchangeable behind `ICON`. Nothing
 * imports from this file directly; `@/lib/icons` is the only door.
 */

export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number | string;
  strokeWidth?: number | string;
};

export type IconComponent = ComponentType<IconProps>;

function glyph(name: string, paths: ReactNode): IconComponent {
  function Glyph({ size = 24, strokeWidth = 2, className, ...props }: IconProps) {
    // Decorative unless the caller names it — the label is on the control.
    const labelled = Boolean(props["aria-label"] || props["aria-labelledby"]);
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={labelled ? undefined : true}
        role={labelled ? "img" : undefined}
        data-glyph={name}
        className={cn("qdit-icon shrink-0", className)}
        {...props}
      >
        {paths}
      </svg>
    );
  }
  Glyph.displayName = `Glyph(${name})`;
  return Glyph;
}

// --- Places -----------------------------------------------------------------

/** Four tiles of unequal size: an at-a-glance surface, not a single list. */
export const DashboardGlyph = glyph(
  "dashboard",
  <>
    <rect x="3" y="3" width="7" height="9" rx="2" />
    <rect x="14" y="3" width="7" height="5" rx="2" />
    <rect x="14" y="12" width="7" height="9" rx="2" />
    <rect x="3" y="16" width="7" height="5" rx="2" />
  </>,
);

export const ProjectGlyph = glyph(
  "project",
  <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />,
);

/** Stacked planes — everything about one project, in layers. */
export const OverviewGlyph = glyph(
  "overview",
  <>
    <path d="M12 3 3 7.5 12 12l9-4.5z" />
    <path d="m3 12 9 4.5 9-4.5" />
    <path d="m3 16.5 9 4.5 9-4.5" />
  </>,
);

/** Three columns of falling height: work moving left to right. */
export const BoardGlyph = glyph(
  "board",
  <>
    <rect x="3.5" y="4" width="4.5" height="16" rx="1.5" />
    <rect x="9.75" y="4" width="4.5" height="11" rx="1.5" />
    <rect x="16" y="4" width="4.5" height="7" rx="1.5" />
  </>,
);

export const SettingsGlyph = glyph(
  "settings",
  <>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </>,
);

// --- Work -------------------------------------------------------------------

/** A target, not a ticked box (spec: no literal task/checklist icons). */
export const TaskGlyph = glyph(
  "task",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2.5" />
  </>,
);

/** A pennant on a post: a point on the way that work is measured against. */
export const MilestoneGlyph = glyph(
  "milestone",
  <>
    <path d="M5.5 21V3.5" />
    <path d="M5.5 4h11l-2.5 4 2.5 4h-11" />
  </>,
);

/** A release leaving the box it was built in. */
export const DeploymentGlyph = glyph(
  "deployment",
  <>
    <rect x="3" y="13" width="18" height="8" rx="2.5" />
    <path d="M12 10V3" />
    <path d="m8.5 6.5 3.5-3.5 3.5 3.5" />
    <path d="M7 17h.01M10.5 17h.01" />
  </>,
);

/**
 * A hash in a frame. A proof in qdit *is* a hash — the content stays here and
 * only the digest is published — so the mark says exactly that.
 */
export const ProofGlyph = glyph(
  "proof",
  <>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="m10.25 7.5-1 9M14.75 7.5l-1 9M7.5 10.5h9M7 13.5h9" />
  </>,
);

export const PlanDocGlyph = glyph(
  "plan-doc",
  <>
    <path d="M14 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V8.5z" />
    <path d="M14 3v5.5h5.5" />
    <path d="M8.5 13h7M8.5 16.5h4.5" />
  </>,
);

// --- People -----------------------------------------------------------------

export const PersonGlyph = glyph(
  "person",
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </>,
);

export const MembersGlyph = glyph(
  "members",
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8" />
    <path d="M18 14.3a6.5 6.5 0 0 1 3.5 5.7" />
  </>,
);

export const WalletGlyph = glyph(
  "wallet",
  <>
    <rect x="3" y="5" width="18" height="15" rx="2.5" />
    <path d="M21 10h-4.5a2.5 2.5 0 0 0 0 5H21" />
  </>,
);

// --- The ledger ---------------------------------------------------------------

/** Proof written to the ledger — the one place chain imagery is warranted. */
export const AnchorGlyph = glyph(
  "anchor",
  <>
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v14" />
    <path d="M8 10.5h8" />
    <path d="M4.5 13.5a7.5 7.5 0 0 0 15 0" />
  </>,
);

/**
 * Anchored under a hash the milestone no longer matches. The same anchor with
 * its arms broken: still a real record, no longer holding what it is tied to.
 */
export const StaleAnchorGlyph = glyph(
  "anchor-stale",
  <>
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v14" />
    <path d="M8 10.5h8" />
    <path d="M4.5 13.5a7.5 7.5 0 0 0 4.5 6.9M15 20.4a7.5 7.5 0 0 0 4.5-6.9" />
  </>,
);

/** Not on chain yet: an outline still waiting to be drawn in. */
export const UnregisteredGlyph = glyph(
  "unregistered",
  <circle cx="12" cy="12" r="8.5" strokeDasharray="3.2 3.4" />,
);

/** Submitted to the network, not confirmed. Time, not failure. */
export const PendingGlyph = glyph(
  "pending",
  <>
    <path d="M6.5 3h11M6.5 21h11" />
    <path d="M7.5 3v2.5c0 2.2 4.5 4.3 4.5 6.5s-4.5 4.3-4.5 6.5V21" />
    <path d="M16.5 3v2.5c0 2.2-4.5 4.3-4.5 6.5s4.5 4.3 4.5 6.5V21" />
  </>,
);

/** A seal on a ribbon: the exported, self-verifying record. */
export const CertificateGlyph = glyph(
  "certificate",
  <>
    <circle cx="12" cy="9" r="5.5" />
    <path d="m8.6 13.3-1.6 7.7 5-2.5 5 2.5-1.6-7.7" />
  </>,
);

/** The sequence of what happened, read backwards from now. */
export const HistoryGlyph = glyph(
  "history",
  <>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
    <path d="M3.5 4v4h4" />
    <path d="M12 8v4.5l3 2" />
  </>,
);

// --- Visibility -----------------------------------------------------------------

/** Readable by anyone with the link, no account needed. */
export const PublicGlyph = glyph(
  "public",
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

export const PrivateGlyph = glyph(
  "private",
  <>
    <path d="M9.9 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4" />
    <path d="M6.6 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9.4 9.4 0 0 0 4.9-1.4" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="m3.5 3.5 17 17" />
  </>,
);

export const LockedGlyph = glyph(
  "locked",
  <>
    <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" />
    <path d="M8 10.5v-3a4 4 0 0 1 8 0v3" />
  </>,
);

/** The link out to share. A box with something leaving it. */
export const ShareGlyph = glyph(
  "share",
  <>
    <path d="M12 14V3" />
    <path d="m8 6.5 4-3.5 4 3.5" />
    <path d="M8.5 10H7a2.5 2.5 0 0 0-2.5 2.5v6A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5v-6A2.5 2.5 0 0 0 17 10h-1.5" />
  </>,
);

// --- Signals ----------------------------------------------------------------

/** "There is more to read here." Opens an explainer; never a status. */
export const InfoGlyph = glyph(
  "info",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <path d="M12 7.5h.01" />
  </>,
);

/** Waiting on someone else — review, approval, sign-off. */
export const AwaitingGlyph = glyph(
  "awaiting",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </>,
);

export const NotificationGlyph = glyph(
  "notification",
  <>
    <path d="M6 16v-5.5a6 6 0 0 1 12 0V16l1.5 2h-15z" />
    <path d="M10 21h4" />
  </>,
);

/** A precondition that is satisfied. The only bare tick in the set. */
export const ReadyGlyph = glyph("ready", <path d="m5 12.5 4.5 4.5L19 7.5" />);

export const VerifiedGlyph = glyph(
  "verified",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.8 2.8L16 9.5" />
  </>,
);

export const MismatchGlyph = glyph(
  "mismatch",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5" />
    <path d="M12 16.5h.01" />
  </>,
);

export const FailedGlyph = glyph(
  "failed",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </>,
);

export const UncheckedGlyph = glyph(
  "unchecked",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" />
    <path d="M12 17h.01" />
  </>,
);

/** Something failed. Error boundaries only — never a status or a warning. */
export const ErrorGlyph = glyph(
  "error",
  <>
    <path d="M10.3 4.2a2 2 0 0 1 3.4 0l7.6 13.1a2 2 0 0 1-1.7 3H4.4a2 2 0 0 1-1.7-3z" />
    <path d="M12 9.5v4" />
    <path d="M12 17h.01" />
  </>,
);

/** Asked for by name, and there is no such thing. 404 only. */
export const MissingGlyph = glyph(
  "missing",
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.9-4.9" />
    <path d="m8.5 8.5 4 4M12.5 8.5l-4 4" />
  </>,
);

/** A link that has come apart — a disconnected app or wallet. */
export const DisconnectedGlyph = glyph(
  "disconnected",
  <>
    <path d="M9 15 7.3 16.7a3.2 3.2 0 0 1-4.5-4.5L4.5 10.5" />
    <path d="m15 9 1.7-1.7a3.2 3.2 0 0 1 4.5 4.5L19.5 13.5" />
    <path d="M8 3.5v2M3.5 8h2M16 20.5v-2M20.5 16h-2" />
  </>,
);

/** Where a record came from outside qdit (a doqtri plan, an external page). */
export const ExternalGlyph = glyph(
  "external",
  <>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v4.5a2.5 2.5 0 0 1-2.5 2.5h-10A2.5 2.5 0 0 1 3 18.5v-10A2.5 2.5 0 0 1 5.5 6H10" />
  </>,
);

// --- Help -------------------------------------------------------------------

/** The user guide: an open book. */
export const GuideGlyph = glyph(
  "guide",
  <>
    <path d="M12 6.5C10.3 5 7.9 4.5 3.5 4.5v14c4.4 0 6.8.5 8.5 2 1.7-1.5 4.1-2 8.5-2v-14c-4.4 0-6.8.5-8.5 2z" />
    <path d="M12 6.5v14" />
  </>,
);

/** The API reference: code, not prose. */
export const ApiGlyph = glyph(
  "api",
  <>
    <path d="m8 8-4 4 4 4" />
    <path d="m16 8 4 4-4 4" />
    <path d="m13.5 5-3 14" />
  </>,
);
