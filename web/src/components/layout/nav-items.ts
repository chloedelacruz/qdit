import type { IconComponent } from "@/lib/icons";

import { ICON } from "@/lib/icons";

export type NavItem = {
  href: string;
  label: string;
  icon: IconComponent;
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
  // Not exact: inside a hackathon (its page, admin console, judging) the
  // entry stays lit, so staff always have a way back to the index.
  { href: "/hackathons", label: "Hackathons", icon: ICON.hackathon },
];

export const FOOTER_NAV: NavItem[] = [
  // Below the workspace nav with Settings, because it is about the person
  // rather than the work — the same reason Settings sits here.
  { href: "/wallet", label: "Wallet", icon: ICON.wallet },
  { href: "/settings", label: "Settings", icon: ICON.settings },
];

/**
 * The mobile tab bar (QDIT-34). Four destinations and More, chosen from the
 * daily loop qdit is built around — task, milestone, proof — and following the
 * scope the person is in, as the sidebar does. Everything else is in More.
 * Short labels: a tab bar keeps a word under each glyph, but only one.
 */
export function mobileTabs(slug: string | undefined): NavItem[] {
  if (slug) {
    return [
      { href: `/projects/${slug}`, label: "Overview", icon: ICON.overview, exact: true },
      { href: `/projects/${slug}/board`, label: "Board", icon: ICON.board },
      { href: `/projects/${slug}/milestones`, label: "Milestones", icon: ICON.milestone },
      { href: `/projects/${slug}/proofs`, label: "Proofs", icon: ICON.proof },
    ];
  }

  return [
    { href: "/dashboard", label: "Dashboard", icon: ICON.dashboard },
    { href: "/projects", label: "Projects", icon: ICON.project, exact: true },
    { href: "/tasks", label: "Tasks", icon: ICON.task },
    { href: "/milestones", label: "Milestones", icon: ICON.milestone },
  ];
}

/** Help, reachable from More on a phone and from the account menu on a desktop. */
export const HELP_NAV: NavItem[] = [
  { href: "/user-guide", label: "User guide", icon: ICON.guide },
  { href: "/docs", label: "API docs", icon: ICON.api },
];

/**
 * Descendants light up their parent by default, so `/projects/acme/board`
 * keeps "Board" active. `exact` opts out where a route is the ancestor of a
 * whole section (project Overview, the Projects index).
 */
export function isActive(pathname: string, item: NavItem): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
