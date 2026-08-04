"use client";

import { Check, ChevronsUpDown, Folder } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PROJECT_STATUS, type ProjectStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type ProjectOption = {
  id: string;
  slug: string;
  name: string;
  status: ProjectStatus;
};

/**
 * The scope control for the whole app. Everything under it in the sidebar is
 * relative to whichever project is selected here, so it sits at the top and
 * always states the current scope — including when that scope is "none".
 */
export function ProjectSwitcher({
  projects,
  activeSlug,
  onNavigate,
}: {
  projects: ProjectOption[];
  activeSlug?: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const active = projects.find((project) => project.slug === activeSlug);

  // Archived projects are noise in a switcher — reachable from /projects, but
  // never surfaced here unless you are already inside one.
  const selectable = projects.filter(
    (project) => project.status !== "archived" || project.slug === activeSlug,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-2.5 font-medium"
          aria-label={active ? `Project: ${active.name}` : "Choose a project"}
        >
          <Folder className={cn("size-4 shrink-0", active && "text-primary")} />
          <span className="truncate">{active ? active.name : "All projects"}</span>
          <ChevronsUpDown className="ml-auto size-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Switch project</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {selectable.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={() => {
              onNavigate?.();
              router.push(`/projects/${project.slug}`);
            }}
          >
            <Check
              className={cn(
                "size-4 shrink-0",
                project.slug === activeSlug ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="truncate">{project.name}</span>
            <StatusBadge
              state={PROJECT_STATUS[project.status]}
              dot={false}
              className="ml-auto"
            />
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/projects" onClick={onNavigate}>
            <Folder className="size-4" />
            Browse all projects
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
