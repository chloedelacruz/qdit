import type { LucideIcon } from "lucide-react";

import { ICON } from "@/lib/icons";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match this href only, not its descendants. */
  exact?: boolean;
};

/**
 * Glyphs come from `@/lib/icons` so a concept looks the same here as it does in
 * a section heading or an empty state (spec §Iconography).
 */

/**
 * Nav for the project a user is currently inside. Every destination is scoped
 * to one project: at 40 projects an unscoped board is unusable, so scoping is
 * the default and cross-project views are opt-in below.
 */
export function projectNav(slug: string): NavItem[] {
  return [
    // Exact: every other project route is a descendant of this one.
    { href: `/projects/${slug}`, label: "Overview", icon: ICON.overview, exact: true },
    { href: `/projects/${slug}/board`, label: "Board", icon: ICON.board },
    { href: `/projects/${slug}/milestones`, label: "Milestones", icon: ICON.milestone },
    { href: `/projects/${slug}/deployments`, label: "Deployments", icon: ICON.deployment },
    { href: `/projects/${slug}/proofs`, label: "Proofs", icon: ICON.proof },
    // Last: it is the only one that is about the project rather than the work,
    // and most visits here are administrative rather than daily.
    { href: `/projects/${slug}/members`, label: "Members", icon: ICON.members },
  ];
}

/** Cross-project views. Explicitly labelled so the scope is never ambiguous. */
export const WORKSPACE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: ICON.dashboard },
  // Exact: /projects/[slug] belongs to the project nav, not the index.
  { href: "/projects", label: "Projects", icon: ICON.project, exact: true },
  { href: "/tasks", label: "All tasks", icon: ICON.task },
  { href: "/milestones", label: "All milestones", icon: ICON.milestone },
  { href: "/deployments", label: "All deployments", icon: ICON.deployment },
  { href: "/proofs", label: "Proof registry", icon: ICON.proof },
];

export const FOOTER_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: ICON.settings },
];
