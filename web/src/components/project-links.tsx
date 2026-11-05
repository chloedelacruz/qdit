"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ICON } from "@/lib/icons";

/**
 * A project's external links folded into one menu, for a phone (QDIT-34).
 *
 * The overview header carries up to five actions; on a narrow screen three of
 * them were Repo, Docs and Demo, which pushed the page sideways. They collapse
 * into this one trigger below `sm`, and stay as buttons above it.
 */
export function ProjectLinksMenu({
  links,
  className,
}: {
  links: { label: string; href: string }[];
  className?: string;
}) {
  if (links.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          Links
          <ICON.chevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {links.map((link) => (
          <DropdownMenuItem key={link.href} asChild>
            <a href={link.href} target="_blank" rel="noreferrer noopener">
              {link.label}
              <ICON.external className="ml-auto size-3.5 text-muted-foreground" />
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
