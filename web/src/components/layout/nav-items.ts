import {
  Columns3,
  Folder,
  GitBranch,
  LayoutGrid,
  Link2,
  Milestone,
  Settings2,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Icons stay geometric and abstract per the design spec — no literal
 * checklists, clipboards or crypto imagery.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/projects", label: "Projects", icon: Folder },
  { href: "/board", label: "Board", icon: Columns3 },
  { href: "/milestones", label: "Milestones", icon: Milestone },
];

export const BUILD_NAV: NavItem[] = [
  { href: "/deployments", label: "Deployments", icon: GitBranch },
  { href: "/proofs", label: "Proof registry", icon: Link2 },
];

export const FOOTER_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: Settings2 },
];
