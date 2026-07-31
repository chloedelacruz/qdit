"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-items";

export function SidebarNav({
  items,
  label,
  onNavigate,
}: {
  items: NavItem[];
  label?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label ?? "Primary"} className="flex flex-col gap-0.5">
      {label ? (
        <p className="px-2.5 pt-4 pb-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
      ) : null}

      {items.map(({ href, label: text, icon: Icon }) => {
        // `/projects` should stay active on `/projects/acme`, but `/` must not
        // match everything.
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "transition-qdit group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            )}
          >
            <Icon className={cn("size-4 shrink-0", active && "text-sidebar-primary")} />
            {text}
          </Link>
        );
      })}
    </nav>
  );
}
