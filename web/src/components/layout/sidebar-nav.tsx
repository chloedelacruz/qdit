"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { LinkPending } from "./link-pending";
import { isActive, type NavItem } from "./nav-items";

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

      {items.map(({ href, label: text, icon: Icon, exact }) => {
        const active = isActive(pathname, { href, label: text, icon: Icon, exact });

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "transition-qdit focus-ring group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium",
              // 2px brand rail on the leading edge (spec §Accent Application).
              "before:absolute before:inset-y-1.5 before:-left-1 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity before:duration-200",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-xs before:opacity-100"
                : "text-muted-foreground hover:bg-sidebar-accent/45 hover:text-sidebar-foreground",
            )}
          >
            <Icon
              className={cn(
                "transition-qdit size-4 shrink-0",
                active ? "text-sidebar-primary" : "group-hover:text-sidebar-foreground",
              )}
            />
            {text}
            {/* Right edge, fixed size: says "on its way" without moving the label. */}
            <LinkPending className="ml-auto text-muted-foreground" />
          </Link>
        );
      })}
    </nav>
  );
}
